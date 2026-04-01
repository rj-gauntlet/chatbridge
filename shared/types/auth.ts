// ============================================================
// Auth + OAuth types
// ============================================================

export interface OAuthToken {
  id: string
  user_id: string
  app_id: string
  access_token: string  // encrypted at rest
  refresh_token: string // encrypted at rest
  expires_at: string    // timestamptz
  scopes: string[]
  created_at: string
}

export interface UserSession {
  userId: string
  email: string
  role?: string
}
