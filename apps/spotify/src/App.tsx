import { useEffect, useState, useCallback, useRef } from 'react'
import { registerTool, initBridge, sendStateUpdate, sendCompletion } from './bridge'

// ── Types ──────────────────────────────────────────────────────────────────

interface Track {
  id: string
  name: string
  artist: string
  album: string
  durationMs?: number
  url?: string
  mock?: boolean
}

interface Playlist {
  id: string
  name: string
  trackCount: number
  url?: string
}

type View = 'home' | 'search' | 'playlist-builder' | 'playlists'

// ── Helpers ────────────────────────────────────────────────────────────────

const API_BASE = (window as any).CHATBRIDGE_API_URL || 'http://localhost:3001'

async function apiFetch(path: string, init?: RequestInit) {
  const token = (window as any).CHATBRIDGE_TOKEN || ''
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

function formatDuration(ms?: number) {
  if (!ms) return ''
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [connected, setConnected] = useState(false)
  const [checking, setChecking] = useState(true)
  const [view, setView] = useState<View>('home')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [playlist, setPlaylist] = useState<Track[]>([])
  const [playlistName, setPlaylistName] = useState('')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [saving, setSaving] = useState(false)
  const [savedPlaylist, setSavedPlaylist] = useState<{ name: string; url?: string } | null>(null)
  const [isMock, setIsMock] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // ── Check connection ──────────────────────────────────────────────────

  const checkConnection = useCallback(async () => {
    try {
      const data = await apiFetch('/api/oauth/spotify/status')
      setConnected(data.connected || data.mock || true)
    } catch {
      // If API not reachable, show as connected with mock data
      setConnected(true)
      setIsMock(true)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  // ── OAuth connect ──────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    try {
      const data = await apiFetch('/api/oauth/spotify/authorize')
      const popup = window.open(data.authUrl, 'spotify-auth', 'width=500,height=700')
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer)
          checkConnection()
        }
      }, 1000)
    } catch {
      // In dev without credentials, just enable mock mode
      setConnected(true)
      setIsMock(true)
    }
  }, [checkConnection])

  // ── Tool handlers ──────────────────────────────────────────────────────

  const handleSearchTracks = useCallback(async (params: Record<string, unknown>) => {
    const q = String(params.query || '')
    const limit = Number(params.limit) || 10

    setView('search')
    setSearchQuery(q)
    setSearching(true)

    try {
      const data = await apiFetch(`/api/oauth/spotify/search?q=${encodeURIComponent(q)}&limit=${limit}`)
      setSearchResults(data.tracks || [])
      if (data.mock) setIsMock(true)
      setSearching(false)
      sendStateUpdate({ view: 'search', query: q, resultCount: (data.tracks || []).length })
      return { tracks: data.tracks || [], query: q, resultCount: (data.tracks || []).length }
    } catch (err) {
      setSearching(false)
      return { error: 'Search failed', tracks: [] }
    }
  }, [])

  const handleCreatePlaylist = useCallback(async (params: Record<string, unknown>) => {
    const name = String(params.name || 'My Playlist')
    const description = String(params.description || '')
    setPlaylistName(name)
    setView('playlist-builder')
    setSaving(true)

    try {
      const trackIds = playlist.map(t => t.id)
      const data = await apiFetch('/api/oauth/spotify/playlist', {
        method: 'POST',
        body: JSON.stringify({ name, description, trackIds }),
      })
      if (data.mock) setIsMock(true)
      setSaving(false)
      setSavedPlaylist({ name: data.name, url: data.url })
      sendStateUpdate({ playlistCreated: true, name: data.name, trackCount: data.trackCount })
      sendCompletion(`Playlist "${data.name}" created with ${data.trackCount} tracks`, data)
      return { playlistId: data.playlistId, name: data.name, url: data.url, trackCount: data.trackCount }
    } catch (err) {
      setSaving(false)
      return { error: 'Failed to create playlist' }
    }
  }, [playlist])

  const handleAddToPlaylist = useCallback(async (params: Record<string, unknown>) => {
    const trackId = String(params.trackId || '')
    const track = searchResults.find(t => t.id === trackId) || {
      id: trackId, name: params.trackName as string || 'Unknown', artist: params.artist as string || 'Unknown', album: '',
    }
    setPlaylist(prev => prev.find(t => t.id === trackId) ? prev : [...prev, track])
    setView('playlist-builder')
    sendStateUpdate({ playlistSize: playlist.length + 1 })
    return { success: true, trackAdded: track.name, playlistSize: playlist.length + 1 }
  }, [searchResults, playlist])

  const handleGetUserPlaylists = useCallback(async (_params: Record<string, unknown>) => {
    try {
      const data = await apiFetch('/api/oauth/spotify/playlists')
      setPlaylists(data.playlists || [])
      setView('playlists')
      if (data.mock) setIsMock(true)
      return { playlists: data.playlists || [] }
    } catch {
      return { playlists: [], error: 'Could not load playlists' }
    }
  }, [])

  // Register tools
  useEffect(() => {
    registerTool('search_tracks', handleSearchTracks)
    registerTool('create_playlist', handleCreatePlaylist)
    registerTool('add_to_playlist', handleAddToPlaylist)
    registerTool('get_user_playlists', handleGetUserPlaylists)
    initBridge()
  }, [handleSearchTracks, handleCreatePlaylist, handleAddToPlaylist, handleGetUserPlaylists])

  // ── Render ─────────────────────────────────────────────────────────────

  if (checking) {
    return (
      <div style={{ ...styles.container, justifyContent: 'center', alignItems: 'center' }}>
        <div style={styles.spinner} />
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <span style={{ fontSize: 20 }}>🎵</span>
        <span style={styles.headerTitle}>Spotify Playlist Creator</span>
        {isMock && <span style={styles.mockBadge}>mock mode</span>}
        <div style={styles.headerRight}>
          {connected ? (
            <div style={styles.connectedDot} title="Connected to Spotify" />
          ) : (
            <button style={styles.connectBtn} onClick={handleConnect}>Connect Spotify</button>
          )}
        </div>
      </header>

      {/* Nav */}
      {connected && (
        <nav style={styles.nav}>
          {(['home', 'search', 'playlist-builder', 'playlists'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{ ...styles.navBtn, ...(view === v ? styles.navBtnActive : {}) }}
            >
              {v === 'home' ? '🏠' : v === 'search' ? '🔍 Search' : v === 'playlist-builder' ? `📋 Builder${playlist.length > 0 ? ` (${playlist.length})` : ''}` : '📚 Playlists'}
            </button>
          ))}
        </nav>
      )}

      {/* Body */}
      <div style={styles.body}>
        {!connected && (
          <div style={styles.centered}>
            <div style={{ fontSize: 64 }}>🎧</div>
            <h2 style={styles.h2}>Connect Your Spotify</h2>
            <p style={{ color: '#9ca3af', textAlign: 'center', lineHeight: 1.6 }}>
              Link your Spotify account to search for tracks<br />and create playlists with the AI assistant.
            </p>
            <button style={styles.bigConnectBtn} onClick={handleConnect}>Connect Spotify</button>
          </div>
        )}

        {connected && view === 'home' && (
          <div style={styles.centered}>
            <div style={{ fontSize: 56 }}>🎵</div>
            <h2 style={styles.h2}>Ready to create music!</h2>
            <p style={{ color: '#9ca3af', textAlign: 'center', lineHeight: 1.6 }}>
              Ask the AI to search for tracks or create a playlist.<br />
              You can also browse manually using the tabs above.
            </p>
            <div style={styles.hints}>
              <div style={styles.hint}>"Search for Taylor Swift songs"</div>
              <div style={styles.hint}>"Create a workout playlist"</div>
              <div style={styles.hint}>"Show my playlists"</div>
            </div>
          </div>
        )}

        {connected && view === 'search' && (
          <div style={styles.searchView}>
            <div style={styles.searchBar}>
              <input
                ref={searchInputRef}
                style={styles.searchInput}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchTracks({ query: searchQuery })}
                placeholder="Search tracks, artists, albums..."
              />
              <button style={styles.searchBtn} onClick={() => handleSearchTracks({ query: searchQuery })}>
                Search
              </button>
            </div>

            {searching && <div style={styles.loading}>Searching...</div>}

            {searchResults.length > 0 && !searching && (
              <div style={styles.trackList}>
                {searchResults.map(track => (
                  <div key={track.id} style={styles.trackRow}>
                    <div style={styles.trackInfo}>
                      <div style={styles.trackName}>{track.name}</div>
                      <div style={styles.trackMeta}>{track.artist} · {track.album}</div>
                    </div>
                    <div style={styles.trackActions}>
                      {formatDuration(track.durationMs) && (
                        <span style={styles.duration}>{formatDuration(track.durationMs)}</span>
                      )}
                      <button
                        style={{
                          ...styles.addBtn,
                          ...(playlist.find(t => t.id === track.id) ? styles.addBtnAdded : {}),
                        }}
                        onClick={() => handleAddToPlaylist({ trackId: track.id })}
                      >
                        {playlist.find(t => t.id === track.id) ? '✓' : '+'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchResults.length === 0 && !searching && searchQuery && (
              <div style={styles.empty}>No results for "{searchQuery}"</div>
            )}
          </div>
        )}

        {connected && view === 'playlist-builder' && (
          <div style={styles.builderView}>
            <div style={styles.playlistHeader}>
              <input
                style={styles.playlistNameInput}
                value={playlistName}
                onChange={e => setPlaylistName(e.target.value)}
                placeholder="Playlist name..."
              />
              <button
                style={styles.saveBtn}
                onClick={() => handleCreatePlaylist({ name: playlistName || 'My Playlist', description: '' })}
                disabled={saving || playlist.length === 0}
              >
                {saving ? 'Saving...' : 'Save to Spotify'}
              </button>
            </div>

            {savedPlaylist && (
              <div style={styles.successBanner}>
                ✓ "{savedPlaylist.name}" saved!{' '}
                {savedPlaylist.url && <a href={savedPlaylist.url} target="_blank" rel="noreferrer" style={{ color: '#1db954' }}>Open in Spotify</a>}
              </div>
            )}

            {playlist.length === 0 ? (
              <div style={styles.empty}>No tracks yet. Search and add tracks to your playlist.</div>
            ) : (
              <div style={styles.trackList}>
                {playlist.map((track, i) => (
                  <div key={track.id} style={styles.trackRow}>
                    <span style={styles.trackNum}>{i + 1}</span>
                    <div style={styles.trackInfo}>
                      <div style={styles.trackName}>{track.name}</div>
                      <div style={styles.trackMeta}>{track.artist}</div>
                    </div>
                    <button
                      style={styles.removeBtn}
                      onClick={() => setPlaylist(prev => prev.filter(t => t.id !== track.id))}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {connected && view === 'playlists' && (
          <div style={styles.playlistsView}>
            <button style={styles.refreshBtn} onClick={() => handleGetUserPlaylists({})}>Refresh</button>
            {playlists.length === 0 ? (
              <div style={styles.empty}>No playlists found. Ask the AI to show your playlists.</div>
            ) : (
              <div style={styles.playlistGrid}>
                {playlists.map(p => (
                  <a key={p.id} href={p.url || '#'} target="_blank" rel="noreferrer" style={styles.playlistCard}>
                    <div style={styles.playlistEmoji}>🎶</div>
                    <div style={styles.playlistCardName}>{p.name}</div>
                    <div style={styles.playlistCardCount}>{p.trackCount} tracks</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a0a', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#111', borderBottom: '1px solid #1db954' },
  headerTitle: { flex: 1, fontWeight: 700, fontSize: 14 },
  mockBadge: { background: '#374151', color: '#9ca3af', fontSize: 11, padding: '2px 8px', borderRadius: 10 },
  headerRight: { display: 'flex', alignItems: 'center' },
  connectedDot: { width: 8, height: 8, borderRadius: '50%', background: '#1db954' },
  connectBtn: { background: '#1db954', color: '#000', border: 'none', borderRadius: 20, padding: '4px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 },
  nav: { display: 'flex', gap: 0, background: '#111', borderBottom: '1px solid #1f1f1f' },
  navBtn: { padding: '8px 14px', background: 'transparent', color: '#9ca3af', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
  navBtnActive: { color: '#1db954', borderBottom: '2px solid #1db954' },
  body: { flex: 1, overflowY: 'auto' },
  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, minHeight: '70vh' },
  h2: { fontSize: 22, fontWeight: 700, color: '#fff' },
  hints: { display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 },
  hint: { background: '#1a1a1a', color: '#9ca3af', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontStyle: 'italic' },
  bigConnectBtn: { background: '#1db954', color: '#000', border: 'none', borderRadius: 24, padding: '12px 32px', fontWeight: 700, cursor: 'pointer', fontSize: 16 },
  searchView: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  searchBar: { display: 'flex', gap: 8 },
  searchInput: { flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #1f1f1f', background: '#1a1a1a', color: '#fff', fontSize: 14, outline: 'none' },
  searchBtn: { padding: '10px 20px', background: '#1db954', color: '#000', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  loading: { textAlign: 'center', color: '#9ca3af', padding: 20 },
  trackList: { display: 'flex', flexDirection: 'column', gap: 2 },
  trackRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, background: '#1a1a1a' },
  trackNum: { color: '#6b7280', fontSize: 13, width: 20, textAlign: 'right' },
  trackInfo: { flex: 1, minWidth: 0 },
  trackName: { fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  trackMeta: { fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  trackActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  duration: { fontSize: 12, color: '#6b7280' },
  addBtn: { width: 28, height: 28, borderRadius: '50%', border: '1px solid #1db954', background: 'transparent', color: '#1db954', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  addBtnAdded: { background: '#1db954', color: '#000' },
  empty: { textAlign: 'center', color: '#6b7280', padding: 40, fontSize: 14 },
  builderView: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  playlistHeader: { display: 'flex', gap: 8 },
  playlistNameInput: { flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #1f1f1f', background: '#1a1a1a', color: '#fff', fontSize: 14, outline: 'none' },
  saveBtn: { padding: '10px 20px', background: '#1db954', color: '#000', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  successBanner: { background: '#14532d', color: '#4ade80', padding: '10px 16px', borderRadius: 8, fontSize: 13 },
  removeBtn: { color: '#6b7280', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 },
  playlistsView: { padding: 16 },
  refreshBtn: { background: '#1a1a1a', color: '#9ca3af', border: '1px solid #374151', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, marginBottom: 12 },
  playlistGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  playlistCard: { background: '#1a1a1a', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none', color: '#fff' },
  playlistEmoji: { fontSize: 32 },
  playlistCardName: { fontWeight: 600, fontSize: 14 },
  playlistCardCount: { fontSize: 12, color: '#9ca3af' },
  spinner: { width: 40, height: 40, borderRadius: '50%', border: '3px solid #1f1f1f', borderTopColor: '#1db954', animation: 'spin 0.8s linear infinite' },
}
