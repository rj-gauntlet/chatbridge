import { useState, useEffect, useCallback } from 'react'
import { login, register, logout, type AuthSession } from '../../services/chatbridgeApi'

const SESSION_KEY = 'chatbridge_session'

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AuthSession
        setSession(parsed)
      }
    } catch {
      localStorage.removeItem(SESSION_KEY)
    } finally {
      setLoading(false)
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const s = await login(email, password)
      localStorage.setItem(SESSION_KEY, JSON.stringify(s))
      setSession(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null)
    setLoading(true)
    try {
      const result = await register(email, password)
      if (result.session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(result.session))
        setSession(result.session)
      }
      return result.message
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } finally {
      setSession(null)
    }
  }, [])

  return { session, loading, error, signIn, signUp, signOut }
}
