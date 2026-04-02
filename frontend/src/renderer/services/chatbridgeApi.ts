/**
 * ChatBridge API Client
 * All calls go to our Express backend at VITE_API_URL (default: http://localhost:3001)
 */

const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001'

function getAuthHeader(): Record<string, string> {
  const session = localStorage.getItem('chatbridge_session')
  if (!session) return {}
  try {
    const { access_token } = JSON.parse(session)
    return { Authorization: `Bearer ${access_token}` }
  } catch {
    return {}
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

// ── Auth ───────────────────────────────────────────────────

export interface AuthSession {
  access_token: string
  refresh_token: string
  user: { id: string; email: string }
}

export async function register(email: string, password: string) {
  return apiRequest<{ user: { id: string; email: string }; session: AuthSession; message: string }>(
    '/api/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const data = await apiRequest<{ user: { id: string; email: string }; session: AuthSession }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  )
  return { ...data.session, user: data.user }
}

export async function logout() {
  await apiRequest('/api/auth/logout', { method: 'POST' })
  localStorage.removeItem('chatbridge_session')
}

// ── Conversations ──────────────────────────────────────────

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export async function listConversations(): Promise<Conversation[]> {
  return apiRequest<Conversation[]>('/api/conversations')
}

export async function createConversation(title?: string): Promise<Conversation> {
  return apiRequest<Conversation>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await apiRequest(`/api/conversations/${id}`, { method: 'DELETE' })
}

export interface ConversationWithMessages extends Conversation {
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system' | 'tool'
    content: string
    created_at: string
  }>
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  return apiRequest<ConversationWithMessages>(`/api/conversations/${id}`)
}

// ── Chat (SSE streaming) ───────────────────────────────────

export type StreamEvent =
  | { type: 'start'; conversationId: string; messageId: string }
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; appSlug: string; toolName: string; correlationId: string }
  | { type: 'done'; conversationId: string; messageId: string }
  | { type: 'error'; message: string }

export async function* streamChat(
  message: string,
  conversationId?: string,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify({ message, conversationId }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        try {
          const event = JSON.parse(jsonStr) as StreamEvent
          yield event
        } catch {
          // malformed event — skip
        }
      }
    }
  }
}

// ── Apps ───────────────────────────────────────────────────

export interface AppRegistration {
  id: string
  name: string
  slug: string
  description: string
  icon_url?: string
  iframe_url: string
  auth_type: string
  tools: Array<{ name: string; description: string }>
  status: string
}

export async function listApps(): Promise<AppRegistration[]> {
  return apiRequest<AppRegistration[]>('/api/apps')
}
