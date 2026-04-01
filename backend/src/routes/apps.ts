import { Router } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth'
import { supabaseAdmin } from '../services/supabase'
import { createError } from '../middleware/errorHandler'

const router = Router()
router.use(requireAuth)

/**
 * GET /api/apps
 * List all active registered apps
 */
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_registrations')
      .select('id, name, slug, description, icon_url, iframe_url, auth_type, tools, status')
      .eq('status', 'active')
      .order('name')

    if (error) throw createError(error.message, 500)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/apps/:id
 * Get full app details including tool schemas
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_registrations')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !data) throw createError('App not found', 404)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/apps
 * Register a new app (admin only — no RBAC in MVP, uses service role)
 */
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, slug, description, iframe_url, auth_type, tools, icon_url, webhook_url } = req.body

    if (!name || !slug || !description || !iframe_url) {
      throw createError('name, slug, description, and iframe_url are required', 400)
    }

    const { data, error } = await supabaseAdmin
      .from('app_registrations')
      .insert({ name, slug, description, iframe_url, auth_type: auth_type || 'internal', tools: tools || [], icon_url, webhook_url })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') throw createError(`App with slug "${slug}" already exists`, 409)
      throw createError(error.message, 500)
    }

    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/apps/:id
 * Update an app registration
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_registrations')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw createError(error.message, 500)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

export default router
