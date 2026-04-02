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

export default function App() {
  const chessRef = useRef(new Chess())
  const [gameState, setGameState] = useState<GameState>(getInitialState())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [message, setMessage] = useState<string>('Waiting for game to start...')

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

    // Signal completion when game ends
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

  useEffect(() => {
    // Register all tool handlers
    registerTool('start_game', async (params) => {
      const chess = new Chess()
      chessRef.current = chess
      setLastMove(null)
      const state = syncState(chess, '♟️ New game started! White goes first.')
      return {
        success: true,
        fen: state.fen,
        turn: state.turn,
        message: (params.message as string) || 'Game started. White moves first.',
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

    // Initialize the postMessage bridge
    const origin = window.location.ancestorOrigins?.[0] || undefined
    initBridge(origin)
  }, [syncState, gameState.status])

  // Allow player to move pieces directly on the board too
  const onDrop = useCallback(({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) => {
    const chess = chessRef.current
    if (chess.isGameOver() || !targetSquare) return false

    try {
      const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false
      setLastMove({ from: sourceSquare, to: targetSquare })
      syncState(chess)
      return true
    } catch {
      return false
    }
  }, [syncState])

  const customSquareStyles: Record<string, React.CSSProperties> = {}
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
  }
  if (gameState.isCheck && gameState.status === 'playing') {
    const kingSquare = findKing(chessRef.current, gameState.turn)
    if (kingSquare) customSquareStyles[kingSquare] = { backgroundColor: 'rgba(255, 0, 0, 0.4)' }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, gap: 12, minHeight: '100vh', background: '#f8f9fa' }}>
      {/* Status bar */}
      <div style={{
        width: '100%',
        maxWidth: 480,
        padding: '8px 16px',
        borderRadius: 8,
        background: gameState.status === 'playing' ? (gameState.isCheck ? '#fff3cd' : '#d4edda') :
                    gameState.status === 'idle' ? '#e2e3e5' : '#d4edda',
        border: `1px solid ${gameState.isCheck ? '#ffc107' : '#c3e6cb'}`,
        textAlign: 'center',
        fontSize: 14,
        fontWeight: 500,
        color: '#333',
      }}>
        {message}
        {gameState.status === 'playing' && (
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
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'monospace',
              }}>
                {i % 2 === 0 && <span style={{ color: '#999', marginRight: 2 }}>{Math.floor(i / 2) + 1}.</span>}
                {m}
              </span>
            ))}
          </div>
        </div>
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
