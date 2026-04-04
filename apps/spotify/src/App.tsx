import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiUrl, getExplicitFilter, getToken, initBridge, registerTool, sendStateUpdate } from './bridge'

// ── Spotify Web Playback SDK type declarations ─────────────────────────────

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: {
      Player: new (config: SpotifyPlayerConfig) => SpotifyPlayer
    }
  }
}

interface SpotifyPlayerConfig {
  name: string
  getOAuthToken: (cb: (token: string) => void) => void
  volume?: number
}

interface SpotifyPlayer {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: (event: string, cb: (data: any) => void) => boolean  // eslint-disable-line @typescript-eslint/no-explicit-any
  getCurrentState: () => Promise<SpotifyPlaybackState | null>
  setVolume: (vol: number) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  nextTrack: () => Promise<void>
}

interface SpotifyPlaybackState {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: {
      id: string
      name: string
      uri: string
      artists: Array<{ name: string }>
      album: { name: string; images: Array<{ url: string }> }
    }
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

interface Track {
  id: string
  name: string
  artist: string
  album: string
  albumArt: string
  previewUrl: string | null
  uri: string
  explicit?: boolean
}

type AppView = 'disconnected' | 'connecting' | 'player'

// ── API helper ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit) {
  const base = getApiUrl()
  const token = getToken()
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Route album art through the backend proxy to avoid sandboxed-iframe CORS issues */
function proxyAlbumArt(url: string): string {
  if (!url) return ''
  const base = getApiUrl()
  if (!base) return url
  return `${base}/api/oauth/spotify/albumart?url=${encodeURIComponent(url)}`
}

// ── Constants ──────────────────────────────────────────────────────────────

const GREEN = '#1db954'
const GREEN_DARK = '#169c46'
const BG = '#121212'
const SURFACE = '#181818'
const SURFACE2 = '#282828'
const SURFACE3 = '#333333'
const DIM = '#b3b3b3'
const DIM2 = '#727272'

// ── SVG Icons ──────────────────────────────────────────────────────────────

function IconShuffle({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? GREEN : DIM}>
      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  )
}

function IconPrev() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={DIM}>
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
    </svg>
  )
}

function IconNext() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={DIM}>
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
    </svg>
  )
}

function IconPlay() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#000">
      <path d="M8 5v14l11-7z"/>
    </svg>
  )
}

function IconPause() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#000">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
    </svg>
  )
}

function IconRepeat({ mode }: { mode: 0 | 1 | 2 }) {
  const color = mode > 0 ? GREEN : DIM
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={color}>
      {mode === 2 ? (
        // Repeat-one icon
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>
      ) : (
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
      )}
    </svg>
  )
}

function IconHeart({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? GREEN : 'none'} stroke={on ? GREEN : DIM} strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  )
}

function IconVolumeLow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={DIM}>
      <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
    </svg>
  )
}

function IconVolumeHigh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={DIM}>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  )
}

function IconQueue() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={DIM}>
      <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  // ── Display state ────────────────────────────────────────────────────────
  const [view, setView] = useState<AppView>('disconnected')
  const [connected, setConnected] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)     // 0–1
  const [duration, setDuration] = useState(0)     // ms
  const [volume, setVolume] = useState(80)
  const [queue, setQueue] = useState<Track[]>([])
  const [played, setPlayed] = useState<Track[]>([])
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [showQueue, setShowQueue] = useState(false)

  // Visual-only controls (wire up to Spotify API later)
  const [shuffleOn, setShuffleOn] = useState(false)
  const [repeatMode, setRepeatMode] = useState<0 | 1 | 2>(0)
  const [liked, setLiked] = useState(false)

  // ── Mutable refs ──────────────────────────────────────────────────────────
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectModeRef = useRef(false)
  const queueRef = useRef<Track[]>([])
  const volumeRef = useRef(80)
  const pendingPlayRef = useRef<Track | null>(null)
  const currentTrackRef = useRef<Track | null>(null)
  const connectedRef = useRef(false)
  const wasPlayingRef = useRef(false)
  // Forward ref to break circular dep between advanceQueue ↔ playTrackDirect
  const playTrackDirectRef = useRef<(t: Track) => Promise<'sdk' | 'preview' | 'error'>>(async () => 'error' as const)

  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { volumeRef.current = volume }, [volume])
  useEffect(() => { currentTrackRef.current = currentTrack }, [currentTrack])
  useEffect(() => { connectedRef.current = connected }, [connected])

  // ── Connect polling ───────────────────────────────────────────────────────

  const stopConnectPoll = useCallback(() => {
    if (connectPollRef.current) { clearInterval(connectPollRef.current); connectPollRef.current = null }
  }, [])

  const startConnectPoll = useCallback(() => {
    stopConnectPoll()
    connectPollRef.current = setInterval(async () => {
      try {
        const state = await apiFetch('/api/oauth/spotify/player')
        if (!state) return

        // Detect song end in Connect mode → auto-advance our queue
        if (wasPlayingRef.current && !state.is_playing && queueRef.current.length > 0) {
          wasPlayingRef.current = false
          const [next, ...rest] = queueRef.current
          queueRef.current = rest
          setQueue(rest)
          const finished = currentTrackRef.current
          if (finished) setPlayed(prev => [finished, ...prev.filter(p => p.id !== finished.id)].slice(0, 30))
          playTrackDirectRef.current(next).catch(() => {})
          return
        }
        wasPlayingRef.current = state.is_playing

        if (state.track) {
          setCurrentTrack(prev => {
            const t = state.track as { name: string; artist: string; album: string; albumArt: string; uri: string }
            if (!prev) return prev
            return {
              ...prev,
              name: t.name || prev.name,
              artist: t.artist || prev.artist,
              album: t.album || prev.album,
              albumArt: t.albumArt || prev.albumArt,
              uri: t.uri || prev.uri,
            }
          })
        }
        setIsPlaying(state.is_playing)
        if (state.duration_ms > 0) {
          setProgress(state.progress_ms / state.duration_ms)
          setDuration(state.duration_ms)
        }
      } catch { /* ignore poll errors */ }
    }, 1500)
  }, [stopConnectPoll])

  // ── Progress timer (preview mode) ────────────────────────────────────────

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null }
  }, [])

  const startProgressTimer = useCallback(() => {
    clearProgressTimer()
    progressTimerRef.current = setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      const dur = audio.duration || 30
      setProgress(audio.currentTime / dur)
      setDuration(dur * 1000)
      if (audio.ended) clearProgressTimer()
    }, 400)
  }, [clearProgressTimer])

  // ── Queue advance ─────────────────────────────────────────────────────────

  const advanceQueue = useCallback(() => {
    // Add finished track to history
    const finished = currentTrackRef.current
    if (finished) setPlayed(prev => [finished, ...prev.filter(p => p.id !== finished.id)].slice(0, 30))

    const q = queueRef.current
    if (q.length === 0) { setIsPlaying(false); clearProgressTimer(); return }
    const [next, ...rest] = q
    queueRef.current = rest
    setQueue(rest)
    // Use ref to avoid circular dep — playTrackDirect handles both preview & Connect mode
    playTrackDirectRef.current(next).catch(() => {})
  }, [clearProgressTimer])

  // ── Core play ─────────────────────────────────────────────────────────────

  const playTrackDirect = useCallback(async (track: Track): Promise<'sdk' | 'preview' | 'error'> => {
    // Only use the Web Playback SDK in-browser device — do NOT fall back to
    // fetching external Spotify devices (phones, computers, etc.).
    // In-browser = SDK device ID set by the 'ready' listener.
    // If no SDK device (free account or SDK not ready), go straight to preview.
    if (deviceIdRef.current) {
      try {
        const result = await apiFetch('/api/oauth/spotify/play', {
          method: 'PUT',
          body: JSON.stringify({ uri: track.uri, deviceId: deviceIdRef.current }),
        })
        if (result.success) {
          connectModeRef.current = true
          setCurrentTrack(track)
          setIsPlaying(true)
          setProgress(0)
          setDuration(0)
          startConnectPoll()
          return 'sdk'
        }
      } catch { /* fall through to preview */ }
    }
    connectModeRef.current = false

    if (!track.previewUrl) return 'error'

    if (!audioRef.current) {
      const audio = new Audio()
      audio.volume = volumeRef.current / 100
      audio.addEventListener('ended', advanceQueue)
      audioRef.current = audio
    }
    audioRef.current.src = track.previewUrl
    audioRef.current.currentTime = 0
    try {
      await audioRef.current.play()
      setCurrentTrack(track)
      setIsPlaying(true)
      setProgress(0)
      startProgressTimer()
      return 'preview'
    } catch (e: unknown) {
      if ((e as Error)?.name === 'NotAllowedError') {
        pendingPlayRef.current = track
        setNeedsUnlock(true)
        setCurrentTrack(track)
        return 'error'
      }
      return 'error'
    }
  }, [advanceQueue, startProgressTimer, startConnectPoll])

  // Keep the forward ref in sync so advanceQueue can call playTrackDirect without circular dep
  useEffect(() => { playTrackDirectRef.current = playTrackDirect }, [playTrackDirect])

  // ── SDK init ──────────────────────────────────────────────────────────────

  const initSpotifySdk = useCallback(async () => {
    let spotifyToken: string | null = null
    try {
      const data = await apiFetch('/api/oauth/spotify/token')
      spotifyToken = data.token
      if (!spotifyToken || spotifyToken === 'mock-spotify-token') return
    } catch { return }

    const createPlayer = () => {
      if (playerRef.current) { playerRef.current.disconnect(); playerRef.current = null; deviceIdRef.current = null }
      const player = new window.Spotify.Player({
        name: 'ChatBridge Player',
        getOAuthToken: async (cb) => {
          try { const d = await apiFetch('/api/oauth/spotify/token'); cb(d.token) }
          catch { cb(spotifyToken!) }
        },
        volume: volumeRef.current / 100,
      })
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id
        setIsPremium(true)
        setStatusMsg(null)
      })
      player.addListener('not_ready', () => { deviceIdRef.current = null })
      player.addListener('account_error', () => {
        setIsPremium(false)
        setStatusMsg('Spotify Premium required for full tracks — using 30-second previews')
      })
      player.addListener('authentication_error', () => {
        setIsPremium(false)
        setStatusMsg('Spotify auth error — please reconnect')
      })
      player.addListener('player_state_changed', (state: SpotifyPlaybackState | null) => {
        if (!state) return
        const t = state.track_window.current_track
        setCurrentTrack({
          id: t.id, name: t.name,
          artist: t.artists.map(a => a.name).join(', '),
          album: t.album.name,
          albumArt: t.album.images[0]?.url ?? '',
          previewUrl: null, uri: t.uri,
        })
        setIsPlaying(!state.paused)
        if (state.duration > 0) { setProgress(state.position / state.duration); setDuration(state.duration) }
      })
      player.connect()
      playerRef.current = player
    }

    if (window.Spotify) { createPlayer() }
    else {
      window.onSpotifyWebPlaybackSDKReady = createPlayer
      if (!document.getElementById('spotify-sdk-script')) {
        const script = document.createElement('script')
        script.id = 'spotify-sdk-script'
        script.src = 'https://sdk.scdn.co/spotify-player.js'
        document.head.appendChild(script)
      }
    }
  }, [])

  // ── Connection check ──────────────────────────────────────────────────────

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const data = await apiFetch('/api/oauth/spotify/status')
      const isConnected = !!(data.connected && !data.expired)
      setConnected(isConnected)
      if (isConnected) setView('player')
      return isConnected
    } catch { setConnected(false); return false }
  }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      const isConnected = await checkConnection()
      if (isConnected) initSpotifySdk()
    }, 200)
    return () => clearTimeout(timer)
  }, [checkConnection, initSpotifySdk])

  useEffect(() => {
    return () => {
      playerRef.current?.disconnect()
      audioRef.current?.pause()
      clearProgressTimer()
      stopConnectPoll()
    }
  }, [clearProgressTimer, stopConnectPoll])

  // ── OAuth connect ─────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    setView('connecting')
    try {
      const data = await apiFetch('/api/oauth/spotify/authorize')
      const popup = window.open(data.authUrl, 'spotify-auth', 'width=500,height=700')
      const timer = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(timer)
          const ok = await checkConnection()
          if (ok) initSpotifySdk()
        }
      }, 1000)
    } catch {
      setConnected(true)
      setView('player')
      setStatusMsg('Running in demo mode — Spotify not configured')
    }
  }, [checkConnection, initSpotifySdk])

  // ── Tool handlers ─────────────────────────────────────────────────────────

  const handlePlayTrack = useCallback(async (params: Record<string, unknown>) => {
    const query = String(params.query || '')
    if (!query) return { success: false, error: 'query is required' }
    setStatusMsg(`Searching for "${query}"…`)
    let data: { tracks: Track[]; mock?: boolean; needsReconnect?: boolean }
    try {
      data = await apiFetch(`/api/oauth/spotify/search?q=${encodeURIComponent(query)}&limit=5`)
    } catch {
      setStatusMsg('⚠️ Spotify connection lost — tap "Connect" to reconnect')
      return { success: false, error: 'Spotify search unavailable — please reconnect your Spotify account' }
    }
    const allTracks = (data.tracks || []) as Track[]
    if (allTracks.length === 0) { setStatusMsg(`No results for "${query}"`); return { success: false, error: 'No tracks found' } }

    // Explicit content filter — strip all explicit results, prefer a clean version
    const tracks = getExplicitFilter() ? allTracks.filter(t => !t.explicit) : allTracks
    if (tracks.length === 0) {
      const blocked = allTracks[0]
      setStatusMsg(`🚫 "${blocked.name}" — explicit content blocked`)
      return {
        success: false,
        blocked: 'explicit',
        track: blocked.name,
        artist: blocked.artist,
        message: `All results for "${query}" contain explicit content and cannot be played while the explicit filter is enabled. Try a different song or turn off the filter.`,
      }
    }
    const track = tracks[0]

    if (data.needsReconnect) {
      setConnected(false); setView('disconnected')
      setStatusMsg('🔑 Spotify session expired — tap "Connect Spotify" to reconnect')
      return { success: true, track: track.name, artist: track.artist, album: track.album, mode: 'info', message: `Found "${track.name}" by ${track.artist}. Audio is unavailable — Spotify session expired.` }
    }
    setStatusMsg(null)
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; clearProgressTimer() }
    let playedTrack: Track | null = null
    let mode: 'sdk' | 'preview' | 'error' = 'error'
    for (const candidate of tracks) {
      mode = await playTrackDirect(candidate)
      if (mode !== 'error' || pendingPlayRef.current) { playedTrack = candidate; break }
    }
    if (!playedTrack || (mode === 'error' && !pendingPlayRef.current)) {
      setStatusMsg('⚠️ Open Spotify on your phone or computer, then try again')
      return { success: false, error: 'Could not play — make sure Spotify is open on one of your devices, then try again' }
    }
    const t = playedTrack
    setLiked(false)
    setPlayed(prev => [t, ...prev.filter(p => p.id !== t.id)].slice(0, 30))
    sendStateUpdate({ playing: t.name, artist: t.artist, mode })
    return {
      success: mode !== 'error', track: t.name, artist: t.artist, album: t.album, mode,
      message: mode === 'sdk'
        ? `Now playing on Spotify: ${t.name} by ${t.artist}`
        : mode === 'preview'
          ? `Playing 30-second preview: ${t.name} by ${t.artist} (open Spotify on any device for full track)`
          : 'Track found but needs audio permission — tap the player to start',
    }
  }, [clearProgressTimer, playTrackDirect])

  const handlePause = useCallback(async (_params?: Record<string, unknown>) => {
    if (connectModeRef.current) {
      await apiFetch('/api/oauth/spotify/pause', { method: 'PUT' }).catch(() => {})
    } else {
      playerRef.current?.pause().catch(() => {})
      if (audioRef.current) { audioRef.current.pause(); clearProgressTimer() }
    }
    setIsPlaying(false)
    return { success: true }
  }, [clearProgressTimer])

  const handleResume = useCallback(async (_params?: Record<string, unknown>) => {
    if (connectModeRef.current) {
      await apiFetch('/api/oauth/spotify/resume', { method: 'PUT' }).catch(() => {})
    } else if (playerRef.current) {
      await playerRef.current.resume().catch(() => {})
    } else if (audioRef.current?.src) {
      await audioRef.current.play().catch(() => {})
      startProgressTimer()
    }
    setIsPlaying(true)
    return { success: true }
  }, [startProgressTimer])

  const handleSetVolume = useCallback(async (params: Record<string, unknown>) => {
    const level = Math.max(0, Math.min(100, Number(params.level) || 0))
    volumeRef.current = level
    setVolume(level)
    playerRef.current?.setVolume(level / 100).catch(() => {})
    if (audioRef.current) audioRef.current.volume = level / 100
    if (connectedRef.current) {
      apiFetch('/api/oauth/spotify/volume', {
        method: 'PUT',
        body: JSON.stringify({ volume_percent: level }),
      }).catch(() => {})
    }
    return { success: true, level }
  }, [])

  const handleSkipNext = useCallback(async (_params?: Record<string, unknown>) => {
    if (connectModeRef.current) {
      await apiFetch('/api/oauth/spotify/next', { method: 'POST' }).catch(() => {})
      return { success: true, track: 'skipped on device' }
    }
    if (playerRef.current && deviceIdRef.current) {
      await playerRef.current.nextTrack().catch(() => {})
      return { success: true, track: 'skipped via SDK' }
    }
    if (queueRef.current.length === 0) return { success: false, error: 'Queue is empty' }
    advanceQueue()
    return { success: true, track: queueRef.current[0]?.name ?? 'next track' }
  }, [advanceQueue])

  const handleQueueTrack = useCallback(async (params: Record<string, unknown>) => {
    const query = String(params.query || '')
    if (!query) return { success: false, error: 'query is required' }
    let data: { tracks: Track[] }
    try {
      data = await apiFetch(`/api/oauth/spotify/search?q=${encodeURIComponent(query)}&limit=3`)
    } catch { return { success: false, error: 'Search failed' } }
    if (!data.tracks?.length) return { success: false, error: 'No results' }
    const allQueueTracks = data.tracks as Track[]

    // Explicit content filter — use first clean result
    const cleanTracks = getExplicitFilter() ? allQueueTracks.filter(t => !t.explicit) : allQueueTracks
    if (cleanTracks.length === 0) {
      const blocked = allQueueTracks[0]
      return {
        success: false,
        blocked: 'explicit',
        track: blocked.name,
        artist: blocked.artist,
        message: `All results for "${query}" contain explicit content and cannot be queued while the explicit filter is enabled.`,
      }
    }
    const track = cleanTracks[0]

    const newQueue = [...queueRef.current, track]
    queueRef.current = newQueue
    setQueue(newQueue)
    return { success: true, track: track.name, artist: track.artist, queueLength: newQueue.length }
  }, [])

  useEffect(() => {
    registerTool('play_track', handlePlayTrack)
    registerTool('pause_playback', handlePause)
    registerTool('resume_playback', handleResume)
    registerTool('set_volume', handleSetVolume)
    registerTool('skip_to_next', handleSkipNext)
    registerTool('queue_track', handleQueueTrack)
    initBridge()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual controls ───────────────────────────────────────────────────────

  async function togglePlay() {
    if (isPlaying) await handlePause({})
    else await handleResume({})
  }

  function cycleRepeat() {
    setRepeatMode(m => (m === 2 ? 0 : (m + 1) as 0 | 1 | 2))
  }

  async function unlockAudio() {
    setNeedsUnlock(false)
    const track = pendingPlayRef.current
    pendingPlayRef.current = null
    if (track?.previewUrl && audioRef.current) {
      audioRef.current.src = track.previewUrl
      await audioRef.current.play().catch(() => {})
      setIsPlaying(true)
      startProgressTimer()
    }
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (connectModeRef.current) {
      // For Connect mode, we'd need Spotify seek API — for now just update visual
      setProgress(ratio)
    } else if (audioRef.current) {
      audioRef.current.currentTime = ratio * (audioRef.current.duration || 30)
      setProgress(ratio)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(ms: number) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const elapsed = duration * progress
  const albumArtUrl = currentTrack?.albumArt ?? ''

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG, color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', overflow: 'hidden', position: 'relative' }}>

      {/* Dynamic blurred background from album art */}
      {albumArtUrl && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0,
          backgroundImage: `url(${albumArtUrl})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(80px) brightness(0.3) saturate(1.5)',
          transform: 'scale(1.3)',
          transition: 'background-image 0.8s ease',
        }} />
      )}

      {/* Content layer */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={GREEN}>
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1, letterSpacing: '-0.2px' }}>Spotify</span>
          {isPremium && <span style={badge('#143d22', GREEN)}>Premium</span>}
          {connected && !isPremium && <span style={badge('#1a1a1a', DIM)}>Free</span>}
          {connected
            ? <div style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN }} title="Connected to Spotify" />
            : <button onClick={handleConnect} style={smallBtn}>Connect</button>
          }
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── Disconnected ── */}
          {view === 'disconnected' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
              <svg width="72" height="72" viewBox="0 0 24 24" fill={GREEN} style={{ marginBottom: 20 }}>
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Connect Your Spotify</div>
              <div style={{ color: DIM, fontSize: 13, lineHeight: 1.7, marginBottom: 28 }}>
                Link your account, then tell the AI what to play:<br />
                <em style={{ color: '#ccc' }}>"Play Smells Like Teen Spirit"</em><br />
                <em style={{ color: '#ccc' }}>"Queue some Radiohead"</em>
              </div>
              <button onClick={handleConnect} style={bigBtn}>Connect Spotify</button>
            </div>
          )}

          {/* ── Connecting ── */}
          {view === 'connecting' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: DIM }}>
              <div style={spinnerStyle} />
              <div style={{ marginTop: 20, fontSize: 14 }}>Connecting to Spotify…</div>
            </div>
          )}

          {/* ── Player: waiting for song ── */}
          {view === 'player' && !currentTrack && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
              <div style={{ width: 120, height: 120, borderRadius: 8, background: SURFACE2, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill={DIM2}>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Ready to play</div>
              <div style={{ color: DIM, fontSize: 13, lineHeight: 1.7 }}>
                Ask the AI to play something:<br />
                <em style={{ color: '#ccc' }}>"Play Bohemian Rhapsody"</em><br />
                <em style={{ color: '#ccc' }}>"Put on some lo-fi beats"</em><br />
                <em style={{ color: '#ccc' }}>"Queue Nirvana"</em>
              </div>
            </div>
          )}

          {/* ── Player: now playing ── */}
          {view === 'player' && currentTrack && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px 16px', gap: 0, overflow: 'hidden' }}>

              {/* Album art — fills available space proportionally */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, marginBottom: 20 }}>
                <div style={{ width: '100%', maxWidth: 280, aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: SURFACE2, boxShadow: '0 16px 64px rgba(0,0,0,0.8)', flexShrink: 0 }}>
                  {albumArtUrl ? (
                    <img
                      src={albumArtUrl}
                      alt={currentTrack.album}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="60" height="60" viewBox="0 0 24 24" fill={DIM2}>
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {/* Track info + like button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.2px' }}>
                    {currentTrack.name}
                  </div>
                  <div style={{ color: DIM, fontSize: 13, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentTrack.artist}
                  </div>
                </div>
                <button
                  onClick={() => setLiked(v => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                  title={liked ? 'Remove from liked songs' : 'Add to liked songs'}
                >
                  <IconHeart on={liked} />
                </button>
              </div>

              {/* Progress bar */}
              <div style={{ marginBottom: 8, flexShrink: 0 }}>
                <div
                  onClick={handleSeek}
                  style={{ height: 4, background: SURFACE3, borderRadius: 2, cursor: 'pointer', position: 'relative', marginBottom: 6 }}
                  onMouseEnter={e => { (e.currentTarget.firstChild as HTMLElement).style.background = GREEN }}
                  onMouseLeave={e => { (e.currentTarget.firstChild as HTMLElement).style.background = '#fff' }}
                >
                  <div style={{ height: '100%', borderRadius: 2, background: '#fff', width: `${progress * 100}%`, transition: 'width 0.4s linear', pointerEvents: 'none' }} />
                  {/* Thumb dot */}
                  <div style={{ position: 'absolute', top: '50%', left: `${progress * 100}%`, transform: 'translate(-50%, -50%)', width: 12, height: 12, borderRadius: '50%', background: '#fff', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} className="progress-thumb" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: DIM }}>
                  <span>{fmt(elapsed)}</span>
                  <span>{fmt(duration || 0)}</span>
                </div>
              </div>

              {/* Main controls */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
                {/* Shuffle */}
                <button
                  onClick={() => setShuffleOn(v => !v)}
                  style={iconBtn}
                  title={shuffleOn ? 'Shuffle on' : 'Shuffle off'}
                >
                  <IconShuffle on={shuffleOn} />
                  {shuffleOn && <div style={{ width: 4, height: 4, borderRadius: '50%', background: GREEN, position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }} />}
                </button>

                {/* Previous */}
                <button onClick={async () => { /* prev not wired to API yet */ }} style={iconBtn} title="Previous">
                  <IconPrev />
                </button>

                {/* Play/Pause */}
                <button
                  onClick={togglePlay}
                  style={{ width: 52, height: 52, borderRadius: '50%', background: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform 0.1s', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
                  onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.95)' }}
                  onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                >
                  {isPlaying ? <IconPause /> : <IconPlay />}
                </button>

                {/* Next */}
                <button onClick={() => handleSkipNext({})} style={iconBtn} title="Next">
                  <IconNext />
                </button>

                {/* Repeat */}
                <button
                  onClick={cycleRepeat}
                  style={{ ...iconBtn, position: 'relative' }}
                  title={repeatMode === 0 ? 'Repeat off' : repeatMode === 1 ? 'Repeat all' : 'Repeat one'}
                >
                  <IconRepeat mode={repeatMode} />
                  {repeatMode > 0 && <div style={{ width: 4, height: 4, borderRadius: '50%', background: GREEN, position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }} />}
                </button>
              </div>

              {/* Volume + Queue */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <IconVolumeLow />
                <input
                  type="range" min={0} max={100} value={volume}
                  onChange={e => handleSetVolume({ level: Number(e.target.value) })}
                  style={{ flex: 1, accentColor: '#fff', cursor: 'pointer', height: 4 }}
                />
                <IconVolumeHigh />
                <button
                  onClick={() => setShowQueue(v => !v)}
                  style={{ ...iconBtn, marginLeft: 4, opacity: showQueue ? 1 : 0.6 }}
                  title="Queue"
                >
                  <IconQueue />
                </button>
              </div>

              {/* Audio unlock overlay */}
              {needsUnlock && (
                <button onClick={unlockAudio} style={{ ...bigBtn, marginTop: 12, fontSize: 14, padding: '10px 24px' }}>
                  ▶ Tap to play preview
                </button>
              )}

            </div>
          )}

          {/* Status message */}
          {statusMsg && (
            <div style={{ padding: '0 24px 12px', flexShrink: 0 }}>
              <div style={{ color: DIM, fontSize: 12, textAlign: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.08)', borderRadius: 6 }}>
                {statusMsg}
              </div>
            </div>
          )}
        </div>

        {/* Queue panel */}
        {showQueue && (
          <div style={{ background: SURFACE, borderTop: `1px solid ${SURFACE3}`, flexShrink: 0, maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: SURFACE, zIndex: 1 }}>
              <span style={{ fontSize: 11, color: DIM, fontWeight: 700, letterSpacing: 1.5 }}>NEXT IN QUEUE ({queue.length})</span>
              <button onClick={() => setShowQueue(false)} style={{ background: 'none', border: 'none', color: DIM, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            {queue.length === 0 && played.length === 0 && (
              <div style={{ padding: '8px 16px 14px', color: DIM2, fontSize: 13 }}>Nothing in queue yet</div>
            )}
            {queue.map((t, i) => (
              <div
                key={`q-${t.id}-${i}`}
                onClick={() => playTrackDirect(t)}
                style={{ display: 'flex', gap: 10, padding: '6px 16px', alignItems: 'center', borderTop: `1px solid ${SURFACE3}`, cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = SURFACE2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 11, color: DIM2, width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                {t.albumArt && (
                  <img src={t.albumArt} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: DIM }}>{t.artist}</div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); const nq = queue.filter((_, idx) => idx !== i); queueRef.current = nq; setQueue(nq) }}
                  style={{ background: 'none', border: 'none', color: DIM2, cursor: 'pointer', fontSize: 16, padding: '2px 4px', flexShrink: 0 }}
                >✕</button>
              </div>
            ))}
            {played.length > 0 && (
              <>
                <div style={{ padding: '8px 16px 4px', position: 'sticky', top: 28, background: SURFACE, zIndex: 1 }}>
                  <span style={{ fontSize: 11, color: DIM2, fontWeight: 700, letterSpacing: 1.5 }}>HISTORY</span>
                </div>
                {played.map((t, i) => (
                  <div
                    key={`h-${t.id}-${i}`}
                    onClick={() => playTrackDirect(t)}
                    style={{ display: 'flex', gap: 10, padding: '6px 16px', alignItems: 'center', borderTop: `1px solid ${SURFACE3}`, cursor: 'pointer', opacity: 0.7 }}
                    onMouseEnter={e => { e.currentTarget.style.background = SURFACE2; e.currentTarget.style.opacity = '1' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0.7' }}
                  >
                    {t.albumArt && (
                      <img src={t.albumArt} alt="" style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: DIM }}>{t.artist}</div>
                    </div>
                    <span style={{ fontSize: 11, color: DIM2, flexShrink: 0 }}>▶</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Style helpers ──────────────────────────────────────────────────────────

const spinnerStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  border: '3px solid rgba(255,255,255,0.1)', borderTopColor: GREEN,
  animation: 'spin 0.8s linear infinite', margin: '0 auto',
}

function badge(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }
}

const smallBtn: React.CSSProperties = {
  background: GREEN, color: '#000', border: 'none', borderRadius: 20,
  padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
}

const bigBtn: React.CSSProperties = {
  background: GREEN, color: '#000', border: 'none', borderRadius: 30,
  padding: '14px 40px', fontWeight: 700, cursor: 'pointer', fontSize: 15,
  letterSpacing: '0.5px', display: 'inline-block',
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', position: 'relative',
  transition: 'opacity 0.15s',
}
