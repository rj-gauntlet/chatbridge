import { Router } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth'
import { supabaseAdmin } from '../services/supabase'
import { createError } from '../middleware/errorHandler'

const router = Router()
router.use(requireAuth)

/**
 * GET /api/conversations
 * List all conversations for the current user
 */
router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, title, created_at, updated_at')
      .eq('user_id', req.userId!)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) throw createError(error.message, 500)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/conversations
 * Create a new conversation
 */
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { title = 'New Conversation' } = req.body

    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert({ user_id: req.userId!, title })
      .select()
      .single()

    if (error) throw createError(error.message, 500)
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/conversations/:id
 * Get a conversation with its messages
 */
router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params

    // Verify ownership
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.userId!)
      .single()

    if (convErr || !conv) throw createError('Conversation not found', 404)

    // Get messages
    const { data: messages, error: msgErr } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })

    if (msgErr) throw createError(msgErr.message, 500)

    res.json({ ...conv, messages: messages || [] })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/conversations/:id
 * Delete a conversation (cascades to messages)
 */
router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params

    const { error } = await supabaseAdmin
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId!)

    if (error) throw createError(error.message, 500)
    res.json({ message: 'Conversation deleted' })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /api/conversations/:id
 * Update conversation title
 */
router.patch('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { id } = req.params
    const { title } = req.body
    if (!title) throw createError('title is required', 400)

    const { data, error } = await supabaseAdmin
      .from('conversations')
      .update({ title })
      .eq('id', id)
      .eq('user_id', req.userId!)
      .select()
      .single()

    if (error) throw createError(error.message, 500)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

export default router
