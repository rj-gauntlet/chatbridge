// ============================================================
// App Registration + Tool Schema types
// ============================================================

export type JSONSchema = {
  type: string
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  description?: string
  enum?: unknown[]
  [key: string]: unknown
}

export interface ToolSchema {
  name: string
  description: string
  inputSchema: JSONSchema   // OpenAI-native function parameter schema
  outputSchema: JSONSchema  // declared return shape — used by tool-output firewall
  requiresConsent?: boolean // if true, Policy Gate checks consent before invocation
}

export type AppStatus = 'active' | 'disabled' | 'pending_review'
export type AuthType = 'internal' | 'public' | 'oauth2'

export interface OAuthConfig {
  auth_url: string
  token_url: string
  client_id: string
  scopes: string[]
}

export interface AppRegistration {
  id: string
  name: string
  slug: string
  description: string
  icon_url?: string
  iframe_url: string
  auth_type: AuthType
  oauth_config?: OAuthConfig
  tools: ToolSchema[]
  webhook_url?: string
  status: AppStatus
  created_at: string
  updated_at?: string
}
