import { Router } from 'express'
import { supabaseAnon } from '../services/supabase'
import { createError } from '../middleware/errorHandler'
import type { AuthenticatedRequest } from '../middleware/auth'
import { requireAuth } from '../middleware/auth'

const router = Router()

/**
 * POST /api/auth/register
 * Register a new user via Supabase Auth
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      throw createError('email and password are required', 400)
    }

    const { data, error } = await supabaseAnon.auth.signUp({ email, password })
    if (error) throw createError(error.message, 400)

    res.status(201).json({
      user: { id: data.user?.id, email: data.user?.email },
      session: data.session,
      message: data.user?.email_confirmed_at
        ? 'Registered successfully'
        : 'Check your email to confirm your account',
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/auth/login
 * Log in with email + password
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      throw createError('email and password are required', 400)
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password })
    if (error) throw createError(error.message, 401)

    res.json({
      user: { id: data.user?.id, email: data.user?.email },
      session: data.session,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/auth/logout
 * Log out the current user
 */
router.post('/logout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { error } = await req.supabase!.auth.signOut()
    if (error) throw createError(error.message, 400)
    res.json({ message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ userId: req.userId, email: req.userEmail })
})

export default router
