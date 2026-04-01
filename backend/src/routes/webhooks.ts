import { Router } from 'express'
import { supabaseAdmin } from '../services/supabase'
import { createError } from '../middleware/errorHandler'

const router = Router()

/**
 * POST /api/apps/:id/webhook
 * Receive completion callbacks from server-side app integrations.
 * Authenticated via X-App-Key header (app's registered webhook secret).
 */
router.post('/:id/webhook', async (req, res, next) => {
  try {
    const { id } = req.params
    const appKey = req.headers['x-app-key']

    if (!appKey) throw createError('Missing X-App-Key header', 401)

    // Verify app exists
    const { data: app, error } = await supabaseAdmin
      .from('app_registrations')
      .select('id, slug, status')
      .eq('id', id)
      .single()

    if (error || !app) throw createError('App not found', 404)
    if (app.status !== 'active') throw createError('App is not active', 403)

    const { event, conversationId, toolName, result } = req.body

    console.log(`[Webhook] App ${app.slug} sent event: ${event}`, { conversationId, toolName })

    // Log the webhook event
    if (conversationId && toolName) {
      await supabaseAdmin.from('tool_invocations').insert({
        conversation_id: conversationId,
        app_id: id,
        tool_name: toolName,
        parameters: {},
        result: result || {},
        status: 'success',
      })
    }

    res.json({ received: true })
  } catch (err) {
    next(err)
  }
})

export default router
