import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import path from 'path'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import chatRoutes from './routes/chat'
import conversationRoutes from './routes/conversations'
import appRoutes from './routes/apps'
import oauthRoutes from './routes/oauth'
import webhookRoutes from './routes/webhooks'

const app = express()
const PORT = process.env.PORT || 3001

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const VERCEL_URL = 'https://chatbridge-pi.vercel.app'

// ── Security middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // needed for iframe embedding
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://sdk.scdn.co'],
      connectSrc: ["'self'", 'https://api.spotify.com', 'https://accounts.spotify.com', FRONTEND_URL],
      frameAncestors: ["'self'", FRONTEND_URL, VERCEL_URL, 'http://localhost:5173', 'http://localhost:1212'],
    },
  },
}))

app.use(cors({
  origin: [
    FRONTEND_URL,
    VERCEL_URL,
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:1212',
  ],
  credentials: true,
}))

app.use(express.json({ limit: '2mb' }))

// ── Static app files (served at /apps/<slug>/) ───────────────
// Each mini-app's built dist/ is committed to backend/public/apps/<slug>/
// process.cwd() is always the backend/ directory (start cmd: cd backend && npm start)
app.use('/apps', express.static(path.join(process.cwd(), 'public/apps'), {
  setHeaders: (res) => {
    // Allow these static app files to be embedded by the frontend
    res.setHeader('X-Frame-Options', 'ALLOWALL')
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.scdn.co; connect-src 'self' https://api.spotify.com https://accounts.spotify.com ${FRONTEND_URL} ${VERCEL_URL}; frame-ancestors 'self' ${FRONTEND_URL} ${VERCEL_URL} http://localhost:5173 http://localhost:1212`,
    )
  },
}))

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/apps', appRoutes)
app.use('/api/oauth', oauthRoutes)
app.use('/api/apps', webhookRoutes)

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Global error handler ─────────────────────────────────────
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`✅  ChatBridge backend running on http://localhost:${PORT}`)
})

export default app
