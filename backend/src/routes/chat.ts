import { generateText, tool } from 'ai'
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
    console.log('[chat] sent start event for conversation:', conversationId)

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

    // ── Generate AI response ─────────────────────────────────
    // Note: Using generateText (not streamText) — Railway's network proxy
    // buffers chunked/SSE responses from OpenAI, causing streamText to hang.
    // We collect the full response then emit delta + done events.
    console.log('[chat] calling generateText, model:', DEFAULT_MODEL)

    const genController = new AbortController()
    const genTimer = setTimeout(() => {
      console.log('[chat] generateText timed out after 60s, aborting')
      genController.abort()
    }, 60_000)

    // Build app-specific system prompt addon
    let appSystemAddon = matchedApp
      ? `\n\nThe user is working with the "${matchedApp.name}" app. Use its tools to help them.`
      : ''

    if (matchedApp?.slug === 'chess') {
      appSystemAddon += `

CHESS APP RULES — follow these exactly:
1. To start a game: call start_game with color="b" if the user wants Black, color="w" for White (default).
2. CRITICAL — When the user specifies ANY move (e.g. "e4", "nf6", "Nf6", "knight to f6", "ng4", "castle", etc.) you MUST call make_move with the correct {from, to} squares BEFORE saying anything. Never narrate a move without calling make_move first. If you are unsure of the piece's current square, call get_board_state first to find it.
3. make_move takes algebraic square coordinates (e.g. from:"g8", to:"f6" for Nf6). Convert SAN notation to from/to: use the current board state to find which piece is on which square.
4. make_move returns BOTH playerMove AND aiMove — always report both moves, but do so naturally. Comment on the player's move (strategy, threat, opening theory, etc.) and briefly explain your response. Sound like an engaged chess coach, not a log file. Example: "Nice — Nf3 develops your knight and controls the center. I'll counter with d5, challenging your pawn." Vary your phrasing each turn.
5. If aiMove is null or missing, the game ended — report the outcome.
6. If start_game returns aiFirstMove, tell the user what the AI played and ask for their move.
7. Never guess board positions — always derive from/to from the fen or moveHistory in tool results.
8. If it is not the player's turn (checkmate/draw), do not call make_move — explain the game state.
9. NEVER say "You played X" or "I will respond with Y" without having called make_move first. The tool call is mandatory for every move.`
    }

    if (matchedApp?.slug === 'spotify') {
      appSystemAddon += `

SPOTIFY PLAYER RULES — follow these exactly:
1. You control ALL music selection — the user has no search bar. They request songs through chat and you use tools to play them.
2. To play a song: call play_track with a search query (artist name, song title, or both). ALWAYS call the tool before confirming playback.
3. To add to queue without interrupting: call queue_track. Never call play_track when the user just wants to add to the queue.
4. CRITICAL — If play_track or queue_track returns blocked='explicit', the track was blocked by the explicit content filter. Tell the user naturally: "That track has explicit content and your filter is on — want me to find a clean version instead?" Never attempt to play a blocked track again without user direction.
5. Use pause_playback, resume_playback, skip_to_next, set_volume for controls. Call the tool first, then confirm.
6. Never describe what is playing without calling a tool first — no inventing track names or status.
7. Sound natural and conversational — you're a music-savvy assistant, not a command executor.`
    }

    if (matchedApp?.slug === 'desmos') {
      appSystemAddon += `

DESMOS GRAPHING CALCULATOR RULES — follow these exactly:
1. Use add_expression to plot functions, equations, and inequalities. Always use LaTeX notation (e.g. "y=x^2", "y=\\sin(x)", "x^2+y^2=r^2").
2. Every add_expression call returns an "id". Store and reuse these ids if you need to remove or update a specific expression later.
3. To update an expression, call add_expression with the same id and the new latex — do not remove and re-add unless the user asked to replace.
4. Call get_expressions before removing if you are unsure of current ids on the graph.
5. Use set_viewport to frame a region of interest (e.g. when graphing y=e^x, set right:5, top:100).
6. Use clear_graph only when the user asks to start fresh or clear everything.
7. When graphing a family of curves, add them in separate add_expression calls so each gets its own color.
8. Never invent results — only describe what the tool returns. If the user asks what is graphed, call get_expressions first.
9. LaTeX reminder: trig/math functions need a backslash prefix: \\sin, \\cos, \\tan, \\ln, \\log, \\sqrt{x}, \\frac{a}{b}, \\pi, \\theta, \\infty. Example: "y=\\sin(x)" not "y=sin(x)".`
    }

    const genResult = await generateText({
      model: openai(DEFAULT_MODEL),
      system: SYSTEM_PROMPT + appSystemAddon,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: 5, // player move → AI responds → tool result → follow-up → final text
      maxTokens: 1024,
      temperature: 0.7,
      abortSignal: genController.signal,
    })
    clearTimeout(genTimer)

    const assistantContent = genResult.text || ''
    console.log('[chat] generateText completed, content length:', assistantContent.length)

    // Emit the full response as a single delta so the frontend renders it
    if (assistantContent) {
      sseWrite(res, { type: 'delta', content: assistantContent })
    }

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
