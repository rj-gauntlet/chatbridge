import { useEffect, useRef, useState } from 'react'
import {
  initBridge,
  registerTool,
  sendStateUpdate,
} from './bridge'

// ── Minimal ambient types for window.Desmos ────────────────────────────────
// The Desmos API is loaded from CDN as a global — no npm types exist.
declare global {
  interface Window {
    Desmos: {
      GraphingCalculator: (
        element: HTMLElement,
        options?: Record<string, unknown>
      ) => DesmosCalculator
    }
  }
}

interface DesmosExpression {
  id: string
  latex?: string
  color?: string
  hidden?: boolean
  type?: string
}

interface DesmosCalculator {
  setExpression(expr: DesmosExpression): void
  removeExpression(expr: { id: string }): void
  setMathBounds(bounds: { left: number; right: number; bottom: number; top: number }): void
  getExpressions(): DesmosExpression[]
  getState(): unknown
  destroy(): void
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const calcRef = useRef<DesmosCalculator | null>(null)
  const [status, setStatus] = useState<string>('Loading Desmos...')
  const [expressionCount, setExpressionCount] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return

    if (!window.Desmos) {
      setStatus('Error: Desmos API failed to load.')
      return
    }

    const calculator = window.Desmos.GraphingCalculator(containerRef.current, {
      keypad: false,
      expressions: true,
      settingsMenu: false,
      zoomButtons: true,
      expressionsTopbar: false,
    })
    calcRef.current = calculator
    setStatus('Ask me to graph something!')

    // ── add_expression ─────────────────────────────────────────────────────
    registerTool('add_expression', async (params) => {
      const calc = calcRef.current
      if (!calc) throw new Error('Calculator not initialized')

      const { id, latex, color } = params as { id?: string; latex: string; color?: string }
      if (!latex) throw new Error('latex parameter is required')

      const exprId = (id as string) || `expr_${Date.now()}`
      const expr: DesmosExpression = { id: exprId, latex }
      if (color) expr.color = color as string

      calc.setExpression(expr)

      const all = calc.getExpressions().filter(e => e.latex)
      setExpressionCount(all.length)
      setStatus(`Graphed: ${latex}`)
      sendStateUpdate({ expressions: all, expressionCount: all.length })

      return {
        success: true,
        id: exprId,
        latex,
        expressionCount: all.length,
        message: `Added expression "${latex}" with id "${exprId}"`,
      }
    })

    // ── remove_expression ──────────────────────────────────────────────────
    registerTool('remove_expression', async (params) => {
      const calc = calcRef.current
      if (!calc) throw new Error('Calculator not initialized')

      const { id } = params as { id: string }
      if (!id) throw new Error('id parameter is required')

      calc.removeExpression({ id })

      const all = calc.getExpressions().filter(e => e.latex)
      setExpressionCount(all.length)
      sendStateUpdate({ expressions: all, expressionCount: all.length })

      return {
        success: true,
        removedId: id,
        expressionCount: all.length,
        message: `Removed expression "${id}"`,
      }
    })

    // ── set_viewport ───────────────────────────────────────────────────────
    registerTool('set_viewport', async (params) => {
      const calc = calcRef.current
      if (!calc) throw new Error('Calculator not initialized')

      const { left, right, bottom, top } = params as {
        left: number; right: number; bottom: number; top: number
      }

      if (left === undefined || right === undefined || bottom === undefined || top === undefined) {
        throw new Error('left, right, bottom, and top are all required')
      }
      if (left >= right) throw new Error('left must be less than right')
      if (bottom >= top) throw new Error('bottom must be less than top')

      calc.setMathBounds({ left, right, bottom, top })

      return {
        success: true,
        viewport: { left, right, bottom, top },
        message: `Viewport set to x:[${left}, ${right}] y:[${bottom}, ${top}]`,
      }
    })

    // ── clear_graph ────────────────────────────────────────────────────────
    registerTool('clear_graph', async () => {
      const calc = calcRef.current
      if (!calc) throw new Error('Calculator not initialized')

      const all = calc.getExpressions()
      for (const expr of all) {
        if (expr.id) calc.removeExpression({ id: expr.id })
      }

      setExpressionCount(0)
      setStatus('Graph cleared.')
      sendStateUpdate({ expressions: [], expressionCount: 0 })

      return { success: true, message: 'All expressions removed from the graph' }
    })

    // ── get_expressions ────────────────────────────────────────────────────
    registerTool('get_expressions', async () => {
      const calc = calcRef.current
      if (!calc) throw new Error('Calculator not initialized')

      const all = calc.getExpressions().filter(e => e.latex)

      return {
        success: true,
        expressions: all.map(e => ({ id: e.id, latex: e.latex, color: e.color, hidden: e.hidden })),
        expressionCount: all.length,
      }
    })

    const origin = window.location.ancestorOrigins?.[0] || undefined
    initBridge(origin)

    return () => {
      calculator.destroy()
      calcRef.current = null
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>

      {/* Status bar */}
      <div style={{
        padding: '7px 14px',
        background: '#f8f9fa',
        borderBottom: '1px solid #dee2e6',
        fontSize: 12,
        color: '#495057',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: '#333', fontSize: 13 }}>📈 Desmos</span>
        <span style={{ flex: 1, color: '#666' }}>{status}</span>
        {expressionCount > 0 && (
          <span style={{
            background: '#0d6efd', color: '#fff',
            borderRadius: 12, padding: '2px 9px',
            fontSize: 11, fontWeight: 700,
          }}>
            {expressionCount} expr{expressionCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Calculator fills remaining space */}
      <div ref={containerRef} style={{ flex: 1, width: '100%' }} />

    </div>
  )
}
