import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiUrl, getToken, initBridge, registerTool, sendStateUpdate } from './bridge'

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

// ── Constants ──────────────────────────────────────────────────────────────

const GREEN = '#1db954'
const BG = '#0a0a0a'
const SURFACE = '#181818'
const SURFACE2 = '#282828'
const DIM = '#b3b3b3'

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  // ── Display state (drives re-renders) ────────────────────────────────────
  const [view, setView] = useState<AppView>('disconnected')
  const [connected, setConnected] = useState(false)
  const [isPremium, setIsPremium] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)     // 0–1
  const [duration, setDuration] = useState(0)     // ms
  const [volume, setVolume] = useState(80)
  const [queue, setQueue] = useState<Track[]>([])
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [showQueue, setShowQueue] = useState(false)

  // ── Mutable refs (stable across renders, read in callbacks) ───────────────
  const playerRef = useRef<SpotifyPlayer | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const connectModeRef = useRef(false)  // true = playing via Spotify Connect API
  const queueRef = useRef<Track[]>([])
  const volumeRef = useRef(80)
  const pendingPlayRef = useRef<Track | null>(null)  // track waiting for audio unlock

  // Keep queueRef in sync with queue state
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { volumeRef.current = volume }, [volume])

  // ── Spotify Connect polling (updates progress + track info from API) ───────
  const stopConnectPoll = useCallback(() => {
    if (connectPollRef.current) { clearInterval(connectPollRef.current); connectPollRef.current = null }
  }, [])

  const startConnectPoll = useCallback(() => {
    stopConnectPoll()
    connectPollRef.current = setInterval(async () => {
      try {
        const state = await apiFetch('/api/oauth/spotify/player')
        if (!state || !state.track) return
        setCurrentTrack(t => {
          // Update album art if it was missing
          if (t && !t.albumArt && state.track.albumArt) return { ...t, albumArt: state.track.albumArt }
          return t
        })
        setIsPlaying(state.is_playing)
        if (state.duration_ms > 0) {
          setProgress(state.progress_ms / state.duration_ms)
          setDuration(state.duration_ms)
        }
      } catch { /* ignore poll errors */ }
    }, 1500)
  }, [stopConnectPoll])

  // ── Progress timer (for preview mode) ────────────────────────────────────

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
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

  // ── Audio auto-advance ────────────────────────────────────────────────────

  const advanceQueue = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) {
      setIsPlaying(false)
      clearProgressTimer()
      return
    }
    const [next, ...rest] = q
    queueRef.current = rest
    setQueue(rest)

    const audio = audioRef.current
    if (audio && next.previewUrl) {
      audio.src = next.previewUrl
      audio.currentTime = 0
      audio.play().catch(() => {})
      setCurrentTrack(next)
      setIsPlaying(true)
      setProgress(0)
      startProgressTimer()
    }
  }, [clearProgressTimer, startProgressTimer])

  // ── Playback core: try SDK then preview ───────────────────────────────────

  const playTrackDirect = useCallback(async (track: Track): Promise<'sdk' | 'preview' | 'error'> => {
    // Try Spotify Connect — fetch available devices, pick one, send explicit play command
    try {
      // Pick device: SDK device first, then first available Connect device
      let targetDeviceId: string | undefined = deviceIdRef.current ?? undefined
      if (!targetDeviceId) {
        const devData = await apiFetch('/api/oauth/spotify/devices')
        const devices: Array<{ id: string; name: string; is_active: boolean }> = devData.devices || []
        // Prefer active device, fall back to first available
        const active = devices.find(d => d.is_active) || devices[0]
        if (active) targetDeviceId = active.id
      }

      if (targetDeviceId) {
        const result = await apiFetch('/api/oauth/spotify/play', {
          method: 'PUT',
          body: JSON.stringify({ uri: track.uri, deviceId: targetDeviceId }),
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
      }
    } catch {
      // Fall through to preview
    }
    connectModeRef.current = false

    // Fallback: 30-second preview
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
      // NotAllowedError — browser requires user gesture first
      if ((e as Error)?.name === 'NotAllowedError') {
        pendingPlayRef.current = track
        setNeedsUnlock(true)
        setCurrentTrack(track)
        return 'error'
      }
      return 'error'
    }
  }, [advanceQueue, startProgressTimer])

  // ── SDK initialization ────────────────────────────────────────────────────

  const initSpotifySdk = useCallback(async () => {
    let spotifyToken: string | null = null
    try {
      const data = await apiFetch('/api/oauth/spotify/token')
      spotifyToken = data.token
      if (!spotifyToken || spotifyToken === 'mock-spotify-token') return
    } catch {
      return // not connected to Spotify yet
    }

    const createPlayer = () => {
      if (playerRef.current) {
        playerRef.current.disconnect()
        playerRef.current = null
        deviceIdRef.current = null
      }

      const player = new window.Spotify.Player({
        name: 'ChatBridge Player',
        getOAuthToken: async (cb) => {
          try {
            const d = await apiFetch('/api/oauth/spotify/token')
            cb(d.token)
          } catch {
            cb(spotifyToken!)
          }
        },
        volume: volumeRef.current / 100,
      })

      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        deviceIdRef.current = device_id
        setIsPremium(true)
        setStatusMsg(null)
      })

      player.addListener('not_ready', () => {
        deviceIdRef.current = null
      })

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
          id: t.id,
          name: t.name,
          artist: t.artists.map(a => a.name).join(', '),
          album: t.album.name,
          albumArt: t.album.images[0]?.url ?? '',
          previewUrl: null,
          uri: t.uri,
        })
        setIsPlaying(!state.paused)
        if (state.duration > 0) {
          setProgress(state.position / state.duration)
          setDuration(state.duration)
        }
      })

      player.connect()
      playerRef.current = player
    }

    if (window.Spotify) {
      createPlayer()
    } else {
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
    } catch {
      setConnected(false)
      return false
    }
  }, [])

  // ── On mount: check connection, then init SDK if already connected ─────────

  useEffect(() => {
    // Delay slightly so the auth_token postMessage arrives first
    const timer = setTimeout(async () => {
      const isConnected = await checkConnection()
      if (isConnected) initSpotifySdk()
    }, 200)
    return () => clearTimeout(timer)
  }, [checkConnection, initSpotifySdk])

  // ── Cleanup ───────────────────────────────────────────────────────────────

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
      // No Spotify credentials configured — mock mode
      setConnected(true)
      setView('player')
      setStatusMsg('Running in demo mode — Spotify not configured')
    }
  }, [checkConnection, initSpotifySdk])

  // ── Tool handlers (all empty deps — read state from refs/getters) ─────────

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

    const tracks = (data.tracks || []) as Track[]
    if (tracks.length === 0) {
      setStatusMsg(`No results for "${query}"`)
      return { success: false, error: 'No tracks found' }
    }

    const track = tracks[0]

    // Warn if we're running on expired/mock credentials
    if (data.needsReconnect) {
      setConnected(false)
      setView('disconnected')
      setStatusMsg('🔑 Spotify session expired — tap "Connect Spotify" to reconnect for audio playback')
      return {
        success: true,
        track: track.name,
        artist: track.artist,
        album: track.album,
        mode: 'info',
        message: `Found "${track.name}" by ${track.artist} on ${track.album}. Audio is unavailable because your Spotify session has expired — the user needs to reconnect their Spotify account to hear music.`,
      }
    }

    setStatusMsg(null)

    // Stop whatever is playing
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      clearProgressTimer()
    }

    // Try each track in search results until one plays successfully
    // (Spotify has deprecated preview_url for many tracks — fallback through the list)
    let playedTrack: Track | null = null
    let mode: 'sdk' | 'preview' | 'error' = 'error'
    for (const candidate of tracks) {
      mode = await playTrackDirect(candidate)
      if (mode !== 'error' || pendingPlayRef.current) {
        playedTrack = candidate
        break
      }
    }

    if (!playedTrack || (mode === 'error' && !pendingPlayRef.current)) {
      setStatusMsg('⚠️ Open Spotify on your phone or computer, then try again')
      return { success: false, error: 'Could not play — make sure Spotify is open and active on one of your devices (phone, desktop, etc.), then try again' }
    }

    const t = playedTrack
    sendStateUpdate({ playing: t.name, artist: t.artist, mode })
    return {
      success: mode !== 'error',
      track: t.name,
      artist: t.artist,
      album: t.album,
      mode,
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
    } catch {
      return { success: false, error: 'Search failed' }
    }

    if (!data.tracks?.length) return { success: false, error: 'No results' }
    const track = data.tracks[0]
    const newQueue = [...queueRef.current, track]
    queueRef.current = newQueue
    setQueue(newQueue)
    return { success: true, track: track.name, artist: track.artist, queueLength: newQueue.length }
  }, [])

  // Register tools once (all handlers have empty deps → stable references)
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  function fmt(ms: number) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const elapsed = duration * progress

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG, color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#000', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        <span style={{ color: GREEN, fontSize: 16, fontWeight: 700 }}>♫</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Spotify Player</span>
        {isPremium && <span style={badge('#143d22', '#1db954')}>Premium ✓</span>}
        {connected && !isPremium && <span style={badge('#1a1a1a', DIM)}>Previews</span>}
        {connected ? (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN }} title="Connected" />
        ) : (
          <button onClick={handleConnect} style={smallBtn}>Connect</button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20, overflow: 'hidden' }}>

        {view === 'disconnected' && (
          <div style={{ textAlign: 'center', maxWidth: 300 }}>
            <div style={{ fontSize: 60, marginBottom: 16 }}>🎧</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Connect Your Spotify</div>
            <div style={{ color: DIM, fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
              Then tell the AI what to play:<br />
              <em style={{ color: '#fff' }}>"Play Smells Like Teen Spirit"</em><br />
              <em style={{ color: '#fff' }}>"Queue some Radiohead"</em>
            </div>
            <button onClick={handleConnect} style={bigBtn}>Connect Spotify</button>
          </div>
        )}

        {view === 'connecting' && (
          <div style={{ textAlign: 'center', color: DIM }}>
            <div style={spinner} />
            <div style={{ marginTop: 16 }}>Connecting to Spotify…</div>
          </div>
        )}

        {view === 'player' && !currentTrack && (
          <div style={{ textAlign: 'center', maxWidth: 300 }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🎵</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Ready to play</div>
            <div style={{ color: DIM, fontSize: 13, lineHeight: 1.7 }}>
              Ask the AI to play something:<br />
              <em style={{ color: '#ccc' }}>"Play Bohemian Rhapsody"</em><br />
              <em style={{ color: '#ccc' }}>"Put on some lo-fi beats"</em><br />
              <em style={{ color: '#ccc' }}>"Queue Nirvana"</em>
            </div>
          </div>
        )}

        {view === 'player' && currentTrack && (
          <>
            {/* Album art */}
            <div style={{ width: 196, height: 196, borderRadius: 8, overflow: 'hidden', background: SURFACE2, flexShrink: 0, boxShadow: '0 8px 48px rgba(0,0,0,0.7)' }}>
              {currentTrack.albumArt ? (
                <img src={currentTrack.albumArt} alt={currentTrack.album} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>🎵</div>
              )}
            </div>

            {/* Track info */}
            <div style={{ width: '100%', maxWidth: 280, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.name}</div>
              <div style={{ color: DIM, fontSize: 13 }}>{currentTrack.artist}</div>
              <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{currentTrack.album}</div>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', maxWidth: 280 }}>
              <div
                onClick={(e) => {
                  if (!audioRef.current?.src) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const ratio = (e.clientX - rect.left) / rect.width
                  if (audioRef.current) {
                    audioRef.current.currentTime = ratio * (audioRef.current.duration || 30)
                    setProgress(ratio)
                  }
                }}
                style={{ height: 4, background: SURFACE2, borderRadius: 2, cursor: 'pointer', position: 'relative', marginBottom: 4 }}
              >
                <div style={{ height: '100%', borderRadius: 2, background: GREEN, width: `${progress * 100}%`, transition: 'width 0.4s linear' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6b7280' }}>
                <span>{fmt(elapsed)}</span>
                <span>{fmt(duration || 0)}</span>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <button onClick={() => setShowQueue(v => !v)} style={ctrlBtn('#3a3a3a')} title="Queue">
                ☰
              </button>
              <button
                onClick={togglePlay}
                style={{ ...ctrlBtn(GREEN), width: 52, height: 52, borderRadius: '50%', fontSize: 22, color: '#000' }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button onClick={() => handleSkipNext({})} style={ctrlBtn('#3a3a3a')} title="Skip">
                ⏭
              </button>
            </div>

            {/* Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 280 }}>
              <span style={{ fontSize: 12, color: DIM }}>🔈</span>
              <input
                type="range" min={0} max={100} value={volume}
                onChange={e => handleSetVolume({ level: Number(e.target.value) })}
                style={{ flex: 1, accentColor: GREEN, cursor: 'pointer', height: 4 }}
              />
              <span style={{ fontSize: 12, color: DIM }}>🔊</span>
            </div>

            {/* Audio unlock overlay */}
            {needsUnlock && (
              <button onClick={unlockAudio} style={{ ...bigBtn, fontSize: 14, padding: '10px 24px' }}>
                ▶ Tap to play preview
              </button>
            )}
          </>
        )}

        {/* Status message */}
        {statusMsg && (
          <div style={{ color: DIM, fontSize: 12, textAlign: 'center', padding: '8px 14px', background: SURFACE, borderRadius: 8, maxWidth: 280 }}>
            {statusMsg}
          </div>
        )}
      </div>

      {/* Queue panel */}
      {showQueue && (
        <div style={{ background: SURFACE, borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
          <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: DIM, fontWeight: 600, letterSpacing: 1 }}>QUEUE ({queue.length})</span>
            <button onClick={() => setShowQueue(false)} style={{ background: 'none', border: 'none', color: DIM, cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
          {queue.length === 0 ? (
            <div style={{ padding: '8px 16px 12px', color: '#555', fontSize: 12 }}>Queue is empty</div>
          ) : (
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {queue.map((t, i) => (
                <div key={`${t.id}-${i}`} style={{ display: 'flex', gap: 10, padding: '6px 16px', alignItems: 'center', borderTop: '1px solid #2a2a2a' }}>
                  <span style={{ fontSize: 11, color: '#555', width: 16, textAlign: 'right' }}>{i + 1}</span>
                  {t.albumArt && <img src={t.albumArt} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: DIM }}>{t.artist}</div>
                  </div>
                  <button
                    onClick={() => { const nq = queue.filter((_, idx) => idx !== i); queueRef.current = nq; setQueue(nq) }}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Style helpers ──────────────────────────────────────────────────────────

const spinner: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  border: '3px solid #1f1f1f', borderTopColor: '#1db954',
  animation: 'spin 0.8s linear infinite', margin: '0 auto',
}

function badge(bg: string, color: string): React.CSSProperties {
  return { background: bg, color, fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }
}

const smallBtn: React.CSSProperties = {
  background: '#1db954', color: '#000', border: 'none', borderRadius: 20,
  padding: '4px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
}

const bigBtn: React.CSSProperties = {
  background: '#1db954', color: '#000', border: 'none', borderRadius: 24,
  padding: '12px 36px', fontWeight: 700, cursor: 'pointer', fontSize: 16,
}

function ctrlBtn(bg: string): React.CSSProperties {
  return {
    background: bg, border: 'none', color: '#fff', cursor: 'pointer',
    width: 40, height: 40, borderRadius: '50%', fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}
