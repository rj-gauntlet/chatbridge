import { Router } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth'
import { supabaseAdmin } from '../services/supabase'
import { createError } from '../middleware/errorHandler'

const router = Router()

/**
 * GET /api/oauth/:app/authorize
 * Start OAuth flow — returns the authorization URL
 */
router.get('/:app/authorize', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { app } = req.params

    const { data: appReg, error } = await supabaseAdmin
      .from('app_registrations')
      .select('oauth_config, slug')
      .eq('slug', app)
      .eq('auth_type', 'oauth2')
      .single()

    if (error || !appReg) throw createError(`No OAuth app registered with slug "${app}"`, 404)

    const config = appReg.oauth_config as {
      auth_url: string
      client_id: string
      scopes: string[]
    }

    if (!config) throw createError('App has no OAuth config', 500)

    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/${app}/callback`

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.client_id,
      scope: config.scopes.join(' '),
      redirect_uri: redirectUri,
      state: `${req.userId}|${app}`,
    })

    res.json({ authUrl: `${config.auth_url}?${params.toString()}` })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/oauth/:app/callback
 * Handle OAuth redirect — exchange code for tokens, store them
 */
router.get('/:app/callback', async (req, res, next) => {
  try {
    const { app } = req.params
    const { code, state, error: oauthError } = req.query

    if (oauthError) throw createError(`OAuth error: ${oauthError}`, 400)
    if (!code || !state) throw createError('Missing code or state', 400)

    // Parse state
    const [userId, appSlug] = (state as string).split('|')
    if (!userId || appSlug !== app) throw createError('Invalid state parameter', 400)

    // Get app config
    const { data: appReg } = await supabaseAdmin
      .from('app_registrations')
      .select('id, oauth_config')
      .eq('slug', app)
      .single()

    if (!appReg) throw createError('App not found', 404)

    const config = appReg.oauth_config as {
      token_url: string
      client_id: string
    }

    const clientSecret = app === 'spotify' ? process.env.SPOTIFY_CLIENT_SECRET : null
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/oauth/${app}/callback`

    // Exchange code for tokens
    const tokenRes = await fetch(config.token_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.client_id}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      throw createError(`Token exchange failed: ${body}`, 400)
    }

    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null

    // Upsert tokens
    const { error: upsertErr } = await supabaseAdmin
      .from('oauth_tokens')
      .upsert({
        user_id: userId,
        app_id: appReg.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: expiresAt,
        scopes: tokens.scope?.split(' ') || [],
      }, { onConflict: 'user_id,app_id' })

    if (upsertErr) throw createError(upsertErr.message, 500)

    // Redirect back to frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    res.redirect(`${frontendUrl}?oauth_success=${app}`)
  } catch (err) {
    next(err)
  }
})

export default router
