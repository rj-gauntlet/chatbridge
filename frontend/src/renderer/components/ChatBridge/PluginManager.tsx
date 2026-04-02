import { useCallback, useEffect, useRef, useState } from 'react'

export interface PluginState {
  appSlug: string
  iframeUrl: string
  status: 'loading' | 'ready' | 'error'
  lastState?: Record<string, unknown>
}

interface PendingCall {
  resolve: (result: Record<string, unknown>) => void
  reject: (err: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const PLATFORM_ORIGIN = window.location.origin

/**
 * Plugin Manager — manages iframe lifecycle and postMessage relay.
 *
 * Responsibilities:
 * - Mount/unmount sandboxed iframes for active apps
 * - Listen for messages from iframes (ready, tool_result, state_update, completion, error)
 * - Relay tool invocations from SSE stream to correct iframe
 * - Return tool results back to backend via /api/chat/tool-result
 */
export function usePluginManager(apiUrl: string, getToken: () => string | null) {
  const [activePlugin, setActivePlugin] = useState<PluginState | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingCalls = useRef<Map<string, PendingCall>>(new Map())
  const completionCallbacks = useRef<Array<(summary: string, state?: Record<string, unknown>) => void>>([])

  // Listen for postMessages from iframes
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only accept messages from our own origin or the iframe's origin
      const msg = event.data as { type?: string; appSlug?: string; correlationId?: string; result?: Record<string, unknown>; error?: string; success?: boolean; state?: Record<string, unknown>; summary?: string; finalState?: Record<string, unknown>; code?: string; message?: string }

      if (!msg?.type) return

      switch (msg.type) {
        case 'ready':
          setActivePlugin(prev => prev ? { ...prev, status: 'ready' } : null)
          // Inject ChatBridge credentials into the iframe so it can call the backend
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              { type: 'auth_token', token: getToken(), apiUrl },
              '*',
            )
          }
          break

        case 'tool_result': {
          const pending = pendingCalls.current.get(msg.correlationId || '')
          if (pending) {
            clearTimeout(pending.timeoutId)
            pendingCalls.current.delete(msg.correlationId!)
            if (msg.success) {
              pending.resolve(msg.result || {})
            } else {
              pending.reject(new Error(msg.error || 'Tool failed'))
            }
          }
          break
        }

        case 'state_update':
          setActivePlugin(prev =>
            prev ? { ...prev, lastState: msg.state } : null
          )
          break

        case 'completion':
          for (const cb of completionCallbacks.current) {
            cb(msg.summary || 'App session complete', msg.finalState)
          }
          break

        case 'error':
          console.error(`[PluginManager] App error (${msg.appSlug}):`, msg.code, msg.message)
          setActivePlugin(prev => prev ? { ...prev, status: 'error' } : null)
          break

        case 'pong':
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  /** Open an app (mount iframe) */
  const openApp = useCallback((appSlug: string, iframeUrl: string) => {
    setActivePlugin({ appSlug, iframeUrl, status: 'loading' })
  }, [])

  /** Close the current app */
  const closeApp = useCallback(() => {
    if (iframeRef.current && activePlugin) {
      iframeRef.current.contentWindow?.postMessage({ type: 'app_close' }, '*')
    }
    // Clear pending calls
    for (const [, pending] of pendingCalls.current) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('App closed'))
    }
    pendingCalls.current.clear()
    setActivePlugin(null)
  }, [activePlugin])

  /**
   * Invoke a tool on the active app via postMessage relay.
   * The result comes back via tool_result message.
   */
  const invokeToolViaPostMessage = useCallback(
    async (correlationId: string, toolName: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!iframeRef.current?.contentWindow) {
        throw new Error('No active app iframe')
      }

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingCalls.current.delete(correlationId)
          reject(new Error(`Tool "${toolName}" timed out after 30s`))
        }, 30_000)

        pendingCalls.current.set(correlationId, { resolve, reject, timeoutId })

        iframeRef.current!.contentWindow!.postMessage(
          { type: 'tool_invoke', correlationId, toolName, parameters },
          '*', // In production: restrict to app's origin
        )
      })
    },
    [],
  )

  /**
   * Handle a tool_call SSE event from the backend.
   * Relays to iframe, then sends result back to backend via /api/chat/tool-result.
   */
  const handleToolCallEvent = useCallback(
    async (appSlug: string, toolName: string, correlationId: string, parameters: Record<string, unknown>) => {
      // Open the app if not already open
      if (!activePlugin || activePlugin.appSlug !== appSlug) {
        console.warn('[PluginManager] Received tool_call for inactive app:', appSlug)
        // Send failure result back to backend
        const token = getToken()
        await fetch(`${apiUrl}/api/chat/tool-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ correlationId, result: { error: 'App not open' } }),
        }).catch(console.error)
        return
      }

      try {
        const result = await invokeToolViaPostMessage(correlationId, toolName, parameters)

        // Send result back to backend
        const token = getToken()
        await fetch(`${apiUrl}/api/chat/tool-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ correlationId, result }),
        }).catch(console.error)
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Tool invocation failed'
        const token = getToken()
        await fetch(`${apiUrl}/api/chat/tool-result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ correlationId, result: { error } }),
        }).catch(console.error)
      }
    },
    [activePlugin, apiUrl, getToken, invokeToolViaPostMessage],
  )

  /** Register a completion callback */
  const onCompletion = useCallback((cb: (summary: string, state?: Record<string, unknown>) => void) => {
    completionCallbacks.current.push(cb)
    return () => {
      completionCallbacks.current = completionCallbacks.current.filter(c => c !== cb)
    }
  }, [])

  /** Called when the iframe's document finishes loading — used as a reliable ready signal */
  const onIframeLoad = useCallback(() => {
    setActivePlugin(prev => {
      if (!prev || prev.status === 'ready') return prev
      return { ...prev, status: 'ready' }
    })
    // Send auth credentials into the iframe after it's loaded
    setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'auth_token', token: getToken(), apiUrl },
          '*',
        )
      }
    }, 50)
  }, [apiUrl, getToken])

  return {
    activePlugin,
    iframeRef,
    openApp,
    closeApp,
    handleToolCallEvent,
    onCompletion,
    onIframeLoad,
  }
}

// ── PluginFrame component ─────────────────────────────────

interface PluginFrameProps {
  plugin: PluginState
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onClose: () => void
  onLoad: () => void
}

export function PluginFrame({ plugin, iframeRef, onClose, onLoad }: PluginFrameProps) {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      border: '1px solid #dee2e6',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#fff',
      marginBottom: 8,
    }}>
      {/* App header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        fontSize: 13,
      }}>
        <span style={{ fontWeight: 500, color: '#495057' }}>
          {plugin.status === 'loading' ? '⏳ Loading...' : `🎮 ${plugin.appSlug}`}
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#868e96', fontSize: 16 }}
          title="Close app"
        >
          ×
        </button>
      </div>

      {/* Sandboxed iframe */}
      <iframe
        ref={iframeRef as React.RefObject<HTMLIFrameElement>}
        src={plugin.iframeUrl}
        // Security: allow-scripts only (no allow-same-origin — prevents DOM access to parent)
        sandbox="allow-scripts allow-forms allow-popups"
        onLoad={onLoad}
        style={{
          width: '100%',
          height: 520,
          border: 'none',
          display: 'block',
          opacity: plugin.status === 'loading' ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}
        title={`ChatBridge App: ${plugin.appSlug}`}
      />
    </div>
  )
}
