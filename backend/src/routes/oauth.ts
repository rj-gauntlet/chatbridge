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

// ── Spotify API proxy ────────────────────────────────────────────────────────

async function getSpotifyToken(userId: string, appId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('app_id', appId)
    .single()

  if (!data) return null

  // Refresh if expired
  if (data.expires_at && new Date(data.expires_at) < new Date(Date.now() + 60_000)) {
    if (!data.refresh_token) return null

    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }),
    })

    if (!refreshRes.ok) return null

    const refreshed = await refreshRes.json() as { access_token: string; expires_in: number }
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

    await supabaseAdmin
      .from('oauth_tokens')
      .update({ access_token: refreshed.access_token, expires_at: expiresAt })
      .eq('user_id', userId)
      .eq('app_id', appId)

    return refreshed.access_token
  }

  return data.access_token
}

/**
 * GET /api/oauth/spotify/status
 * Check if user has connected their Spotify account
 */
router.get('/spotify/status', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { data: appReg } = await supabaseAdmin
      .from('app_registrations').select('id').eq('slug', 'spotify').single()

    if (!appReg) return res.json({ connected: false })

    const { data } = await supabaseAdmin
      .from('oauth_tokens')
      .select('id, expires_at')
      .eq('user_id', req.userId!)
      .eq('app_id', appReg.id)
      .single()

    res.json({ connected: !!data, expired: data?.expires_at ? new Date(data.expires_at) < new Date() : false })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/oauth/spotify/token
 * Return current Spotify access token for Web Playback SDK initialization.
 * Backend handles refresh automatically via getSpotifyToken().
 */
router.get('/spotify/token', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { data: appReg } = await supabaseAdmin
      .from('app_registrations').select('id').eq('slug', 'spotify').single()

    if (!appReg) throw createError('Spotify app not registered', 404)

    if (!process.env.SPOTIFY_CLIENT_ID) {
      return res.json({ token: null, mock: true })
    }

    const token = await getSpotifyToken(req.userId!, appReg.id)
    if (!token) throw createError('Not connected to Spotify — please reconnect', 401)

    res.json({ token })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/oauth/spotify/search?q=...&limit=10
 * Proxy search to Spotify API
 */
router.get('/spotify/search', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const q = req.query.q as string
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50)

    if (!q) throw createError('q parameter required', 400)

    const { data: appReg } = await supabaseAdmin
      .from('app_registrations').select('id').eq('slug', 'spotify').single()

    if (!appReg) throw createError('Spotify app not registered', 404)

    // If no Spotify credentials configured, return mock data
    if (!process.env.SPOTIFY_CLIENT_ID) {
      return res.json({
        tracks: getMockTracks(q, limit),
        mock: true,
      })
    }

    const token = await getSpotifyToken(req.userId!, appReg.id)
    if (!token) throw createError('Not connected to Spotify', 401)

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=${limit}`
    const spotifyRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

    if (!spotifyRes.ok) throw createError('Spotify API error', spotifyRes.status)

    const data = await spotifyRes.json() as {
      tracks: {
        items: Array<{
          id: string
          name: string
          uri: string
          artists: Array<{ name: string }>
          album: { name: string; images: Array<{ url: string }> }
          duration_ms: number
          preview_url: string | null
          external_urls: { spotify: string }
        }>
      }
    }

    const tracks = data.tracks.items.map(t => ({
      id: t.id,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      album: t.album.name,
      durationMs: t.duration_ms,
      url: t.external_urls.spotify,
      previewUrl: t.preview_url,
      uri: t.uri,
      albumArt: t.album.images[0]?.url ?? '',
    }))

    res.json({ tracks })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/oauth/spotify/playlist
 * Create a new Spotify playlist for the user
 */
router.post('/spotify/playlist', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { name, description, trackIds } = req.body
    if (!name) throw createError('name required', 400)

    const { data: appReg } = await supabaseAdmin
      .from('app_registrations').select('id').eq('slug', 'spotify').single()

    if (!appReg) throw createError('Spotify app not registered', 404)

    // Mock mode if no credentials
    if (!process.env.SPOTIFY_CLIENT_ID) {
      return res.json({
        playlistId: `mock-${Date.now()}`,
        name,
        url: `https://open.spotify.com/playlist/mock`,
        trackCount: (trackIds || []).length,
        mock: true,
      })
    }

    const token = await getSpotifyToken(req.userId!, appReg.id)
    if (!token) throw createError('Not connected to Spotify', 401)

    // Get user profile first
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!profileRes.ok) throw createError('Failed to get Spotify profile', 500)
    const profile = await profileRes.json() as { id: string }

    // Create playlist
    const createRes = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || '', public: false }),
    })
    if (!createRes.ok) throw createError('Failed to create playlist', 500)
    const playlist = await createRes.json() as { id: string; name: string; external_urls: { spotify: string } }

    // Add tracks if provided
    if (trackIds?.length > 0) {
      const uris = (trackIds as string[]).map((id) => `spotify:track:${id}`)
      await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris }),
      })
    }

    res.json({
      playlistId: playlist.id,
      name: playlist.name,
      url: playlist.external_urls.spotify,
      trackCount: trackIds?.length || 0,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/oauth/spotify/playlists
 * Get user's Spotify playlists
 */
router.get('/spotify/playlists', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { data: appReg } = await supabaseAdmin
      .from('app_registrations').select('id').eq('slug', 'spotify').single()

    if (!appReg) throw createError('Spotify app not registered', 404)

    if (!process.env.SPOTIFY_CLIENT_ID) {
      return res.json({ playlists: getMockPlaylists(), mock: true })
    }

    const token = await getSpotifyToken(req.userId!, appReg.id)
    if (!token) throw createError('Not connected to Spotify', 401)

    const spotifyRes = await fetch('https://api.spotify.com/v1/me/playlists?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!spotifyRes.ok) throw createError('Spotify API error', 500)
    const data = await spotifyRes.json() as { items: Array<{ id: string; name: string; tracks: { total: number }; external_urls: { spotify: string } }> }

    res.json({
      playlists: data.items.map(p => ({ id: p.id, name: p.name, trackCount: p.tracks.total, url: p.external_urls.spotify })),
    })
  } catch (err) {
    next(err)
  }
})

// ── Mock data helpers ────────────────────────────────────────────────────────

function getMockTracks(query: string, limit: number) {
  const base = [
    { id: 'mock1', name: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', durationMs: 200040, previewUrl: null, uri: 'spotify:track:mock1', albumArt: '' },
    { id: 'mock2', name: 'Shape of You', artist: 'Ed Sheeran', album: '÷ (Divide)', durationMs: 234000, previewUrl: null, uri: 'spotify:track:mock2', albumArt: '' },
    { id: 'mock3', name: 'Stay', artist: 'The Kid LAROI, Justin Bieber', album: 'F*CK LOVE 3+', durationMs: 141000, previewUrl: null, uri: 'spotify:track:mock3', albumArt: '' },
    { id: 'mock4', name: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', durationMs: 203000, previewUrl: null, uri: 'spotify:track:mock4', albumArt: '' },
    { id: 'mock5', name: 'Peaches', artist: 'Justin Bieber', album: 'Justice', durationMs: 198000, previewUrl: null, uri: 'spotify:track:mock5', albumArt: '' },
    { id: 'mock6', name: 'Good 4 U', artist: 'Olivia Rodrigo', album: 'SOUR', durationMs: 178000, previewUrl: null, uri: 'spotify:track:mock6', albumArt: '' },
    { id: 'mock7', name: 'Kiss Me More', artist: 'Doja Cat', album: 'Planet Her', durationMs: 208000, previewUrl: null, uri: 'spotify:track:mock7', albumArt: '' },
    { id: 'mock8', name: 'Montero', artist: 'Lil Nas X', album: 'Montero', durationMs: 137000, previewUrl: null, uri: 'spotify:track:mock8', albumArt: '' },
    { id: 'mock9', name: 'Bad Habits', artist: 'Ed Sheeran', album: '=', durationMs: 231000, previewUrl: null, uri: 'spotify:track:mock9', albumArt: '' },
    { id: 'mock10', name: 'Industry Baby', artist: 'Lil Nas X & Jack Harlow', album: 'Montero', durationMs: 212000, previewUrl: null, uri: 'spotify:track:mock10', albumArt: '' },
  ]
  return base.filter(t =>
    query === '' || t.name.toLowerCase().includes(query.toLowerCase()) || t.artist.toLowerCase().includes(query.toLowerCase())
  ).slice(0, limit).concat(
    query && !base.some(t => t.name.toLowerCase().includes(query.toLowerCase()))
      ? [{ id: 'mock-q', name: `${query} (mock result)`, artist: 'Various Artists', album: 'Compilation', durationMs: 195000, previewUrl: null, uri: 'spotify:track:mock-q', albumArt: '' }]
      : []
  ).slice(0, limit)
}

function getMockPlaylists() {
  return [
    { id: 'pl1', name: 'My Favorites', trackCount: 24, url: 'https://open.spotify.com/playlist/mock1' },
    { id: 'pl2', name: 'Workout Mix', trackCount: 15, url: 'https://open.spotify.com/playlist/mock2' },
    { id: 'pl3', name: 'Chill Vibes', trackCount: 32, url: 'https://open.spotify.com/playlist/mock3' },
  ]
}

export default router
