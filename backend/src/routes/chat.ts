import { generateText, streamText, tool } from 'ai'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { classifyIntent } from '../services/intentClassifier'
import { openai, DEFAULT_MODEL, SYSTEM_PROMPT } from '../services/openai'
import { approveToolCall } from '../services/policyGate'
import { applyToolFirewall } from '../services/toolFirewall'
import { supabaseAdmin } from '../services/supabase'
import type { AppRegistration, ToolSchema } from '../../../shared/types/app'

const router = Router()
router.use(requireAuth)

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
})

function sseWrite(res: Response, event: object) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/**
 * Convert a ToolSchema to an AI SDK tool definition.
 * The execute function acts as a relay: it validates via Policy Gate,
 * then signals the frontend to forward the invocation to the iframe via postMessage.
 * Results come back via a pending promise resolved by the /api/apps/:id/invoke endpoint.
 */
function buildAITool(
  schema: ToolSchema,
  app: AppRegistration,
  userId: string,
  conversationId: string,
  res: Response,
  pendingCalls: Map<string, (result: Record<string, unknown>) => void>,
) {
  // Build a Zod schema from the inputSchema JSON Schema
  const zodParams = buildZodFromJsonSchema(schema.inputSchema)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tool<any, any>({
    description: schema.description,
    parameters: zodParams,
    execute: async (params: Record<string, unknown>) => {
      // Policy Gate check
      const decision = approveToolCall(
        { appId: app.id, toolName: schema.name, parameters: params as Record<string, unknown>, userId, conversationId },
        app,
      )

      if (!decision.approved) {
        const msg = `Tool "${schema.name}" denied: ${decision.reason}`
        sseWrite(res, { type: 'tool_denied', toolName: schema.name, reason: decision.reason })
        return { error: msg, denied: true }
      }

      // Signal frontend to invoke the tool via postMessage relay
      const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      sseWrite(res, {
        type: 'tool_call',
        appSlug: app.slug,
        toolName: schema.name,
        correlationId,
        parameters: params,
      })

      // Wait for the frontend to relay the result back (via /api/apps/:id/invoke)
      const result = await waitForToolResult(correlationId, pendingCalls, 30_000)

      // Apply tool-output firewall before returning to LLM
      const sanitized = applyToolFirewall(result, schema)

      // Log the invocation
      supabaseAdmin.from('tool_invocations').insert({
        conversation_id: conversationId,
        app_id: app.id,
        tool_name: schema.name,
        parameters: params as Record<string, unknown>,
        result,
        status: 'success',
      }).then(({ error }) => { if (error) console.error('[tool log]', error.message) })

      return sanitized
    },
  })
}

function waitForToolResult(
  correlationId: string,
  pendingCalls: Map<string, (result: Record<string, unknown>) => void>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(correlationId)
      reject(new Error(`Tool invocation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    pendingCalls.set(correlationId, (result) => {
      clearTimeout(timer)
      pendingCalls.delete(correlationId)
      resolve(result)
    })
  })
}

// Global pending call registry (per-server; in production use Redis)
const globalPendingCalls = new Map<string, (result: Record<string, unknown>) => void>()

export { globalPendingCalls }

/**
 * POST /api/chat
 * Two-phase routing: classify intent → inject only matched app's tools → stream response.
 */
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const parsed = ChatRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      sseWrite(res, { type: 'error', message: 'Invalid request body' })
      res.end()
      return
    }

    const { message, conversationId: existingConvId } = parsed.data
    const userId = req.userId!

    // ── Conversation setup ──────────────────────────────────
    let conversationId = existingConvId

    if (!conversationId) {
      const { data: newConv, error } = await supabaseAdmin
        .from('conversations')
        .insert({ user_id: userId, title: message.slice(0, 60) })
        .select('id').single()
      if (error) throw createError(error.message, 500)
      conversationId = newConv.id
    } else {
      const { data: conv } = await supabaseAdmin
        .from('conversations').select('id')
        .eq('id', conversationId).eq('user_id', userId).single()
      if (!conv) {
        sseWrite(res, { type: 'error', message: 'Conversation not found' })
        res.end()
        return
      }
    }

    // Persist user message
    const { data: userMsg } = await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'user', content: message })
      .select('id').single()

    sseWrite(res, { type: 'start', conversationId, messageId: userMsg?.id })

    // ── Load history ────────────────────────────────────────
    const { data: history } = await supabaseAdmin
      .from('messages').select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50)

    const messages = (history || []).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
    }))

    // ── Phase 1: Intent Classification ──────────────────────
    const { data: allApps } = await supabaseAdmin
      .from('app_registrations')
      .select('*').eq('status', 'active')

    const apps = (allApps || []) as AppRegistration[]
    const matchedSlug = await classifyIntent(message, apps)
    const matchedApp = matchedSlug ? apps.find(a => a.slug === matchedSlug) : null

    if (matchedSlug) {
      sseWrite(res, { type: 'intent_classified', appSlug: matchedSlug })
    }

    // ── Phase 2: Build tool definitions for matched app only ─
    const tools: Record<string, ReturnType<typeof tool>> = {}

    if (matchedApp) {
      for (const toolSchema of matchedApp.tools) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools[toolSchema.name] = buildAITool(toolSchema, matchedApp, userId, conversationId!, res, globalPendingCalls) as any
      }
    }

    // ── Stream AI response ───────────────────────────────────
    let assistantContent = ''

    const streamResult = await streamText({
      model: openai(DEFAULT_MODEL),
      system: SYSTEM_PROMPT + (matchedApp
        ? `\n\nThe user is working with the "${matchedApp.name}" app. Use its tools to help them.`
        : ''),
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxTokens: 1024,
      temperature: 0.7,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          assistantContent += chunk.textDelta
          sseWrite(res, { type: 'delta', content: chunk.textDelta })
        }
      },
    })

    await streamResult.text

    // Persist assistant message
    const { data: assistantMsg } = await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: assistantContent })
      .select('id').single()

    await supabaseAdmin.from('conversations')
      .update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

    sseWrite(res, { type: 'done', conversationId, messageId: assistantMsg?.id })
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stream error'
    sseWrite(res, { type: 'error', message })
    res.end()
    console.error('[chat SSE error]', err)
  }
})

/**
 * POST /api/chat/tool-result
 * Frontend relays tool results back here after executing via postMessage.
 */
router.post('/tool-result', async (req: AuthenticatedRequest, res) => {
  const { correlationId, result } = req.body

  if (!correlationId) {
    res.status(400).json({ error: 'correlationId required' })
    return
  }

  const resolver = globalPendingCalls.get(correlationId)
  if (resolver) {
    resolver(result || {})
    res.json({ received: true })
  } else {
    res.status(404).json({ error: 'No pending call with that correlationId' })
  }
})

export default router

// ── Helper: build a minimal Zod schema from JSON Schema ────
function buildZodFromJsonSchema(schema: { type?: string; properties?: Record<string, { type?: string; description?: string }>; required?: string[] }): z.ZodTypeAny {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return z.object({})
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(schema.required || [])

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodTypeAny

    switch (prop.type) {
      case 'string':  zodType = z.string(); break
      case 'number':  zodType = z.number(); break
      case 'boolean': zodType = z.boolean(); break
      case 'array':   zodType = z.array(z.unknown()); break
      default:        zodType = z.unknown()
    }

    if (prop.description) zodType = zodType.describe(prop.description)
    shape[key] = required.has(key) ? zodType : zodType.optional()
  }

  return z.object(shape)
}
