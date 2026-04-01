# ChatBridge

**AI chat platform where third-party apps live inside the conversation.**

Built for TutorMeAI (200K daily K-12 users). Apps open as sandboxed iframes directly in the chat window — the AI orchestrates them via a structured tool-calling system with security boundaries at every layer.

🔗 **Live demo:** [chatbridge.vercel.app](https://chatbridge.vercel.app)
📹 **Demo video:** [Watch on YouTube](#)
📄 **Architecture doc:** [ChatBridge_Presearch.pdf](./ChatBridge_Presearch.pdf)

---

## What It Does

You type "let's play chess" in chat. The AI:
1. Classifies your intent → matches the Chess app
2. Opens a sandboxed chess board iframe inside the conversation
3. Makes moves by calling `make_move` tools on the iframe via postMessage
4. Streams its commentary back to you in real time

Same pattern works for Flashcard quizzes, Drawing Canvas, and Spotify playlist creation. Third-party developers can build and register their own apps using the same postMessage bridge protocol.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Vercel)               │
│  Chatbox fork (React/Vite)                       │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │  Chat UI     │  │  Sandboxed iframe      │   │
│  │  SSE stream  │  │  (chess/flashcards/    │   │
│  │  Plugin Mgr  │  │   canvas/spotify)      │   │
│  └──────┬───────┘  └──────────┬─────────────┘   │
│         │   postMessage bridge │                  │
└─────────┼──────────────────────┼─────────────────┘
          │ SSE + REST           │ tool_result
┌─────────▼──────────────────────▼─────────────────┐
│                Backend (Railway)                   │
│  Express + TypeScript                              │
│  ┌────────────┐ ┌───────────┐ ┌────────────────┐ │
│  │ Intent     │ │ Policy    │ │ Tool-output    │ │
│  │ Classifier │ │ Gate      │ │ Firewall       │ │
│  └─────┬──────┘ └─────┬─────┘ └───────┬────────┘ │
│        └──────────────┼───────────────┘           │
│              ┌────────▼────────┐                  │
│              │  OpenAI GPT-4o  │                  │
│              │  (AI SDK stream)│                  │
│              └─────────────────┘                  │
└────────────────────────┬──────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Supabase (Postgres) │
              │  Auth + RLS         │
              │  conversations      │
              │  messages           │
              │  app_registrations  │
              │  tool_invocations   │
              │  oauth_tokens       │
              └─────────────────────┘
```

### Security Model

| Layer            | What It Does                                                              |
| ---------------- | ------------------------------------------------------------------------- |
| Sandboxed iframe | `allow-scripts allow-forms` only — no `allow-same-origin`                 |
| Intent Classifier| Lightweight LLM call identifies app slug before injecting tool schemas   |
| Policy Gate      | Deterministic checks: app active, tool exists, rate limit (30 req/min)   |
| Tool Firewall    | Schema projection strips extra fields; 1MB cap; trust boundary delimiters |
| Supabase RLS     | Row-level security — users only see their own conversations and tokens    |

---

## Project Structure

```
chatbridge/
├── frontend/          # Chatbox fork (React/Vite/TypeScript) → deploys to Vercel
├── backend/           # Express API → deploys to Railway
│   ├── src/
│   │   ├── routes/    # chat, auth, apps, oauth, conversations, webhooks
│   │   ├── services/  # openai, supabase, intentClassifier, policyGate, toolFirewall
│   │   └── middleware/# auth, errorHandler
├── apps/
│   ├── chess/         # Chess game (chess.js + react-chessboard)
│   ├── flashcards/    # Flashcard quiz (built-in topic card bank)
│   ├── canvas/        # Drawing canvas (HTML5 Canvas API)
│   └── spotify/       # Spotify playlist creator (OAuth2)
├── shared/
│   └── types/         # TypeScript interfaces shared across frontend/backend
└── supabase/
    └── migrations/    # SQL schema (idempotent)
```

---

## Quick Start (Local Dev)

### Prerequisites
- Node.js 20+ (or 24 with engine-strict=false)
- pnpm 10+ (`npm install -g pnpm`)
- Supabase account + project
- OpenAI API key

### 1. Clone and install

```bash
git clone <repo-url>
cd chatbridge

# Backend
cd backend && npm install

# Frontend
cd ../frontend && pnpm install

# Apps (optional for local testing)
cd ../apps/chess && npm install
cd ../apps/flashcards && npm install
cd ../apps/canvas && npm install
cd ../apps/spotify && npm install
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
# Fill in your values (see Environment Variables section)
```

### 3. Run the migration

Go to your [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new) and run `supabase/migrations/001_init.sql`.

### 4. Seed the apps

```bash
cd backend && npx tsx src/seed/apps.ts
```

### 5. Start everything

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && pnpm run dev:web

# Terminal 3 — chess app (optional)
cd apps/chess && npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001
Chess: http://localhost:5174

---

## Environment Variables

### Backend (`backend/.env`)

| Variable                | Required | Description                                           |
| ----------------------- | -------- | ----------------------------------------------------- |
| `OPENAI_API_KEY`        | ✅       | OpenAI API key (GPT-4o-mini for chat + classifier)    |
| `SUPABASE_URL`          | ✅       | Supabase project URL                                  |
| `SUPABASE_ANON_KEY`     | ✅       | Supabase anon key (public)                            |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅   | Supabase service role key (backend only)              |
| `PORT`                  | ✅       | Server port (default: 3001)                           |
| `NODE_ENV`              | ✅       | `development` or `production`                         |
| `FRONTEND_URL`          | ✅       | Frontend origin for CORS (e.g. `https://chatbridge.vercel.app`) |
| `JWT_SECRET`            | ✅       | Secret for JWT signing                                |
| `SPOTIFY_CLIENT_ID`     | ⚪       | Spotify app client ID (mock mode if empty)            |
| `SPOTIFY_CLIENT_SECRET` | ⚪       | Spotify app client secret                             |
| `SPOTIFY_REDIRECT_URI`  | ⚪       | Must match Spotify dashboard exactly                  |

---

## Deployment

### Backend → Railway

1. Connect your GitHub repo to Railway
2. Set root directory to `backend/`
3. Add all env vars from the table above
4. Railway auto-detects Node.js, uses `npm run build && npm start`

### Frontend → Vercel

1. Connect your GitHub repo to Vercel
2. Set root directory to `frontend/`
3. Build command: `pnpm run build:web`
4. Output directory: `release/app/dist/renderer`
5. Add env var: `VITE_API_URL=https://your-backend.railway.app`

### Apps → Vercel (separate projects)

Each app in `apps/*/` is a standalone Vite app. Deploy each as its own Vercel project:
- Build command: `npm run build`
- Output directory: `dist`

After deploying, update the `iframe_url` for each app in Supabase:
```sql
UPDATE app_registrations SET iframe_url = 'https://chatbridge-chess.vercel.app' WHERE slug = 'chess';
```

---

## Building Your Own App

See [API_DOCS.md](./API_DOCS.md) for the complete third-party developer guide.

**TL;DR:**
1. Build any web app (React, Vue, vanilla JS — anything)
2. Add the postMessage bridge (20 lines of code)
3. Register your app via `POST /api/apps`
4. The AI automatically discovers and uses your tools

---

## Tech Stack

| Layer     | Technology                                       |
| --------- | ------------------------------------------------ |
| Frontend  | React 18, TypeScript, Vite, Chatbox fork         |
| Backend   | Express, TypeScript, Vercel AI SDK               |
| AI        | OpenAI GPT-4o-mini (chat + intent classification)|
| Database  | Supabase (PostgreSQL + Auth + RLS)               |
| Apps      | React 18, TypeScript, Vite (per-app)             |
| Deploy    | Vercel (frontend + apps), Railway (backend)      |

---

## Testing

```bash
cd backend && npm test
# 25 tests across: Policy Gate, Tool Firewall, Auth Middleware, Phase 3 apps
```

---

## License

MIT
