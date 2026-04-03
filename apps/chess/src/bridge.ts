/**
 * ChatBridge postMessage bridge — chess app side.
 * Handles incoming tool invocations and sends results/state back to platform.
 */

export type ToolHandler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>

const APP_SLUG = 'chess'
const handlers: Map<string, ToolHandler> = new Map()
let allowedOrigin: string | null = null
let bridgeInitialized = false  // Guard: prevent adding multiple message listeners

/** Register a tool handler */
export function registerTool(name: string, handler: ToolHandler) {
  handlers.set(name, handler)
}

/** Send a message to the parent platform */
function sendToParent(msg: object) {
  window.parent.postMessage(msg, allowedOrigin || '*')
}

/** Signal that the app is ready */
export function signalReady() {
  sendToParent({ type: 'ready', appSlug: APP_SLUG })
}

/** Send a state update to the platform (chatbot receives this as context) */
export function sendStateUpdate(state: Record<string, unknown>) {
  sendToParent({ type: 'state_update', appSlug: APP_SLUG, state })
}

/** Notify the platform that the player made a manual move (drag-and-drop on the board) */
export function sendManualMove(move: { from: string; to: string; san: string }, state: Record<string, unknown>) {
  sendToParent({ type: 'manual_move', appSlug: APP_SLUG, move, state })
}

/** Signal that the app has completed its session */
export function sendCompletion(summary: string, finalState?: Record<string, unknown>) {
  sendToParent({ type: 'completion', appSlug: APP_SLUG, summary, finalState })
}

/** Send an error to the platform */
export function sendError(code: string, message: string) {
  sendToParent({ type: 'error', appSlug: APP_SLUG, code, message })
}

/** Listen for incoming tool invocations from the platform.
 *  Safe to call multiple times — only initializes the listener once. */
export function initBridge(trustedOrigin?: string) {
  allowedOrigin = trustedOrigin || null

  if (bridgeInitialized) {
    // Already listening — just re-signal ready so the platform knows we're up
    setTimeout(signalReady, 100)
    return
  }
  bridgeInitialized = true

  window.addEventListener('message', async (event) => {
    // Origin validation — in production this checks against known platform origin
    if (allowedOrigin && event.origin !== allowedOrigin) return

    const msg = event.data as {
      type?: string
      correlationId?: string
      toolName?: string
      parameters?: Record<string, unknown>
    }

    if (msg.type === 'ping') {
      sendToParent({ type: 'pong' })
      return
    }

    if (msg.type === 'app_close') {
      sendCompletion('Chess session ended by platform')
      return
    }

    if (msg.type === 'tool_invoke') {
      const { correlationId, toolName, parameters = {} } = msg
      if (!toolName || !correlationId) return

      const handler = handlers.get(toolName)
      if (!handler) {
        sendToParent({
          type: 'tool_result',
          correlationId,
          success: false,
          error: `Unknown tool: ${toolName}`,
        })
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

  // Signal ready after a tick so React has mounted
  setTimeout(signalReady, 100)
}
