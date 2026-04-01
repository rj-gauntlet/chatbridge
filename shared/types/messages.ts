// ============================================================
// postMessage protocol between platform and iframes
// ============================================================

// Platform → App
export type PlatformToAppMessageType = 'tool_invoke' | 'app_close' | 'ping'

export interface ToolInvokeMessage {
  type: 'tool_invoke'
  correlationId: string
  toolName: string
  parameters: Record<string, unknown>
}

export interface AppCloseMessage {
  type: 'app_close'
}

export interface PingMessage {
  type: 'ping'
}

export type PlatformToAppMessage = ToolInvokeMessage | AppCloseMessage | PingMessage

// App → Platform
export type AppToPlatformMessageType =
  | 'ready'
  | 'tool_result'
  | 'state_update'
  | 'completion'
  | 'error'
  | 'pong'

export interface ReadyMessage {
  type: 'ready'
  appSlug: string
}

export interface ToolResultMessage {
  type: 'tool_result'
  correlationId: string
  success: boolean
  result?: Record<string, unknown>
  error?: string
}

export interface StateUpdateMessage {
  type: 'state_update'
  appSlug: string
  state: Record<string, unknown>
}

export interface CompletionMessage {
  type: 'completion'
  appSlug: string
  summary: string
  finalState?: Record<string, unknown>
}

export interface ErrorMessage {
  type: 'error'
  appSlug: string
  code: string
  message: string
}

export interface PongMessage {
  type: 'pong'
}

export type AppToPlatformMessage =
  | ReadyMessage
  | ToolResultMessage
  | StateUpdateMessage
  | CompletionMessage
  | ErrorMessage
  | PongMessage

// Union of both directions
export type PluginMessage = PlatformToAppMessage | AppToPlatformMessage
