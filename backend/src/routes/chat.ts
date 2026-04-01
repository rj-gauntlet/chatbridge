import { streamText, tool } from 'ai'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth'
import { createError } from '../middleware/errorHandler'
import { openai, DEFAULT_MODEL, SYSTEM_PROMPT } from '../services/openai'
import { supabaseAdmin } from '../services/supabase'

const router = Router()
router.use(requireAuth)

// ── Input validation ───────────────────────────────────────
const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
})

// ── SSE helper ────────────────────────────────────────────
function sseWrite(res: Response, event: object) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

/**
 * POST /api/chat
 * Accepts a user message, streams the AI response via SSE.
 * Creates a new conversation if conversationId not provided.
 */
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  // Set SSE headers
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

    // ── Conversation management ──────────────────────────
    let conversationId = existingConvId

    if (!conversationId) {
      const { data: newConv, error: convErr } = await supabaseAdmin
        .from('conversations')
        .insert({ user_id: userId, title: message.slice(0, 60) })
        .select('id')
        .single()
      if (convErr) throw createError(convErr.message, 500)
      conversationId = newConv.id
    } else {
      // Verify conversation belongs to user
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .single()
      if (!conv) {
        sseWrite(res, { type: 'error', message: 'Conversation not found' })
        res.end()
        return
      }
    }

    // ── Persist user message ─────────────────────────────
    const { data: userMsg, error: userMsgErr } = await supabaseAdmin
      .from('messages')
      .insert({ conversation_id: conversationId, role: 'user', content: message })
      .select('id')
      .single()
    if (userMsgErr) throw createError(userMsgErr.message, 500)

    sseWrite(res, { type: 'start', conversationId, messageId: userMsg.id })

    // ── Load conversation history ────────────────────────
    const { data: history } = await supabaseAdmin
      .from('messages')
      .select('role, content, tool_call_id, tool_name')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50)

    const messages = (history || []).map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
    }))

    // ── Stream AI response ───────────────────────────────
    let assistantContent = ''

    const result = await streamText({
      model: openai(DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools: {
        // Phase 1: basic chat only. Tool schemas injected in Phase 2.
        ping: tool({
          description: 'No-op tool for testing',
          parameters: z.object({}),
          execute: async () => ({ pong: true }),
        }),
      },
      maxTokens: 1024,
      temperature: 0.7,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          assistantContent += chunk.textDelta
          sseWrite(res, { type: 'delta', content: chunk.textDelta })
        }
      },
    })

    // Wait for stream to finish
    await result.text

    // ── Persist assistant response ───────────────────────
    const { data: assistantMsg } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantContent,
      })
      .select('id')
      .single()

    // Update conversation updated_at
    await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    sseWrite(res, {
      type: 'done',
      conversationId,
      messageId: assistantMsg?.id,
    })
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stream error'
    sseWrite(res, { type: 'error', message })
    res.end()
    // Don't pass to errorHandler since response already started
    console.error('[chat SSE error]', err)
  }
})

export default router
