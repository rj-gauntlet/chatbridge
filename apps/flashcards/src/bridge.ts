/**
 * ChatBridge postMessage bridge — flashcards app side.
 * Handles incoming tool invocations and sends results/state back to platform.
 */

export type ToolHandler = (params: Record<string, unknown>) => Promise<Record<string, unknown>>

const APP_SLUG = 'flashcards'
let handlers: Map<string, ToolHandler> = new Map()
let allowedOrigin: string | null = null

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

    if (msg.type === 'ping') {
      sendToParent({ type: 'pong' })
      return
    }

    if (msg.type === 'app_close') {
      sendCompletion('Flashcard session ended by platform')
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
