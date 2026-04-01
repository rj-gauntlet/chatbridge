// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { NextFunction, Request, Response } from 'express'
import { supabaseUrl, anonKey } from '../services/supabase'

export interface AuthenticatedRequest extends Request {
  userId?: string
  userEmail?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: SupabaseClient<any>
}

/**
 * Validates Supabase JWT from Authorization header.
 * Attaches userId + userEmail to request.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' })
    return
  }

  const token = authHeader.slice(7)

  // Create a per-request Supabase client scoped to this user's JWT
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  req.userId = user.id
  req.userEmail = user.email
  req.supabase = supabase

  next()
}
