import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { type Request, type Response } from 'express'
import request from 'supertest'

// Mock supabase service before importing middleware
vi.mock('../services/supabase', () => ({
  supabaseUrl: 'https://test.supabase.co',
  anonKey: 'test-anon-key',
  supabaseAdmin: {},
  supabaseAnon: {},
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
        error: null,
      }),
    },
  })),
}))

const { requireAuth } = await import('../middleware/auth')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.get('/protected', requireAuth, (req: Request, res: Response) => {
    res.json({ userId: (req as any).userId, email: (req as any).userEmail })
  })
  return app
}

describe('requireAuth middleware', () => {
  it('rejects requests without Authorization header', async () => {
    const app = makeApp()
    const res = await request(app).get('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/authorization/i)
  })

  it('rejects requests with non-Bearer Authorization', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Basic abc123')
    expect(res.status).toBe(401)
  })

  it('passes through valid Bearer token and attaches userId', async () => {
    const app = makeApp()
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer valid-token-here')
    expect(res.status).toBe(200)
    expect(res.body.userId).toBe('user-123')
    expect(res.body.email).toBe('test@example.com')
  })
})
