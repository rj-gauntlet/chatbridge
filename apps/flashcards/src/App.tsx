import { useEffect, useState, useCallback } from 'react'
import { registerTool, initBridge, sendStateUpdate, sendCompletion } from './bridge'

// ── Types ──────────────────────────────────────────────────────────────────

interface Flashcard {
  id: number
  question: string
  answer: string
  topic: string
}

interface QuizState {
  cards: Flashcard[]
  currentIndex: number
  score: number
  total: number
  answers: { cardId: number; correct: boolean; userAnswer: string }[]
  status: 'idle' | 'active' | 'answered' | 'complete'
  topic: string
  revealed: boolean
}

// ── Sample card bank ───────────────────────────────────────────────────────

const CARD_BANK: Record<string, Flashcard[]> = {
  math: [
    { id: 1, question: 'What is 12 × 8?', answer: '96', topic: 'math' },
    { id: 2, question: 'What is the square root of 144?', answer: '12', topic: 'math' },
    { id: 3, question: 'What is 15% of 200?', answer: '30', topic: 'math' },
    { id: 4, question: 'What is 7²?', answer: '49', topic: 'math' },
    { id: 5, question: 'Solve: 3x + 6 = 21. What is x?', answer: '5', topic: 'math' },
  ],
  science: [
    { id: 10, question: 'What is the chemical symbol for water?', answer: 'H₂O', topic: 'science' },
    { id: 11, question: 'How many planets are in our solar system?', answer: '8', topic: 'science' },
    { id: 12, question: 'What gas do plants absorb during photosynthesis?', answer: 'Carbon dioxide (CO₂)', topic: 'science' },
    { id: 13, question: 'What is the powerhouse of the cell?', answer: 'Mitochondria', topic: 'science' },
    { id: 14, question: 'What force keeps planets in orbit around the sun?', answer: 'Gravity', topic: 'science' },
  ],
  history: [
    { id: 20, question: 'In what year did World War II end?', answer: '1945', topic: 'history' },
    { id: 21, question: 'Who was the first President of the United States?', answer: 'George Washington', topic: 'history' },
    { id: 22, question: 'In what year did the American Civil War begin?', answer: '1861', topic: 'history' },
    { id: 23, question: 'What document declared American independence?', answer: 'The Declaration of Independence', topic: 'history' },
    { id: 24, question: 'Who invented the telephone?', answer: 'Alexander Graham Bell', topic: 'history' },
  ],
  vocabulary: [
    { id: 30, question: 'What does "benevolent" mean?', answer: 'Kind and generous; wishing good to others', topic: 'vocabulary' },
    { id: 31, question: 'What does "ephemeral" mean?', answer: 'Lasting for a very short time', topic: 'vocabulary' },
    { id: 32, question: 'What does "pragmatic" mean?', answer: 'Dealing with things sensibly and realistically', topic: 'vocabulary' },
    { id: 33, question: 'What does "ubiquitous" mean?', answer: 'Present, appearing, or found everywhere', topic: 'vocabulary' },
    { id: 34, question: 'What does "eloquent" mean?', answer: 'Fluent or persuasive in speaking or writing', topic: 'vocabulary' },
  ],
}

function getCards(topic: string, count: number): Flashcard[] {
  const pool = CARD_BANK[topic.toLowerCase()] || CARD_BANK.math
  return pool.slice(0, Math.min(count, pool.length))
}

// ── Component ──────────────────────────────────────────────────────────────

const initialState: QuizState = {
  cards: [],
  currentIndex: 0,
  score: 0,
  total: 0,
  answers: [],
  status: 'idle',
  topic: '',
  revealed: false,
}

export default function App() {
  const [quiz, setQuiz] = useState<QuizState>(initialState)
  const [userInput, setUserInput] = useState('')

  const currentCard = quiz.cards[quiz.currentIndex] ?? null

  // ── Tool handlers ──────────────────────────────────────────────────────

  const handleStartQuiz = useCallback(async (params: Record<string, unknown>) => {
    const topic = (params.topic as string) || 'math'
    const count = Math.min(Math.max((params.cardCount as number) || 5, 1), 10)
    const cards = getCards(topic, count)

    const newState: QuizState = {
      cards,
      currentIndex: 0,
      score: 0,
      total: cards.length,
      answers: [],
      status: 'active',
      topic,
      revealed: false,
    }
    setQuiz(newState)
    setUserInput('')

    sendStateUpdate({ status: 'active', topic, totalCards: cards.length, currentQuestion: 1 })
    return { success: true, topic, totalCards: cards.length, firstQuestion: cards[0]?.question ?? '' }
  }, [])

  const handleGetQuestion = useCallback(async (_params: Record<string, unknown>) => {
    if (quiz.status !== 'active' && quiz.status !== 'answered') {
      return { error: 'No active quiz. Call start_quiz first.' }
    }
    const card = quiz.cards[quiz.currentIndex]
    if (!card) return { error: 'No more questions.' }
    return {
      questionNumber: quiz.currentIndex + 1,
      totalQuestions: quiz.total,
      question: card.question,
      topic: card.topic,
    }
  }, [quiz])

  const handleSubmitAnswer = useCallback(async (params: Record<string, unknown>) => {
    const answer = String(params.answer || '').trim()
    if (quiz.status !== 'active') {
      return { error: 'No active question to answer.' }
    }

    const card = quiz.cards[quiz.currentIndex]
    if (!card) return { error: 'No current card.' }

    const correct = answer.toLowerCase() === card.answer.toLowerCase()

    setQuiz(prev => ({
      ...prev,
      score: correct ? prev.score + 1 : prev.score,
      answers: [...prev.answers, { cardId: card.id, correct, userAnswer: answer }],
      status: 'answered',
      revealed: true,
    }))

    return {
      correct,
      correctAnswer: card.answer,
      userAnswer: answer,
      score: quiz.score + (correct ? 1 : 0),
      questionsRemaining: quiz.total - quiz.currentIndex - 1,
    }
  }, [quiz])

  const handleGetResults = useCallback(async (_params: Record<string, unknown>) => {
    const pct = quiz.total > 0 ? Math.round((quiz.score / quiz.total) * 100) : 0
    const results = {
      score: quiz.score,
      total: quiz.total,
      percentage: pct,
      topic: quiz.topic,
      breakdown: quiz.answers.map((a, i) => ({
        question: quiz.cards[i]?.question ?? '',
        correct: a.correct,
        userAnswer: a.userAnswer,
        correctAnswer: quiz.cards[i]?.answer ?? '',
      })),
      grade: pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F',
    }

    if (quiz.status === 'complete' || quiz.answers.length === quiz.total) {
      sendCompletion(`Quiz complete! Score: ${quiz.score}/${quiz.total} (${pct}%)`, results)
    }

    return results
  }, [quiz])

  // Advance to next card when in 'answered' state
  const advanceCard = useCallback(() => {
    setQuiz(prev => {
      const next = prev.currentIndex + 1
      if (next >= prev.total) {
        const pct = Math.round((prev.score / prev.total) * 100)
        sendStateUpdate({ status: 'complete', score: prev.score, total: prev.total, percentage: pct })
        return { ...prev, status: 'complete', revealed: false }
      }
      sendStateUpdate({ status: 'active', currentQuestion: next + 1, totalCards: prev.total })
      return { ...prev, currentIndex: next, status: 'active', revealed: false }
    })
    setUserInput('')
  }, [])

  // Register tools
  useEffect(() => {
    registerTool('start_quiz', handleStartQuiz)
    registerTool('get_question', handleGetQuestion)
    registerTool('submit_answer', handleSubmitAnswer)
    registerTool('get_results', handleGetResults)
    initBridge()
  }, [handleStartQuiz, handleGetQuestion, handleSubmitAnswer, handleGetResults])

  // ── Manual answer submission (user types in the box) ──────────────────

  const handleManualSubmit = async () => {
    if (!userInput.trim() || quiz.status !== 'active') return
    await handleSubmitAnswer({ answer: userInput })
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const pct = quiz.total > 0 ? Math.round((quiz.score / quiz.total) * 100) : 0

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <span style={styles.headerIcon}>📚</span>
        <span style={styles.headerTitle}>Flashcard Quiz</span>
        {quiz.status !== 'idle' && (
          <span style={styles.badge}>{quiz.topic}</span>
        )}
      </header>

      {quiz.status === 'idle' && (
        <div style={styles.idle}>
          <div style={styles.idleIcon}>🃏</div>
          <h2 style={styles.idleTitle}>Ready to study?</h2>
          <p style={styles.idleSubtitle}>Ask the AI to start a quiz on any topic:<br />math, science, history, or vocabulary</p>
          <div style={styles.topicGrid}>
            {Object.keys(CARD_BANK).map(t => (
              <div key={t} style={styles.topicChip}>{t}</div>
            ))}
          </div>
        </div>
      )}

      {(quiz.status === 'active' || quiz.status === 'answered') && currentCard && (
        <div style={styles.quizArea}>
          <div style={styles.progress}>
            <span>Question {quiz.currentIndex + 1} of {quiz.total}</span>
            <span>Score: {quiz.score}/{quiz.currentIndex + (quiz.status === 'answered' ? 1 : 0)}</span>
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${((quiz.currentIndex) / quiz.total) * 100}%` }} />
          </div>

          <div style={styles.card}>
            <div style={styles.cardQuestion}>{currentCard.question}</div>

            {quiz.revealed && (
              <div style={styles.answer}>
                <div style={styles.answerLabel}>Correct answer:</div>
                <div style={styles.answerText}>{currentCard.answer}</div>
                {quiz.answers[quiz.currentIndex] && (
                  <div style={quiz.answers[quiz.currentIndex].correct ? styles.correctBadge : styles.incorrectBadge}>
                    {quiz.answers[quiz.currentIndex].correct ? '✓ Correct!' : `✗ You said: ${quiz.answers[quiz.currentIndex].userAnswer}`}
                  </div>
                )}
              </div>
            )}
          </div>

          {!quiz.revealed ? (
            <div style={styles.inputRow}>
              <input
                style={styles.input}
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
                placeholder="Type your answer..."
                autoFocus
              />
              <button style={styles.btn} onClick={handleManualSubmit}>Submit</button>
            </div>
          ) : (
            <button style={styles.nextBtn} onClick={advanceCard}>
              {quiz.currentIndex + 1 < quiz.total ? 'Next Question →' : 'See Results →'}
            </button>
          )}
        </div>
      )}

      {quiz.status === 'complete' && (
        <div style={styles.results}>
          <div style={styles.resultScore}>{pct}%</div>
          <div style={styles.resultGrade}>{pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F'}</div>
          <div style={styles.resultDetail}>{quiz.score} out of {quiz.total} correct</div>
          <div style={styles.breakdown}>
            {quiz.answers.map((a, i) => (
              <div key={i} style={a.correct ? styles.breakdownCorrect : styles.breakdownWrong}>
                <span>{i + 1}. {quiz.cards[i]?.question}</span>
                <span>{a.correct ? '✓' : `✗ ${quiz.cards[i]?.answer}`}</span>
              </div>
            ))}
          </div>
          <button style={styles.restartBtn} onClick={() => setQuiz(initialState)}>
            Start New Quiz
          </button>
        </div>
      )}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#f0f4ff' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#4f46e5', color: '#fff', fontWeight: 600 },
  headerIcon: { fontSize: 20 },
  headerTitle: { flex: 1, fontSize: 15 },
  badge: { background: 'rgba(255,255,255,0.25)', borderRadius: 12, padding: '2px 10px', fontSize: 12, textTransform: 'capitalize' },
  idle: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  idleIcon: { fontSize: 64 },
  idleTitle: { fontSize: 22, fontWeight: 700, color: '#1e1b4b' },
  idleSubtitle: { textAlign: 'center', color: '#6b7280', lineHeight: 1.6 },
  topicGrid: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 },
  topicChip: { background: '#e0e7ff', color: '#4f46e5', borderRadius: 20, padding: '6px 16px', fontWeight: 600, textTransform: 'capitalize', fontSize: 13 },
  quizArea: { flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 12 },
  progress: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6b7280', fontWeight: 500 },
  progressBar: { height: 6, background: '#e0e7ff', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#4f46e5', transition: 'width 0.3s ease' },
  card: { flex: 1, background: '#fff', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 4px 24px rgba(79,70,229,0.12)' },
  cardQuestion: { fontSize: 20, fontWeight: 600, color: '#1e1b4b', lineHeight: 1.4 },
  answer: { borderTop: '1px solid #e0e7ff', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 6 },
  answerLabel: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  answerText: { fontSize: 18, fontWeight: 600, color: '#059669' },
  correctBadge: { background: '#d1fae5', color: '#065f46', borderRadius: 8, padding: '4px 12px', fontWeight: 600, fontSize: 14, display: 'inline-block' },
  incorrectBadge: { background: '#fee2e2', color: '#991b1b', borderRadius: 8, padding: '4px 12px', fontWeight: 600, fontSize: 14, display: 'inline-block' },
  inputRow: { display: 'flex', gap: 8 },
  input: { flex: 1, padding: '10px 14px', borderRadius: 10, border: '2px solid #e0e7ff', fontSize: 15, outline: 'none' },
  btn: { padding: '10px 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  nextBtn: { padding: '12px 24px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 15, alignSelf: 'stretch' },
  results: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20, gap: 8, overflowY: 'auto' },
  resultScore: { fontSize: 64, fontWeight: 800, color: '#4f46e5' },
  resultGrade: { fontSize: 28, fontWeight: 700, color: '#1e1b4b' },
  resultDetail: { color: '#6b7280', fontSize: 16 },
  breakdown: { width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 },
  breakdownCorrect: { display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: '#d1fae5', borderRadius: 8, fontSize: 13, color: '#065f46' },
  breakdownWrong: { display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: '#fee2e2', borderRadius: 8, fontSize: 13, color: '#991b1b' },
  restartBtn: { marginTop: 12, padding: '12px 32px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 15 },
}
