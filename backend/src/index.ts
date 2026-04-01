import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import chatRoutes from './routes/chat'
import conversationRoutes from './routes/conversations'
import appRoutes from './routes/apps'
import oauthRoutes from './routes/oauth'
import webhookRoutes from './routes/webhooks'

const app = express()
const PORT = process.env.PORT || 3001

// ── Security middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // needed for iframe embedding
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'self'", process.env.FRONTEND_URL || 'http://localhost:5173'],
    },
  },
}))

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:1212',
  ],
  credentials: true,
}))

app.use(express.json({ limit: '2mb' }))

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
