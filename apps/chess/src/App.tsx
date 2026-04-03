import { Chess } from 'chess.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import {
  initBridge,
  registerTool,
  sendCompletion,
  sendStateUpdate,
} from './bridge'

type GameStatus = 'idle' | 'playing' | 'checkmate' | 'draw' | 'stalemate'

interface GameState {
  fen: string
  turn: 'w' | 'b'
  status: GameStatus
  moveHistory: string[]
  isCheck: boolean
  capturedByWhite: string[]
  capturedByBlack: string[]
}

function getInitialState(): GameState {
  return {
    fen: new Chess().fen(),
    turn: 'w',
    status: 'idle',
    moveHistory: [],
    isCheck: false,
    capturedByWhite: [],
    capturedByBlack: [],
  }
}

// ── Chess AI ───────────────────────────────────────────────────────────────

const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

// Positional bonus tables (from white's perspective, rank 1–8, file a–h)
const PAWN_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
]
const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
]

function squareIndex(sq: string): number {
  const file = sq.charCodeAt(0) - 97  // a=0
  const rank = parseInt(sq[1]) - 1    // 1=0
  return (7 - rank) * 8 + file        // board index from white's perspective
}

function evaluate(chess: Chess): number {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999
  if (chess.isDraw() || chess.isStalemate()) return 0
  let score = 0
  const board = chess.board()
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (!sq) continue
      const file = 'abcdefgh'[c]
      const rank = (8 - r).toString()
      const sqName = file + rank
      const idx = squareIndex(sqName)
      let val = PIECE_VALUES[sq.type] || 0
      if (sq.type === 'p') val += PAWN_TABLE[sq.color === 'w' ? idx : 63 - idx]
      if (sq.type === 'n') val += KNIGHT_TABLE[sq.color === 'w' ? idx : 63 - idx]
      score += sq.color === 'w' ? val : -val
    }
  }
  return score
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, isMaximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess)
  const moves = chess.moves({ verbose: true })
  // Move ordering: captures first (better alpha-beta pruning)
  moves.sort((a, b) => {
    const aCapture = a.captured ? PIECE_VALUES[a.captured] || 0 : 0
    const bCapture = b.captured ? PIECE_VALUES[b.captured] || 0 : 0
    return bCapture - aCapture
  })
  if (isMaximizing) {
    let best = -Infinity
    for (const move of moves) {
      chess.move(move)
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta, false))
      chess.undo()
      alpha = Math.max(alpha, best)
      if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const move of moves) {
      chess.move(move)
      best = Math.min(best, minimax(chess, depth - 1, alpha, beta, true))
      chess.undo()
      beta = Math.min(beta, best)
      if (beta <= alpha) break
    }
    return best
  }
}

function getBestMove(chess: Chess): { from: string; to: string; promotion?: string } | null {
  const moves = chess.moves({ verbose: true })
  if (!moves.length) return null
  const aiColor = chess.turn()
  const isMaximizing = aiColor === 'w'
  let bestMove = moves[0]
  let bestScore = isMaximizing ? -Infinity : Infinity
  moves.sort((a, b) => {
    const aCapture = a.captured ? PIECE_VALUES[a.captured] || 0 : 0
    const bCapture = b.captured ? PIECE_VALUES[b.captured] || 0 : 0
    return bCapture - aCapture
  })
  for (const move of moves) {
    chess.move(move)
    const score = minimax(chess, 2, -Infinity, Infinity, !isMaximizing)
    chess.undo()
    if (isMaximizing ? score > bestScore : score < bestScore) {
      bestScore = score
      bestMove = move
    }
  }
  return { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion || 'q' }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  const chessRef = useRef(new Chess())
  const [gameState, setGameState] = useState<GameState>(getInitialState())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [message, setMessage] = useState<string>('Waiting for game to start...')
  const [playerColor, setPlayerColor] = useState<'w' | 'b' | null>(null)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const playerColorRef = useRef<'w' | 'b' | null>(null)

  useEffect(() => { playerColorRef.current = playerColor }, [playerColor])

  const syncState = useCallback((chess: Chess, extraMessage?: string) => {
    const history = chess.history({ verbose: true })
    const capturedByWhite: string[] = []
    const capturedByBlack: string[] = []

    for (const move of history) {
      if (move.captured) {
        if (move.color === 'w') capturedByWhite.push(move.captured)
        else capturedByBlack.push(move.captured)
      }
    }

    let status: GameStatus = 'playing'
    if (chess.isCheckmate()) status = 'checkmate'
    else if (chess.isDraw()) status = 'draw'
    else if (chess.isStalemate()) status = 'stalemate'

    const newState: GameState = {
      fen: chess.fen(),
      turn: chess.turn(),
      status,
      moveHistory: chess.history(),
      isCheck: chess.inCheck(),
      capturedByWhite,
      capturedByBlack,
    }

    setGameState(newState)
    sendStateUpdate(newState as unknown as Record<string, unknown>)

    if (extraMessage) setMessage(extraMessage)

    if (status === 'checkmate') {
      const winner = chess.turn() === 'w' ? 'Black' : 'White'
      sendCompletion(`Chess game ended: ${winner} wins by checkmate`, newState as unknown as Record<string, unknown>)
      setMessage(`Checkmate! ${winner} wins! 🏆`)
    } else if (status === 'draw') {
      sendCompletion('Chess game ended in a draw', newState as unknown as Record<string, unknown>)
      setMessage("It's a draw!")
    } else if (status === 'stalemate') {
      sendCompletion('Chess game ended in stalemate', newState as unknown as Record<string, unknown>)
      setMessage('Stalemate!')
    }

    return newState
  }, [])

  // ── AI move trigger ────────────────────────────────────────────────────────

  const triggerAiMove = useCallback((chess: Chess) => {
    if (chess.isGameOver()) return
    setIsAiThinking(true)
    setMessage('🤖 AI is thinking...')
    setTimeout(() => {
      const move = getBestMove(chess)
      if (!move) { setIsAiThinking(false); return }
      try {
        chess.move(move)
        setLastMove({ from: move.from, to: move.to })
        const state = syncState(chess)
        if (state.status === 'playing') {
          const pc = playerColorRef.current
          setMessage(pc === 'w' ? '⬜ Your turn (White)' : '⬛ Your turn (Black)')
        }
      } catch { /* ignore */ }
      setIsAiThinking(false)
    }, 300)
  }, [syncState])

  useEffect(() => {
    registerTool('start_game', async (params) => {
      const chess = new Chess()
      chessRef.current = chess
      setLastMove(null)
      setIsAiThinking(false)

      // Accept optional color param: 'w' = player is white, 'b' = player is black
      const color = (params.color as string) === 'b' ? 'b' : 'w'
      setPlayerColor(color)
      playerColorRef.current = color

      const aiColor = color === 'w' ? 'b' : 'w'
      const colorLabel = color === 'w' ? 'White' : 'Black'
      syncState(chess, `♟️ New game! You play as ${colorLabel}. ${color === 'w' ? 'Your turn!' : 'AI goes first…'}`)

      // If player is black, AI (white) makes the first move
      if (color === 'b') {
        setTimeout(() => triggerAiMove(chess), 400)
      }

      return {
        success: true,
        fen: chess.fen(),
        turn: chess.turn(),
        playerColor: color,
        aiColor,
        message: (params.message as string) || `Game started. You play as ${colorLabel}.`,
      }
    })

    registerTool('make_move', async (params) => {
      const chess = chessRef.current
      const { from, to, promotion = 'q' } = params as { from: string; to: string; promotion?: string }

      if (!from || !to) throw new Error('from and to squares are required')
      if (chess.isGameOver()) throw new Error('Game is already over')

      try {
        const moveResult = chess.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' })
        if (!moveResult) throw new Error(`Illegal move: ${from} → ${to}`)

        setLastMove({ from, to })
        const state = syncState(chess, `${chess.turn() === 'w' ? 'White' : 'Black'} to move`)

        // If AI is playing and it's now AI's turn, auto-respond
        const pc = playerColorRef.current
        if (pc && chess.turn() !== pc && !chess.isGameOver()) {
          triggerAiMove(chess)
        }

        return {
          success: true,
          move: moveResult.san,
          fen: state.fen,
          turn: state.turn,
          isCheck: state.isCheck,
          isCheckmate: state.status === 'checkmate',
          isDraw: state.status === 'draw',
          moveHistory: state.moveHistory,
        }
      } catch {
        throw new Error(`Illegal move: ${from} → ${to}`)
      }
    })

    registerTool('get_board_state', async () => {
      const chess = chessRef.current
      return {
        fen: chess.fen(),
        turn: chess.turn(),
        moveHistory: chess.history(),
        isCheck: chess.inCheck(),
        isGameOver: chess.isGameOver(),
        status: gameState.status,
        capturedByWhite: gameState.capturedByWhite,
        capturedByBlack: gameState.capturedByBlack,
      }
    })

    registerTool('get_legal_moves', async (params) => {
      const chess = chessRef.current
      const { square } = params as { square?: string }

      if (square) {
        const moves = chess.moves({ square: square as Parameters<typeof chess.moves>[0]['square'], verbose: true })
        return { square, legalMoves: moves.map(m => ({ to: m.to, san: m.san, flags: m.flags })) }
      }

      const allMoves = chess.moves({ verbose: true })
      const bySquare: Record<string, string[]> = {}
      for (const m of allMoves) {
        if (!bySquare[m.from]) bySquare[m.from] = []
        bySquare[m.from].push(m.to)
      }
      return { legalMoves: bySquare, totalMoves: allMoves.length }
    })

    const origin = window.location.ancestorOrigins?.[0] || undefined
    initBridge(origin)
  }, [syncState, gameState.status, triggerAiMove])

  // ── Player drag-drop ───────────────────────────────────────────────────────

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) => {
    const chess = chessRef.current
    const pc = playerColorRef.current
    if (chess.isGameOver() || !targetSquare || isAiThinking) return false
    // Only allow moves for player's color
    if (pc && chess.turn() !== pc) return false

    try {
      const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false
      setLastMove({ from: sourceSquare, to: targetSquare })
      const state = syncState(chess)
      // Trigger AI if it's now the AI's turn
      if (pc && !chess.isGameOver() && chess.turn() !== pc) {
        triggerAiMove(chess)
      } else if (state.status === 'playing') {
        setMessage(pc === 'w' ? '⬜ Your turn (White)' : '⬛ Your turn (Black)')
      }
      return true
    } catch {
      return false
    }
  }, [syncState, triggerAiMove, isAiThinking])

  // ── Color picker ───────────────────────────────────────────────────────────

  const pickColor = useCallback((color: 'w' | 'b') => {
    const chess = new Chess()
    chessRef.current = chess
    setPlayerColor(color)
    playerColorRef.current = color
    setLastMove(null)
    setIsAiThinking(false)
    syncState(chess, color === 'w' ? '⬜ You play White. Your turn!' : '⬛ You play Black. AI goes first…')
    if (color === 'b') {
      setTimeout(() => triggerAiMove(chess), 400)
    }
  }, [syncState, triggerAiMove])

  // ── Render ────────────────────────────────────────────────────────────────

  const customSquareStyles: Record<string, React.CSSProperties> = {}
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
  }
  if (gameState.isCheck && gameState.status === 'playing') {
    const kingSquare = findKing(chessRef.current, gameState.turn)
    if (kingSquare) customSquareStyles[kingSquare] = { backgroundColor: 'rgba(255, 0, 0, 0.4)' }
  }

  const boardOrientation = playerColor === 'b' ? 'black' : 'white'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, gap: 12, minHeight: '100vh', background: '#f8f9fa' }}>

      {/* Color picker shown before game starts */}
      {playerColor === null && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#f8f9fa', gap: 24, zIndex: 10,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#333' }}>♟️ Chess</div>
          <div style={{ fontSize: 15, color: '#555' }}>Choose your color — AI plays the other</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <button
              onClick={() => pickColor('w')}
              style={{
                padding: '14px 32px', fontSize: 16, fontWeight: 600, borderRadius: 12,
                border: '2px solid #333', background: '#fff', color: '#333', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              ⬜ Play White
            </button>
            <button
              onClick={() => pickColor('b')}
              style={{
                padding: '14px 32px', fontSize: 16, fontWeight: 600, borderRadius: 12,
                border: '2px solid #333', background: '#333', color: '#fff', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            >
              ⬛ Play Black
            </button>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div style={{
        width: '100%', maxWidth: 480, padding: '8px 16px', borderRadius: 8,
        background: gameState.status === 'playing' ? (gameState.isCheck ? '#fff3cd' : '#d4edda') :
                    gameState.status === 'idle' ? '#e2e3e5' : '#d4edda',
        border: `1px solid ${gameState.isCheck ? '#ffc107' : '#c3e6cb'}`,
        textAlign: 'center', fontSize: 14, fontWeight: 500, color: '#333',
      }}>
        {message}
        {gameState.status === 'playing' && !isAiThinking && (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>
            {gameState.turn === 'w' ? '⬜ White' : '⬛ Black'} to move
            {gameState.isCheck && ' — CHECK!'}
          </span>
        )}
      </div>

      {/* Board */}
      <div style={{ width: '100%', maxWidth: 480 }}>
        <Chessboard
          options={{
            position: gameState.fen,
            onPieceDrop: onDrop,
            squareStyles: customSquareStyles,
            boardStyle: { width: Math.min(480, window.innerWidth - 32) },
            allowDrawingArrows: true,
            animationDurationInMs: 150,
            boardOrientation,
          }}
        />
      </div>

      {/* Move history */}
      {gameState.moveHistory.length > 0 && (
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Move history:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {gameState.moveHistory.map((m, i) => (
              <span key={i} style={{
                padding: '2px 6px',
                background: i % 2 === 0 ? '#e9ecef' : '#dee2e6',
                borderRadius: 4, fontSize: 12, fontFamily: 'monospace',
              }}>
                {i % 2 === 0 && <span style={{ color: '#999', marginRight: 2 }}>{Math.floor(i / 2) + 1}.</span>}
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* New game button */}
      {gameState.status !== 'idle' && gameState.status !== 'playing' && (
        <button
          onClick={() => setPlayerColor(null)}
          style={{
            padding: '10px 24px', fontSize: 14, fontWeight: 600, borderRadius: 8,
            border: 'none', background: '#333', color: '#fff', cursor: 'pointer',
          }}
        >
          New Game
        </button>
      )}
    </div>
  )
}

function findKing(chess: Chess, color: 'w' | 'b'): string | null {
  const board = chess.board()
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c]
      if (sq && sq.type === 'k' && sq.color === color) {
        const files = 'abcdefgh'
        return `${files[c]}${8 - r}`
      }
    }
  }
  return null
}
