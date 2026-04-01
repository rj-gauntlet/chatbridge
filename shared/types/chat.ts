// ============================================================
// Chat + Conversation types
// ============================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  tool_call_id?: string
  tool_name?: string
  app_context?: Record<string, unknown> // snapshot of active app state
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationWithMessages extends Conversation {
  messages: ChatMessage[]
}

// SSE stream event shapes
export interface StreamStartEvent {
  type: 'start'
  conversationId: string
  messageId: string
}

export interface StreamDeltaEvent {
  type: 'delta'
  content: string
}

export interface StreamToolCallEvent {
  type: 'tool_call'
  appSlug: string
  toolName: string
  correlationId: string
}

export interface StreamDoneEvent {
  type: 'done'
  conversationId: string
  messageId: string
}

export interface StreamErrorEvent {
  type: 'error'
  message: string
}

export type StreamEvent =
  | StreamStartEvent
  | StreamDeltaEvent
  | StreamToolCallEvent
  | StreamDoneEvent
  | StreamErrorEvent
