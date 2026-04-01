import { useEffect, useRef, useState, useCallback } from 'react'
import { registerTool, initBridge, sendStateUpdate, sendCompletion } from './bridge'

// ── Types ──────────────────────────────────────────────────────────────────

interface DrawingInfo {
  strokeCount: number
  dataUrl: string
  width: number
  height: number
  lastColor: string
  lastBrushSize: number
}

type Tool = 'pen' | 'eraser'

const COLORS = ['#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff']
const BRUSH_SIZES = [2, 5, 10, 20, 40]

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(5)
  const [tool, setTool] = useState<Tool>('pen')
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  const [history, setHistory] = useState<ImageData[]>([])
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  // ── Canvas setup ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY }
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    setHistory(h => [...h.slice(-19), snapshot])
  }, [])

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    saveHistory()
    setIsDrawing(true)
    lastPos.current = getPos(e)
  }, [saveHistory])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing) return
    const ctx = getCtx()
    if (!ctx || !lastPos.current) return

    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = tool === 'eraser' ? brushSize * 3 : brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
  }, [isDrawing, color, brushSize, tool])

  const endDraw = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      setStrokeCount(s => s + 1)
      lastPos.current = null
      sendStateUpdate({ strokeCount: strokeCount + 1, tool, color, brushSize })
    }
  }, [isDrawing, strokeCount, tool, color, brushSize])

  // ── Tool handlers ──────────────────────────────────────────────────────

  const handleOpenCanvas = useCallback(async (params: Record<string, unknown>) => {
    if (params.clearExisting) {
      const canvas = canvasRef.current
      const ctx = getCtx()
      if (canvas && ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        setStrokeCount(0)
        setHistory([])
      }
    }
    sendStateUpdate({ status: 'ready', tool, color, brushSize, strokeCount: 0 })
    return { success: true, message: 'Canvas is ready for drawing', width: canvasRef.current?.width ?? 800, height: canvasRef.current?.height ?? 600 }
  }, [tool, color, brushSize])

  const handleSaveDrawing = useCallback(async (_params: Record<string, unknown>) => {
    const canvas = canvasRef.current
    if (!canvas) return { error: 'Canvas not available' }
    const dataUrl = canvas.toDataURL('image/png')
    sendStateUpdate({ saved: true, strokeCount })
    sendCompletion(`Drawing saved with ${strokeCount} strokes`, { strokeCount, dataUrl: dataUrl.slice(0, 100) + '...' })
    return { success: true, strokeCount, dataUrl: dataUrl.slice(0, 500), format: 'png', message: 'Drawing saved' }
  }, [strokeCount])

  const handleClearCanvas = useCallback(async (_params: Record<string, unknown>) => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return { error: 'Canvas not available' }
    saveHistory()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setStrokeCount(0)
    sendStateUpdate({ cleared: true, strokeCount: 0 })
    return { success: true, message: 'Canvas cleared' }
  }, [saveHistory])

  const handleGetDrawingInfo = useCallback(async (_params: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const canvas = canvasRef.current
    if (!canvas) return { error: 'Canvas not available' }
    return {
      strokeCount,
      dataUrl: canvas.toDataURL('image/png').slice(0, 200),
      width: canvas.width,
      height: canvas.height,
      lastColor: color,
      lastBrushSize: brushSize,
    }
  }, [strokeCount, color, brushSize])

  const undo = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx || history.length === 0) return
    const prev = history[history.length - 1]
    ctx.putImageData(prev, 0, 0)
    setHistory(h => h.slice(0, -1))
    setStrokeCount(s => Math.max(0, s - 1))
  }, [history])

  // Register tools
  useEffect(() => {
    registerTool('open_canvas', handleOpenCanvas)
    registerTool('save_drawing', handleSaveDrawing)
    registerTool('clear_canvas', handleClearCanvas)
    registerTool('get_drawing_info', handleGetDrawingInfo)
    initBridge()
  }, [handleOpenCanvas, handleSaveDrawing, handleClearCanvas, handleGetDrawingInfo])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        {/* Color picker */}
        <div style={styles.toolGroup}>
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool('pen') }}
              style={{
                ...styles.colorBtn,
                background: c,
                border: color === c && tool === 'pen' ? '3px solid #4f46e5' : '2px solid #d1d5db',
                boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #d1d5db' : undefined,
              }}
            />
          ))}
        </div>

        <div style={styles.divider} />

        {/* Brush sizes */}
        <div style={styles.toolGroup}>
          {BRUSH_SIZES.map(s => (
            <button
              key={s}
              onClick={() => setBrushSize(s)}
              style={{ ...styles.sizeBtn, border: brushSize === s ? '2px solid #4f46e5' : '2px solid #d1d5db' }}
            >
              <div style={{ width: s, height: s, background: color, borderRadius: '50%', maxWidth: 32, maxHeight: 32 }} />
            </button>
          ))}
        </div>

        <div style={styles.divider} />

        {/* Tool buttons */}
        <div style={styles.toolGroup}>
          <button
            onClick={() => setTool('pen')}
            style={{ ...styles.toolBtn, background: tool === 'pen' ? '#e0e7ff' : '#f9fafb', color: tool === 'pen' ? '#4f46e5' : '#374151' }}
            title="Pen"
          >✏️</button>
          <button
            onClick={() => setTool('eraser')}
            style={{ ...styles.toolBtn, background: tool === 'eraser' ? '#e0e7ff' : '#f9fafb', color: tool === 'eraser' ? '#4f46e5' : '#374151' }}
            title="Eraser"
          >🧹</button>
          <button onClick={undo} style={{ ...styles.toolBtn, background: '#f9fafb', color: '#374151' }} title="Undo" disabled={history.length === 0}>↩️</button>
        </div>

        <div style={styles.strokeCount}>
          {strokeCount} stroke{strokeCount !== 1 ? 's' : ''}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={800}
        height={520}
        style={styles.canvas}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#f3f4f6', userSelect: 'none' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: 4 },
  colorBtn: { width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', padding: 0, flexShrink: 0 },
  sizeBtn: { width: 32, height: 32, borderRadius: 6, background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 },
  toolBtn: { width: 34, height: 34, borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  divider: { width: 1, height: 28, background: '#e5e7eb' },
  strokeCount: { marginLeft: 'auto', fontSize: 12, color: '#9ca3af' },
  canvas: { flex: 1, cursor: 'crosshair', display: 'block', width: '100%', touchAction: 'none' },
}
