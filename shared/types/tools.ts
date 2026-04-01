// ============================================================
// Tool invocation + Policy Gate types
// ============================================================

export interface ToolCallRequest {
  appId: string
  toolName: string
  parameters: Record<string, unknown>
  userId: string
  conversationId: string
}

export interface ToolInvocation {
  id: string
  conversation_id: string
  message_id: string
  app_id: string
  tool_name: string
  parameters: Record<string, unknown>
  result: Record<string, unknown>
  duration_ms: number
  status: 'success' | 'error' | 'timeout'
  created_at: string
}

export interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  duration_ms?: number
}
