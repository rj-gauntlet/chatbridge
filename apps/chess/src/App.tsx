import { Chess } from 'chess.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import {
  initBridge,
  registerTool,
  sendCompletion,
  sendManualMove,
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
  const file = sq.charCodeAt(0) - 97
  const rank = parseInt(sq[1]) - 1
  return (7 - rank) * 8 + file
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

// ── Opening name detection ─────────────────────────────────────────────────

function detectOpening(moveHistory: string[]): string | null {
  const h = moveHistory
  if (h.length < 2) return null
  if (h[0] === 'e4' && h[1] === 'e5') {
    if (h[2] === 'Nf3' && h[3] === 'Nc6' && h[4] === 'Bc4') return 'Italian Game'
    if (h[2] === 'Nf3' && h[3] === 'Nc6' && h[4] === 'Bb5') return 'Ruy López'
    if (h[2] === 'Nf3' && h[3] === 'Nc6') return 'King\'s Knight Opening'
    return 'Open Game (1.e4 e5)'
  }
  if (h[0] === 'e4' && h[1] === 'c5') return 'Sicilian Defense'
  if (h[0] === 'e4' && h[1] === 'e6') return 'French Defense'
  if (h[0] === 'e4' && h[1] === 'c6') return 'Caro-Kann Defense'
  if (h[0] === 'e4' && h[1] === 'Nf6') return 'Alekhine\'s Defense'
  if (h[0] === 'd4' && h[1] === 'd5' && h[2] === 'c4') return 'Queen\'s Gambit'
  if (h[0] === 'd4' && h[1] === 'Nf6' && h[2] === 'c4') return 'Indian Defense'
  if (h[0] === 'd4' && h[1] === 'd5') return 'Closed Game (1.d4 d5)'
  if (h[0] === 'Nf3') return 'Réti Opening'
  if (h[0] === 'c4') return 'English Opening'
  return null
}

// ── Component ──────────────────────────────────────────────────────────────

export default function App() {
  const chessRef = useRef(new Chess())
  const [gameState, setGameState] = useState<GameState>(getInitialState())
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null)
  const [message, setMessage] = useState<string>('Waiting for game to start...')
  const [playerColor, setPlayerColor] = useState<'w' | 'b' | null>(null)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [openingName, setOpeningName] = useState<string | null>(null)

  // Refs — give tool handlers access to latest values without stale closures
  const playerColorRef = useRef<'w' | 'b' | null>(null)
  const gameStateRef = useRef<GameState>(getInitialState())

  // Keep refs in sync with state
  useEffect(() => { playerColorRef.current = playerColor }, [playerColor])
  useEffect(() => { gameStateRef.current = gameState }, [gameState])

  // ── syncState ─────────────────────────────────────────────────────────────

  const syncState = useCallback((chess: Chess, extraMessage?: string): GameState => {
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

    const moveHistory = chess.history()
    const newState: GameState = {
      fen: chess.fen(),
      turn: chess.turn(),
      status,
      moveHistory,
      isCheck: chess.inCheck(),
      capturedByWhite,
      capturedByBlack,
    }

    setGameState(newState)
    gameStateRef.current = newState
    sendStateUpdate(newState as unknown as Record<string, unknown>)

    // Detect opening
    const opening = detectOpening(moveHistory)
    if (opening) setOpeningName(opening)

    if (extraMessage) setMessage(extraMessage)

    if (status === 'checkmate') {
      const winner = chess.turn() === 'w' ? 'Black' : 'White'
      sendCompletion(`Chess game ended: ${winner} wins by checkmate`, newState as unknown as Record<string, unknown>)
      setMessage(`Checkmate! ${winner} wins! 🏆`)
    } else if (status === 'draw') {
      sendCompletion('Chess game ended in a draw', newState as unknown as Record<string, unknown>)
      setMessage("It's a draw! 🤝")
    } else if (status === 'stalemate') {
      sendCompletion('Chess game ended in stalemate', newState as unknown as Record<string, unknown>)
      setMessage('Stalemate! 🤝')
    }

    return newState
  }, [])

  // ── AI move trigger (async — awaitable) ───────────────────────────────────

  const triggerAiMove = useCallback(async (chess: Chess): Promise<GameState> => {
    if (chess.isGameOver()) return syncState(chess)
    setIsAiThinking(true)
    setMessage('🤖 AI is thinking...')

    // Small delay so the user sees the board update before AI responds
    await new Promise(resolve => setTimeout(resolve, 400))

    const move = getBestMove(chess)
    if (!move) {
      setIsAiThinking(false)
      return syncState(chess)
    }

    try {
      chess.move(move)
      setLastMove({ from: move.from, to: move.to })
      const state = syncState(chess)
      if (state.status === 'playing') {
        const pc = playerColorRef.current
        setMessage(pc === 'w' ? '⬜ Your turn (White)' : '⬛ Your turn (Black)')
      }
      setIsAiThinking(false)
      return state
    } catch {
      setIsAiThinking(false)
      return syncState(chess)
    }
  }, [syncState])

  // ── Tool registration — runs ONCE on mount (empty deps, refs for all mutable state) ──

  useEffect(() => {
    // ── start_game ──────────────────────────────────────────────────────────
    registerTool('start_game', async (params) => {
      const chess = new Chess()
      chessRef.current = chess
      setLastMove(null)
      setIsAiThinking(false)
      setOpeningName(null)

      // Accept optional color param: 'w' = player is white, 'b' = player is black
      const color = (params.color as string) === 'b' ? 'b' : 'w'
      setPlayerColor(color)
      playerColorRef.current = color

      const aiColor = color === 'w' ? 'b' : 'w'
      const colorLabel = color === 'w' ? 'White' : 'Black'

      syncState(chess, color === 'w'
        ? `♟️ New game! You play as White. Your turn!`
        : `♟️ New game! You play as Black. AI goes first…`)

      // If player is Black, AI (White) makes the first move — await it so we
      // can include the AI's opening move in the tool result.
      let aiFirstMove: string | null = null
      if (color === 'b') {
        const afterFirstMove = await triggerAiMove(chess)
        aiFirstMove = afterFirstMove.moveHistory[0] || null
      }

      return {
        success: true,
        fen: chessRef.current.fen(),
        turn: chessRef.current.turn(),
        playerColor: color,
        aiColor,
        aiFirstMove,
        message: aiFirstMove
          ? `Game started. You play as ${colorLabel}. I opened with ${aiFirstMove}.`
          : `Game started. You play as ${colorLabel}.`,
      }
    })

    // ── make_move ───────────────────────────────────────────────────────────
    registerTool('make_move', async (params) => {
      const chess = chessRef.current
      const { from, to, promotion = 'q' } = params as { from: string; to: string; promotion?: string }

      if (!from || !to) throw new Error('from and to squares are required')
      if (chess.isGameOver()) throw new Error('Game is already over')

      // Validate it's the player's turn
      const pc = playerColorRef.current
      if (pc && chess.turn() !== pc) {
        throw new Error(`It is ${chess.turn() === 'w' ? 'White' : 'Black'}'s turn, not yours.`)
      }

      let moveResult
      try {
        moveResult = chess.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' })
        if (!moveResult) throw new Error(`Illegal move: ${from} → ${to}`)
      } catch {
        throw new Error(`Illegal move: ${from} → ${to}`)
      }

      setLastMove({ from, to })
      const stateAfterPlayer = syncState(chess)
      const playerMoveSan = moveResult.san

      // If AI's turn now, await the AI's response so the result includes both moves
      let finalState = stateAfterPlayer
      let aiMoveSan: string | null = null

      if (pc && !chess.isGameOver() && chess.turn() !== pc) {
        const prevLen = chess.history().length
        finalState = await triggerAiMove(chess)
        if (finalState.moveHistory.length > prevLen) {
          aiMoveSan = finalState.moveHistory[finalState.moveHistory.length - 1]
        }
      }

      return {
        success: true,
        playerMove: playerMoveSan,
        aiMove: aiMoveSan,
        fen: finalState.fen,
        turn: finalState.turn,
        isCheck: finalState.isCheck,
        isCheckmate: finalState.status === 'checkmate',
        isDraw: finalState.status === 'draw',
        moveHistory: finalState.moveHistory,
        message: aiMoveSan
          ? `You played ${playerMoveSan}, I responded with ${aiMoveSan}.`
          : `You played ${playerMoveSan}.`,
      }
    })

    // ── get_board_state ─────────────────────────────────────────────────────
    registerTool('get_board_state', async () => {
      const chess = chessRef.current
      const gs = gameStateRef.current
      return {
        fen: chess.fen(),
        turn: chess.turn(),
        turnLabel: chess.turn() === 'w' ? 'White' : 'Black',
        playerColor: playerColorRef.current,
        moveHistory: chess.history(),
        isCheck: chess.inCheck(),
        isGameOver: chess.isGameOver(),
        status: gs.status,
        capturedByWhite: gs.capturedByWhite,
        capturedByBlack: gs.capturedByBlack,
        openingName: detectOpening(chess.history()),
      }
    })

    // ── get_legal_moves ─────────────────────────────────────────────────────
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — syncState and triggerAiMove are stable; mutable state accessed via refs

  // Keep triggerAiMove ref in sync for the empty-dep useEffect closure
  // (both are useCallback with [] or [syncState] deps so they're stable, but
  //  we register them once via the above effect — the closures capture the
  //  stable function references directly, which is safe.)

  // ── Player drag-drop ───────────────────────────────────────────────────────

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { piece: unknown; sourceSquare: string; targetSquare: string | null }) => {
    const chess = chessRef.current
    const pc = playerColorRef.current
    if (chess.isGameOver() || !targetSquare || isAiThinking) return false
    if (pc && chess.turn() !== pc) return false

    try {
      const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' })
      if (!move) return false
      setLastMove({ from: sourceSquare, to: targetSquare })
      const newState = syncState(chess)
      // Notify parent platform that a manual move was made so the AI can comment on it
      sendManualMove(
        { from: sourceSquare, to: targetSquare, san: move.san },
        newState as unknown as Record<string, unknown>,
      )
      // Trigger AI (fire-and-forget for drag-drop; no need to await)
      if (pc && !chess.isGameOver() && chess.turn() !== pc) {
        triggerAiMove(chess)
      }
      return true
    } catch {
      return false
    }
  }, [syncState, triggerAiMove, isAiThinking])

  // ── Color picker (manual in-iframe selection) ──────────────────────────────

  const pickColor = useCallback((color: 'w' | 'b') => {
    const chess = new Chess()
    chessRef.current = chess
    setPlayerColor(color)
    playerColorRef.current = color
    setLastMove(null)
    setIsAiThinking(false)
    setOpeningName(null)
    syncState(chess, color === 'w' ? '⬜ You play White. Your turn!' : '⬛ You play Black. AI goes first…')
    if (color === 'b') {
      triggerAiMove(chess) // fire-and-forget for manual pick
    }
  }, [syncState, triggerAiMove])

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetGame = useCallback(() => {
    setPlayerColor(null)
    playerColorRef.current = null
    setOpeningName(null)
    setLastMove(null)
    setIsAiThinking(false)
    setMessage('Choose your color to start a new game.')
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  const customSquareStyles: Record<string, React.CSSProperties> = {}
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
    customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(255, 214, 0, 0.4)' }
  }
  if (gameState.isCheck && gameState.status === 'playing') {
    const kingSquare = findKing(chessRef.current, gameState.turn)
    if (kingSquare) customSquareStyles[kingSquare] = { backgroundColor: 'rgba(255, 0, 0, 0.5)' }
  }

  const boardOrientation = playerColor === 'b' ? 'black' : 'white'

  const isGameOver = gameState.status !== 'idle' && gameState.status !== 'playing'

  // Pair moves for display: [[1, 'e4', 'e5'], [2, 'Nf3', 'Nc6'], ...]
  const pairedMoves: Array<[number, string, string | undefined]> = []
  for (let i = 0; i < gameState.moveHistory.length; i += 2) {
    pairedMoves.push([
      Math.floor(i / 2) + 1,
      gameState.moveHistory[i],
      gameState.moveHistory[i + 1],
    ])
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 16px',
      gap: 10,
      minHeight: '100vh',
      background: '#f8f9fa',
      boxSizing: 'border-box',
    }}>

      {/* Color picker overlay — shown before game starts */}
      {playerColor === null && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#f8f9fa', gap: 24, zIndex: 10,
        }}>
          <div style={{ fontSize: 32 }}>♟️</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#222' }}>Chess</div>
          <div style={{ fontSize: 14, color: '#666' }}>Choose your color — AI plays the other side</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <button onClick={() => pickColor('w')} style={{
              padding: '14px 28px', fontSize: 15, fontWeight: 600, borderRadius: 12,
              border: '2px solid #333', background: '#fff', color: '#333', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}>⬜ Play White</button>
            <button onClick={() => pickColor('b')} style={{
              padding: '14px 28px', fontSize: 15, fontWeight: 600, borderRadius: 12,
              border: '2px solid #333', background: '#333', color: '#fff', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}>⬛ Play Black</button>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div style={{
        width: '100%', maxWidth: 480,
        padding: '8px 14px', borderRadius: 8,
        background: gameState.isCheck
          ? '#fff3cd'
          : isGameOver ? '#d1ecf1'
          : '#d4edda',
        border: `1px solid ${gameState.isCheck ? '#ffc107' : isGameOver ? '#bee5eb' : '#c3e6cb'}`,
        textAlign: 'center', fontSize: 13, fontWeight: 500, color: '#333',
        flexShrink: 0,
      }}>
        <span>{message}</span>
        {gameState.status === 'playing' && !isAiThinking && (
          <span style={{ marginLeft: 6, opacity: 0.65 }}>
            — {gameState.turn === 'w' ? '⬜ White' : '⬛ Black'} to move
            {gameState.isCheck && ' ⚠️ CHECK!'}
          </span>
        )}
      </div>

      {/* Opening name badge */}
      {openingName && gameState.status === 'playing' && (
        <div style={{
          fontSize: 11, color: '#6c757d',
          background: '#e9ecef', borderRadius: 12,
          padding: '2px 10px', fontStyle: 'italic',
        }}>
          📖 {openingName}
        </div>
      )}

      {/* Board */}
      <div style={{ width: '100%', maxWidth: 480, flexShrink: 0 }}>
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

      {/* Captured pieces */}
      {(gameState.capturedByWhite.length > 0 || gameState.capturedByBlack.length > 0) && (
        <div style={{ width: '100%', maxWidth: 480, fontSize: 12, color: '#555', display: 'flex', gap: 16 }}>
          {gameState.capturedByWhite.length > 0 && (
            <span>⬜ captured: {gameState.capturedByWhite.map(p => PIECE_SYMBOLS[p] || p).join(' ')}</span>
          )}
          {gameState.capturedByBlack.length > 0 && (
            <span>⬛ captured: {gameState.capturedByBlack.map(p => PIECE_SYMBOLS[p] || p).join(' ')}</span>
          )}
        </div>
      )}

      {/* Move history — scrollable, paired notation */}
      {pairedMoves.length > 0 && (
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Move history
          </div>
          <div style={{
            display: 'flex', flexWrap: 'nowrap', gap: 4,
            overflowX: 'auto', paddingBottom: 4,
            scrollbarWidth: 'thin',
          }}>
            {pairedMoves.map(([num, white, black]) => (
              <span key={num} style={{
                display: 'inline-flex', gap: 3, alignItems: 'center',
                padding: '2px 6px', background: '#e9ecef', borderRadius: 4,
                fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                <span style={{ color: '#999' }}>{num}.</span>
                <span>{white}</span>
                {black && <span style={{ color: '#555' }}>{black}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* New Game button — always shown once a game is active */}
      {playerColor !== null && (
        <button
          onClick={resetGame}
          style={{
            padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
            border: '1px solid #adb5bd', background: isGameOver ? '#333' : '#fff',
            color: isGameOver ? '#fff' : '#495057',
            cursor: 'pointer', marginTop: 4,
          }}
        >
          {isGameOver ? '🔄 New Game' : '↩ New Game'}
        </button>
      )}
    </div>
  )
}

// ── Piece symbol map ──────────────────────────────────────────────────────

const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
