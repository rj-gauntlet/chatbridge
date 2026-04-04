/**
 * ChatBridge postMessage bridge — Spotify app side.
 * Handles incoming tool invocations and sends results/state back to platform.
 */

export type ToolHandler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>

const APP_SLUG = 'spotify'
let handlers: Map<string, ToolHandler> = new Map()
let allowedOrigin: string | null = null

// Auth credentials injected by the platform via auth_token postMessage
let chatbridgeToken = ''
let chatbridgeApiUrl = ''

// Resolves when the first auth_token message is received from the platform.
// Callers can await waitForBridge() before making API calls so they always
// use the injected Railway URL instead of falling back to localhost:3001.
let _bridgeReadyResolve: (() => void) | null = null
const _bridgeReadyPromise = new Promise<void>(resolve => { _bridgeReadyResolve = resolve })

/**
 * Returns a promise that resolves when the platform sends the first auth_token,
 * or after timeoutMs (default 3 s) — whichever comes first. The timeout allows
 * the app to work in standalone / local-dev mode without a parent frame.
 */
export function waitForBridge(timeoutMs = 3000): Promise<void> {
  return Promise.race([
    _bridgeReadyPromise,
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ])
}

// Explicit content filter — toggled from the parent chat UI
let explicitFilterEnabled = false

export function getToken(): string { return chatbridgeToken }
export function getApiUrl(): string { return chatbridgeApiUrl || 'http://localhost:3001' }
export function getExplicitFilter(): boolean { return explicitFilterEnabled }

export function registerTool(name: string, handler: ToolHandler) {
  handlers.set(name, handler)
}

function sendToParent(msg: object) {
  window.parent.postMessage(msg, allowedOrigin || '*')
}

export function signalReady() {
  sendToParent({ type: 'ready', appSlug: APP_SLUG })
}

export function sendStateUpdate(state: Record<string, unknown>) {
  sendToParent({ type: 'state_update', appSlug: APP_SLUG, state })
}

export function sendCompletion(summary: string, finalState?: Record<string, unknown>) {
  sendToParent({ type: 'completion', appSlug: APP_SLUG, summary, finalState })
}

export function sendError(code: string, message: string) {
  sendToParent({ type: 'error', appSlug: APP_SLUG, code, message })
}

export function initBridge(trustedOrigin?: string) {
  allowedOrigin = trustedOrigin || null

  window.addEventListener('message', async (event) => {
    if (allowedOrigin && event.origin !== allowedOrigin) return

    const msg = event.data as { type?: string; correlationId?: string; toolName?: string; parameters?: Record<string, unknown> }

    if (msg.type === 'auth_token') {
      const m = msg as unknown as { type: string; token?: string; apiUrl?: string }
      chatbridgeToken = m.token || ''
      chatbridgeApiUrl = m.apiUrl || ''
      // Unblock any waitForBridge() callers on the first auth_token received
      if (_bridgeReadyResolve) {
        _bridgeReadyResolve()
        _bridgeReadyResolve = null
      }
      return
    }

    if (msg.type === 'explicit_filter') {
      const m = msg as unknown as { type: string; enabled: boolean }
      explicitFilterEnabled = m.enabled
      return
    }

    if (msg.type === 'ping') {
      sendToParent({ type: 'pong' })
      return
    }

    if (msg.type === 'app_close') {
      sendCompletion('Spotify session ended by platform')
      return
    }

    if (msg.type === 'tool_invoke') {
      const { correlationId, toolName, parameters = {} } = msg
      if (!toolName || !correlationId) return

      const handler = handlers.get(toolName)
      if (!handler) {
        sendToParent({ type: 'tool_result', correlationId, success: false, error: `Unknown tool: ${toolName}` })
        return
      }

      try {
        const result = await handler(parameters)
        sendToParent({ type: 'tool_result', correlationId, success: true, result })
      } catch (err) {
        sendToParent({
          type: 'tool_result',
          correlationId,
          success: false,
          error: err instanceof Error ? err.message : 'Tool execution failed',
        })
      }
    }
  })

  setTimeout(signalReady, 100)
}
