import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// ── localStorage polyfill for sandboxed iframes ────────────────────────────
// When running inside a sandboxed iframe without allow-same-origin the iframe
// has a null/opaque effective origin. Chrome still exposes window.localStorage
// but any read or write throws a SecurityError. The Spotify Web Playback SDK
// reads localStorage internally and silently crashes (never fires 'ready' or
// any error event) when that happens. Polyfill with an in-memory store so the
// SDK can run normally in the sandbox.
try {
  window.localStorage.getItem('__sandbox_test__')
} catch {
  const _store: Record<string, string> = {}
  const _mem = {
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null,
    setItem: (k: string, v: string) => { _store[k] = String(v) },
    removeItem: (k: string) => { delete _store[k] },
    clear: () => { for (const k of Object.keys(_store)) delete _store[k] },
    key: (i: number) => Object.keys(_store)[i] ?? null,
    get length() { return Object.keys(_store).length },
  }
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => _mem })
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => _mem })
  } catch { /* ignore if defineProperty is also blocked */ }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
