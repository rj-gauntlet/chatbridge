import { useState, useEffect, useCallback, useRef } from 'react'
import { login, register, logout, type AuthSession } from '../../services/chatbridgeApi'

const SESSION_KEY = 'chatbridge_session'
const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001'

/** Silently refresh the stored access_token using the refresh_token. */
async function silentRefresh(): Promise<AuthSession | null> {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as AuthSession
    if (!stored.refresh_token) return null

    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: stored.refresh_token }),
    })
    if (!res.ok) return null

    const data = await res.json() as { session: AuthSession; user: { id: string; email: string } }
    if (!data.session?.access_token) return null

    const newSession: AuthSession = { ...data.session, user: data.user }
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession))
    return newSession
  } catch {
    return null
  }
}

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Schedule next refresh 5 minutes before expiry (Supabase tokens last 1 hour). */
  const scheduleRefresh = useCallback((currentSession: AuthSession) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)

    // Supabase sessions include expires_at (Unix seconds) in the JWT payload
    let msUntilExpiry = 55 * 60 * 1000 // default: 55 min
    try {
      const payload = JSON.parse(atob(currentSession.access_token.split('.')[1]))
      if (payload.exp) {
        msUntilExpiry = Math.max((payload.exp * 1000) - Date.now() - 5 * 60 * 1000, 10_000)
      }
    } catch { /* use default */ }

    refreshTimerRef.current = setTimeout(async () => {
      const refreshed = await silentRefresh()
      if (refreshed) {
        setSession(refreshed)
        scheduleRefresh(refreshed)
      } else {
        // Refresh failed — clear session
        setSession(null)
        localStorage.removeItem(SESSION_KEY)
      }
    }, msUntilExpiry)
  }, [])

  // Load session from localStorage on mount, then schedule refresh
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AuthSession
        setSession(parsed)
        scheduleRefresh(parsed)
      }
    } catch {
      localStorage.removeItem(SESSION_KEY)
    } finally {
      setLoading(false)
    }
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current) }
  }, [scheduleRefresh])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const s = await login(email, password)
      localStorage.setItem(SESSION_KEY, JSON.stringify(s))
      setSession(s)
      scheduleRefresh(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [scheduleRefresh])

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const result = await register(email, password)
      if (result.session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(result.session))
        setSession(result.session)
        scheduleRefresh(result.session as AuthSession)
      }
      return result.message
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [scheduleRefresh])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } finally {
      setSession(null)
    }
  }, [])

  return { session, loading, error, signIn, signUp, signOut }
}
