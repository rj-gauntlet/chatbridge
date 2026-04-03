# ChatBridge — Project Plan

> Generated from PRD review on 2026-03-30

## 1. Product Overview

### Vision
ChatBridge is an AI chat platform that enables third-party applications to live inside the chat experience. Built for K-12 education (TutorMeAI case study — 10K+ districts, 200K daily users), it allows students to play educational games, work through flashcards, create Spotify playlists, or draw on a canvas without leaving the chat window. The chatbot remains aware of what's happening inside each app and responds contextually. Safety and security are built into the contract from the start via sandboxed iframes and strict content isolation.

### Target Users
- **Students (K-12):** Interact with AI chatbot and embedded apps for learning
- **Teachers:** Control which apps are available, configure chatbot behavior
- **Third-party developers:** Build apps that integrate with the platform via a documented API

### Key Outcomes
- Bidirectional plugin architecture — apps register tools, render UI, communicate state with the chatbot
- Trust & safety for children — sandboxed iframes, CSP headers, data isolation between apps
- Three auth tiers working smoothly (internal, public API, OAuth2)
- Production deployment with 4 working apps (Chess, Flashcards, Drawing Canvas, Spotify)
- Full app lifecycle: tool discovery > invocation > UI render > interaction > completion > follow-up

---

## 2. Requirements Summary

### Functional Requirements

| ID    | Domain           | Requirement                                            | Priority  |
| ----- | ---------------- | ------------------------------------------------------ | --------- |
| FR-01 | Chat             | Real-time AI chat with streaming responses             | Must-have |
| FR-02 | Chat             | Persistent conversation history across sessions        | Must-have |
| FR-03 | Chat             | Chat context awareness of active third-party apps      | Must-have |
| FR-04 | Chat             | Multi-turn conversations spanning app interactions     | Must-have |
| FR-05 | Chat             | Graceful error recovery (app fail/timeout/errors)      | Must-have |
| FR-06 | Auth             | User authentication for the platform                   | Must-have |
| FR-07 | Plugin System    | App registration API with capability declaration       | Must-have |
| FR-08 | Plugin System    | Tool schema definition (chatbot discovers and invokes) | Must-have |
| FR-09 | Plugin System    | App UI rendering within chat (sandboxed iframes)       | Must-have |
| FR-10 | Plugin System    | Bidirectional communication (chat <> app)              | Must-have |
| FR-11 | Plugin System    | Completion signaling (app > chatbot)                   | Must-have |
| FR-12 | Plugin System    | Independent app state management                       | Must-have |
| FR-13 | Apps             | Chess app (complex state, board UI, move validation)   | Must-have |
| FR-14 | Apps             | Flashcard Quiz app (educational, multi-step workflow)  | Must-have |
| FR-15 | Apps             | Drawing Canvas app (rich UI, binary data)              | Must-have |
| FR-16 | Apps             | Spotify Playlist Creator (OAuth2, external API)        | Must-have |
| FR-17 | Auth             | OAuth2 flow for at least one third-party app           | Must-have |

### Non-Functional Requirements

| ID     | Category    | Requirement                                | Target                             |
| ------ | ----------- | ------------------------------------------ | ---------------------------------- |
| NFR-01 | Performance | Reasonable response times with UX cues     | Spinners, streaming text, progress |
| NFR-02 | Security    | Iframe sandboxing, CSP, data isolation     | Child-safe (K-12)                  |
| NFR-03 | UX          | Loading indicators on all async operations | No blank/frozen states             |
| NFR-04 | Docs        | API documentation for third-party devs     | Developer-friendly                 |
| NFR-05 | Deployment  | Publicly accessible deployed application   | Vercel + Railway                   |
| NFR-06 | Cost        | AI cost analysis at 4 scale levels         | 100/1K/10K/100K users              |

### Assumptions
- Students interact via web browser (no native mobile required)
- Teachers and students share the same auth system (role-based access is out of scope for MVP)
- Third-party apps are pre-registered (no self-service app store for MVP)
- Chess app does not require an AI opponent — the chatbot provides move suggestions via LLM analysis
- Spotify OAuth requires a Spotify Developer account and registered app

### Open Questions
- Does the Chatbox web build support hot module replacement during dev, or only production builds?
- What Node.js version is required? (Byron mentioned getting the right version)
- Will graders test with their own Spotify accounts for the OAuth flow?

---

## 3. Architecture

### System Overview

```
+------------------------------------------------------------------+
|                   FRONTEND (Chatbox Web SPA)                      |
|  +-------------+  +-------------+  +---------------------------+ |
|  | Chat UI     |  | App Router  |  | Plugin Manager            | |
|  | (Messages,  |  | (discovers  |  | (iframe lifecycle,        | |
|  |  streaming) |  |  & routes)  |  |  postMessage bridge)      | |
|  +------+------+  +------+------+  +-----------+---------------+ |
|         |                |                      |                 |
|         |         +------+---------------------+|                 |
|         |         |   Sandboxed Iframes         ||                |
|         |         | +-----+ +------+ +---+ +--+ |                 |
|         |         | |Chess| |Canvas| |FC | |SP| |  postMessage    |
|         |         | +-----+ +------+ +---+ +--+ |                 |
|         |         +-----------------------------+                 |
+---------|--+------------------------------------------------------+
          |  | SSE (streaming) + REST (actions)
          v  v
+------------------------------------------------------------------+
|                 BACKEND (Express + TypeScript)                     |
|  +-------------+  +-------------+  +---------------------------+ |
|  | Chat API    |  | Plugin      |  | Tool Orchestrator         | |
|  | /api/chat   |  | Registry    |  | (OpenAI function calling, | |
|  | (SSE stream)|  | /api/apps   |  |  invocation dispatch)     | |
|  +------+------+  +------+------+  +-----------+---------------+ |
|         |                |                      |                 |
|  +------+----------------+----------------------+---------------+ |
|  | Auth Middleware (Supabase JWT validation)                     | |
|  +------+-------------------------------------------------------+ |
|         |  +-------------+  +------------------+                  |
|         |  | OAuth Mgr   |  | Webhook Handler  |                  |
|         |  | (Spotify)   |  | (completion CBs) |                  |
|         |  +-------------+  +------------------+                  |
+---------|--+------------------------------------------------------+
          |  |
          v  v
+------------------------------------------------------------------+
|                          SUPABASE                                 |
|  +-------------+  +-------------+  +---------------------------+ |
|  | Auth        |  | PostgreSQL  |  | Storage                   | |
|  | (users,     |  | (chats,     |  | (canvas exports)          | |
|  |  sessions)  |  |  app state, |  |                           | |
|  |             |  |  tool logs) |  |                           | |
|  +-------------+  +-------------+  +---------------------------+ |
+------------------------------------------------------------------+
          |                              |
          v                              v
+-------------------+          +------------------+
| OpenAI API        |          | Spotify API      |
| (GPT-4o-mini,     |          | (OAuth2,         |
|  function calling) |          |  playlists)      |
+-------------------+          +------------------+
```

### Component Breakdown

#### Chat UI (Frontend)
- **Responsibility:** Renders conversation messages, handles user input, displays streaming AI responses
- **Key interfaces:** Consumes `/api/chat` SSE stream, sends messages via REST
- **Technology:** React + TypeScript (forked from Chatbox web build)

#### Plugin Manager (Frontend)
- **Responsibility:** Manages iframe lifecycle (create, mount, communicate, destroy). Listens for postMessage events from embedded apps (state updates, completion signals). Forwards tool results to chat context.
- **Key interfaces:** `PluginMessage` protocol via postMessage, communicates with Tool Orchestrator
- **Technology:** React component with iframe management, Window.postMessage API

#### App Router (Frontend)
- **Responsibility:** Discovers registered apps from the registry, maps user intent to the correct plugin
- **Key interfaces:** Consumes `/api/apps` to get available apps and their tool schemas
- **Technology:** React context/state management

#### Chat API (Backend)
- **Responsibility:** Receives user messages, runs **two-phase schema injection**, streams responses via SSE. Phase 1: lightweight intent classification to identify which app the user is addressing. Phase 2: inject only that app's tool schemas into the OpenAI call (not all registered apps). When OpenAI returns a function call, passes it to the Policy Gate before dispatching to the Tool Orchestrator.
- **Key interfaces:** `POST /api/chat` (SSE), consumes OpenAI Chat Completions API, calls Intent Classifier
- **Technology:** Express + AI SDK (@ai-sdk/openai)

> **Why two-phase injection:** Injecting all app schemas every turn wastes ~40% of input tokens and increases LLM routing confusion. Phase 1 uses a small, fast classification call (or embedding similarity) to identify the target app. Phase 2 passes only that app's 3-5 tool schemas to the main LLM call. If no app is identified, the LLM responds conversationally with no tools injected.

#### Intent Classifier (Backend)
- **Responsibility:** Phase 1 of the two-phase routing. Classifies user intent against registered app descriptions to determine which app (if any) the message is directed at. Returns the matched app slug or `null` for pure conversational turns.
- **Key interfaces:** Called by Chat API before every LLM request, consumes app registry descriptions
- **Technology:** Lightweight OpenAI call with app descriptions only (no full tool schemas), or cosine similarity over app description embeddings

#### Plugin Registry (Backend)
- **Responsibility:** CRUD for app registrations. Stores tool schemas (input + output schemas), iframe URLs, auth requirements, and capabilities.
- **Key interfaces:** `GET/POST /api/apps`, `GET /api/apps/:id`
- **Technology:** Express routes + Supabase PostgreSQL

#### Policy Gate (Backend)
- **Responsibility:** Deterministic, non-LLM approval layer that runs before every tool invocation. Checks: (1) is this app active and approved? (2) is the tool appropriate for this user? (3) has any required consent been granted? (4) has the user exceeded their rate limit for this tool? Only approved invocations proceed to the Tool Orchestrator. The LLM can *suggest* a tool call — the Policy Gate *approves or denies* it.
- **Key interfaces:** Called by Chat API after every LLM function call response, before dispatch
- **Technology:** Express middleware with deterministic rule checks (no LLM involvement)

```typescript
// Policy Gate decision logic
function approveToolCall(call: ToolCallRequest, session: UserSession): PolicyDecision {
  const app = registry.getApp(call.appId);
  if (!app || app.status !== 'active') return { approved: false, reason: 'app_unavailable' };
  if (rateLimiter.exceeded(session.userId, call.toolName)) return { approved: false, reason: 'rate_limited' };
  if (app.requiresConsent && !consent.exists(session.userId, call.appId)) return { approved: false, reason: 'consent_required' };
  return { approved: true };
}
```

#### Tool Orchestrator (Backend)
- **Responsibility:** Receives Policy Gate-approved tool call requests. Dispatches invocation to the correct app via postMessage relay. Receives tool results, runs them through the **tool-output firewall** before returning to the LLM.
- **Key interfaces:** OpenAI function calling API, `ToolInvocation` type, postMessage relay, output schema validation
- **Technology:** Express middleware + OpenAI AI SDK

> **Tool-output firewall:** Raw tool output never enters the LLM prompt directly. Three controls applied to every result before LLM insertion:
> 1. **Schema validation** — result validated against the app's declared `outputSchema`. Extra fields stripped, oversized payloads (>1MB) rejected.
> 2. **Sanitized projection** — only the minimal fields needed for the LLM response are extracted and formatted. No raw text blobs.
> 3. **Trust boundary delimiters** — result inserted into conversation history wrapped as: `<tool_output source="untrusted">[sanitized result]</tool_output>`. System prompt instructs LLM to treat this as data, never as instructions.

#### OAuth Manager (Backend)
- **Responsibility:** Handles Spotify OAuth2 flow — authorization URL generation, callback handling, token storage, automatic refresh.
- **Key interfaces:** `GET /api/oauth/:app/authorize`, `GET /api/oauth/:app/callback`
- **Technology:** Express routes + Supabase for encrypted token storage

#### Webhook Handler (Backend)
- **Responsibility:** Receives completion callbacks from server-side app integrations
- **Key interfaces:** `POST /api/apps/:id/webhook`
- **Technology:** Express routes with app-key authentication

### Data Models

```typescript
// ============ USERS ============
// Managed by Supabase Auth (id, email, created_at, etc.)

// ============ CONVERSATIONS ============
interface Conversation {
  id: string;             // uuid
  user_id: string;        // references auth.users
  title: string;
  created_at: string;     // timestamptz
  updated_at: string;     // timestamptz
}

// ============ MESSAGES ============
interface Message {
  id: string;             // uuid
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  app_context?: Record<string, any>;  // snapshot of app state
  created_at: string;     // timestamptz
}

// ============ APP REGISTRATIONS ============
interface ToolSchema {
  name: string;
  description: string;
  inputSchema: JSONSchema;    // OpenAI-native function parameter schema
  outputSchema: JSONSchema;   // NEW: declared return shape — used by tool-output firewall
  requiresConsent?: boolean;  // NEW: if true, Policy Gate checks consent before invocation
}

interface AppRegistration {
  id: string;             // uuid
  name: string;           // "Chess", "Spotify Playlist Creator"
  slug: string;           // "chess", "spotify"
  description: string;    // shown to user and injected into intent classifier
  icon_url?: string;
  iframe_url: string;     // URL of the app's entry point
  auth_type: 'internal' | 'public' | 'oauth2';
  oauth_config?: {
    auth_url: string;
    token_url: string;
    client_id: string;
    scopes: string[];
  };
  tools: ToolSchema[];        // input + output schemas per tool
  webhook_url?: string;
  status: 'active' | 'disabled' | 'pending_review';
  created_at: string;
}

// ============ POLICY GATE ============
interface PolicyDecision {
  approved: boolean;
  reason?: 'app_unavailable' | 'rate_limited' | 'consent_required' | 'app_disabled';
}

interface ToolCallRequest {
  appId: string;
  toolName: string;
  parameters: Record<string, any>;
  userId: string;
  conversationId: string;
}

// ============ TOOL INVOCATIONS ============
interface ToolInvocation {
  id: string;             // uuid
  conversation_id: string;
  message_id: string;
  app_id: string;
  tool_name: string;
  parameters: Record<string, any>;
  result: Record<string, any>;
  duration_ms: number;
  status: 'success' | 'error' | 'timeout';
  created_at: string;
}

// ============ OAUTH TOKENS ============
interface OAuthToken {
  id: string;             // uuid
  user_id: string;
  app_id: string;
  access_token: string;   // encrypted at rest
  refresh_token: string;  // encrypted at rest
  expires_at: string;     // timestamptz
  scopes: string[];
  created_at: string;
}
```

### API Surface

| Method | Endpoint                    | Description                           | Auth     |
| ------ | --------------------------- | ------------------------------------- | -------- |
| POST   | `/api/auth/register`        | User registration (proxies Supabase)  | None     |
| POST   | `/api/auth/login`           | User login (proxies Supabase)         | None     |
| POST   | `/api/auth/logout`          | User logout                           | Required |
| POST   | `/api/chat`                 | Send message, receive SSE stream      | Required |
| GET    | `/api/conversations`        | List user's conversations             | Required |
| GET    | `/api/conversations/:id`    | Get conversation with messages        | Required |
| DELETE | `/api/conversations/:id`    | Delete a conversation                 | Required |
| GET    | `/api/apps`                 | List registered apps                  | Required |
| POST   | `/api/apps`                 | Register a new app (admin)            | Admin    |
| GET    | `/api/apps/:id`             | Get app details + tool schemas        | Required |
| PUT    | `/api/apps/:id`             | Update app registration               | Admin    |
| POST   | `/api/apps/:id/invoke`      | Invoke a tool on an app               | Required |
| POST   | `/api/apps/:id/webhook`     | Receive completion callback from app  | App key  |
| GET    | `/api/oauth/:app/authorize` | Start OAuth flow for an app           | Required |
| GET    | `/api/oauth/:app/callback`  | OAuth redirect handler                | Session  |
| GET    | `/api/health`               | Health check                          | None     |

### Tech Stack

| Layer          | Technology                         | Rationale                                                        |
| -------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Frontend       | Chatbox fork (React + TS + Vite)   | PRD requirement; `pnpm run build:web` produces deployable SPA    |
| Backend        | Express + TypeScript               | Shared types with frontend, AI SDK native, SSE support           |
| Database       | Supabase (PostgreSQL)              | Managed DB + auth + realtime + storage in one service            |
| Auth           | Supabase Auth                      | Built-in JWT-based auth, handles registration/login              |
| LLM            | OpenAI GPT-4o-mini                 | Best function calling support, cost-effective at $0.15/1M input  |
| App Sandboxing | Sandboxed iframes + postMessage    | Browser-native isolation, K-12 safety standard                   |
| Chess Engine   | chess.js + react-chessboard        | Proven move validation + interactive board UI                    |
| Drawing        | HTML5 Canvas API                   | Native browser API, no dependencies needed                       |
| Deployment     | Vercel (frontend) + Railway (backend) | Static SPA on Vercel, Express server on Railway               |
| Package Mgr    | pnpm                               | Required by Chatbox                                             |

### Detected Stack Constraints
- **Chatbox fork** requires pnpm, Node.js v20-22, and uses Vite as build tool
- Web build command: `pnpm run delete-sourcemaps && pnpm run build:web && pnpm run serve:web`
- Output to `release/app/dist/renderer/` — standard static React SPA

### Shared Interfaces

| Interface         | Location                   | Purpose                                           | Depended on by                              |
| ----------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `AppRegistration` | `shared/types/app.ts`      | App registration shape + tool schemas (in + out)  | Plugin Registry, Plugin Manager, Chat API   |
| `ToolSchema`      | `shared/types/app.ts`      | Per-tool input + output schema definition         | Policy Gate, Tool Orchestrator, Firewall    |
| `PluginMessage`   | `shared/types/messages.ts` | postMessage protocol between platform and iframes | Plugin Manager, all iframe apps             |
| `ToolInvocation`  | `shared/types/tools.ts`    | Tool call parameters + results shape              | Tool Orchestrator, Chat API, all apps       |
| `ToolCallRequest` | `shared/types/tools.ts`    | Request shape passed to Policy Gate               | Chat API, Policy Gate, Tool Orchestrator    |
| `PolicyDecision`  | `shared/types/policy.ts`   | Gate approval/denial with reason                  | Policy Gate, Chat API                       |
| `ChatMessage`     | `shared/types/chat.ts`     | Message format for conversation history           | Chat UI, Chat API, context manager          |
| `OAuthConfig`     | `shared/types/auth.ts`     | OAuth configuration for authenticated apps        | OAuth Manager, Plugin Registry              |

---

## 4. Strategy

### Build vs. Buy

| Capability          | Decision                      | Rationale                                                      |
| ------------------- | ----------------------------- | -------------------------------------------------------------- |
| Chat UI             | Open-source (Chatbox fork)    | PRD requirement                                                |
| Auth                | Buy (Supabase Auth)           | No reason to build auth from scratch; free tier sufficient     |
| Database            | Buy (Supabase Postgres)       | Managed, free tier, realtime built-in                          |
| Chess engine        | Open-source (chess.js)        | Well-tested move validation + board state library              |
| Chess board UI      | Open-source (react-chessboard) | Proven interactive board component                            |
| Drawing canvas      | Build (HTML5 Canvas API)      | Simple enough; no good off-the-shelf chat-embeddable option    |
| Flashcard app       | Build                         | Custom UI for chat embedding, educational focus                |
| Spotify integration | Build                         | Custom OAuth flow + API wrapper                                |
| LLM orchestration   | Build + AI SDK                | Core differentiator; AI SDK handles streaming + function calls |
| Plugin system       | Build                         | Core engineering challenge — no off-the-shelf solution fits    |

### MVP Scope

**In MVP (this sprint):**
- Full chat with streaming, history, auth
- Complete plugin architecture (registration, tool schemas, iframe embedding, completion signaling)
- 4 working apps: Chess, Flashcards, Drawing Canvas, Spotify
- OAuth2 flow for Spotify
- Error handling + UX indicators
- Deployed and publicly accessible

**Deferred (post-sprint):**
- Teacher role-based access control
- Self-service app marketplace / developer portal
- App review and approval workflow
- Content moderation / filtering for K-12
- Mobile-responsive layout optimization
- Rate limiting and usage quotas per app
- App analytics dashboard

### Iteration Approach
1. Get basic chat working end-to-end (Day 1)
2. Build plugin interface vertically with Chess as proof (Days 2-3)
3. Add remaining apps to prove flexibility (Days 3-4)
4. Polish, deploy, document (Days 5-7)

### Deployment Strategy
- **Frontend:** `pnpm run build:web` > deploy `release/app/dist/renderer/` to Vercel as static site
- **Backend:** Express server deployed to Railway with auto-deploy from GitLab `main` branch
- **Database:** Supabase managed instance (free tier)
- **Third-party apps:** Bundled as separate Vite builds, hosted alongside frontend on Vercel (each app gets its own route/subdirectory)
- **CI/CD:** GitLab CI pipeline — lint > type-check > build > deploy

---

## 5. Project Structure

```
chatbridge/
+-- PROJECT_PLAN.md
+-- README.md
|
+-- frontend/                    # Chatbox fork (web build)
|   +-- package.json
|   +-- pnpm-lock.yaml
|   +-- vite.config.ts
|   +-- tsconfig.json
|   +-- src/
|   |   +-- renderer/            # Chatbox renderer (main app code)
|   |   |   +-- components/
|   |   |   |   +-- Chat/        # Chat UI components (modified)
|   |   |   |   +-- PluginManager/  # NEW: iframe lifecycle management
|   |   |   |   +-- AppRouter/     # NEW: app discovery + routing
|   |   |   |   +-- Auth/          # NEW: login/register forms
|   |   |   +-- hooks/
|   |   |   |   +-- usePluginMessage.ts  # NEW: postMessage hook
|   |   |   |   +-- useChat.ts           # NEW: SSE streaming hook
|   |   |   |   +-- useAuth.ts           # NEW: Supabase auth hook
|   |   |   +-- services/
|   |   |   |   +-- api.ts         # NEW: backend API client
|   |   |   |   +-- supabase.ts    # NEW: Supabase client init
|   |   |   +-- types/             # Local frontend types
|   |   +-- ...
|   +-- release/app/dist/renderer/  # Build output (deployed to Vercel)
|
+-- backend/                      # Express + TypeScript server
|   +-- package.json
|   +-- tsconfig.json
|   +-- src/
|   |   +-- index.ts              # Express app entry point
|   |   +-- routes/
|   |   |   +-- chat.ts           # POST /api/chat (SSE streaming)
|   |   |   +-- conversations.ts  # CRUD for conversations
|   |   |   +-- apps.ts           # Plugin registry CRUD
|   |   |   +-- oauth.ts          # OAuth2 flows
|   |   |   +-- webhooks.ts       # Completion callbacks
|   |   |   +-- auth.ts           # Auth proxy routes
|   |   +-- middleware/
|   |   |   +-- auth.ts           # Supabase JWT validation
|   |   |   +-- errorHandler.ts   # Global error handler
|   |   +-- services/
|   |   |   +-- openai.ts         # OpenAI client + function calling
|   |   |   +-- toolOrchestrator.ts  # Tool dispatch + result handling
|   |   |   +-- supabase.ts       # Supabase admin client
|   |   |   +-- oauth.ts          # Token management
|   |   +-- seed/
|   |   |   +-- apps.ts           # Seed built-in app registrations
|   +-- .env.example
|
+-- apps/                         # Third-party apps (each is standalone)
|   +-- chess/
|   |   +-- package.json
|   |   +-- vite.config.ts
|   |   +-- src/
|   |   |   +-- App.tsx           # Chess board + game logic
|   |   |   +-- bridge.ts         # postMessage communication
|   |   +-- dist/                 # Build output
|   +-- flashcards/
|   |   +-- package.json
|   |   +-- vite.config.ts
|   |   +-- src/
|   |   |   +-- App.tsx           # Flashcard quiz UI
|   |   |   +-- bridge.ts
|   |   +-- dist/
|   +-- canvas/
|   |   +-- package.json
|   |   +-- vite.config.ts
|   |   +-- src/
|   |   |   +-- App.tsx           # Drawing canvas UI
|   |   |   +-- bridge.ts
|   |   +-- dist/
|   +-- spotify/
|   |   +-- package.json
|   |   +-- vite.config.ts
|   |   +-- src/
|   |   |   +-- App.tsx           # Spotify playlist UI
|   |   |   +-- bridge.ts
|   |   +-- dist/
|
+-- shared/                       # Shared TypeScript types
|   +-- package.json
|   +-- types/
|   |   +-- app.ts                # AppRegistration, AppStatus
|   |   +-- messages.ts           # PluginMessage protocol
|   |   +-- tools.ts              # ToolInvocation, ToolResult
|   |   +-- chat.ts               # ChatMessage, Conversation
|   |   +-- auth.ts               # OAuthConfig, OAuthToken
|   +-- index.ts                  # Re-exports all types
|
+-- supabase/
|   +-- migrations/               # SQL migration files
|   |   +-- 001_init.sql          # conversations, messages, apps, etc.
|   +-- seed.sql                  # Initial app registrations
|
+-- .gitlab-ci.yml                # CI/CD pipeline
+-- docker-compose.yml            # Local dev (optional)
```

---

## 6. Implementation Plan

### Timeline
- **Start date:** 2026-03-30 (today)
- **Target completion:** 2026-04-05 (Sunday)
- **Total estimated duration:** 7 days

---

### Phase 1: Foundation + Pre-search — Day 1 (Tuesday 2026-03-31 deadline)

**Goal:** Working basic chat with auth + pre-search document + architecture video

**Deliverables:**
- [ ] Fork chatboxai/chatbox to GitLab
- [ ] Verify `pnpm run build:web` produces deployable SPA
- [ ] Express backend scaffolded with TypeScript, running locally
- [ ] Supabase project created with database tables (conversations, messages, app_registrations)
- [ ] Basic chat working: user types > backend hits OpenAI > SSE streams response back
- [ ] Conversation persistence (save/load from Supabase)
- [ ] User auth (register/login via Supabase Auth)
- [ ] Pre-search document with 500-word "Case Study Analysis" header
- [ ] 3-5 minute architecture presentation video

**Key Tasks:**
1. Fork Chatbox repo, clone locally, verify web build works (`pnpm install && pnpm run delete-sourcemaps && pnpm run build:web`)
2. Create `backend/` directory, init Express + TypeScript project with AI SDK
3. Create Supabase project, define schema (run migrations)
4. Build `POST /api/chat` endpoint with SSE streaming via AI SDK
5. Modify Chatbox frontend to point at custom backend instead of direct LLM calls
6. Build `GET/POST /api/conversations` and wire to frontend
7. Integrate Supabase Auth — registration form, login form, JWT middleware
8. Write pre-search document (case study analysis + architecture decisions)
9. Record architecture video

**Success Criteria:**
- User can register, log in, chat with AI, and see history persist across sessions
- Pre-search document submitted with quality case study analysis
- Architecture video uploaded

**Risks:**
- Chatbox web build may have issues with Node version — mitigate by following Byron's exact steps
- Modifying Chatbox's chat pipeline to use custom backend may require understanding its internal architecture — allocate time for codebase exploration

---

### Phase 2: Plugin System + Chess — Days 2-3

**Goal:** Core plugin architecture working end-to-end, proven with Chess

**Deliverables:**
- [ ] Shared types defined and published (`AppRegistration`, `ToolSchema`, `PluginMessage`, `ToolInvocation`, `ToolCallRequest`, `PolicyDecision`)
- [ ] Plugin Registry API (`/api/apps` CRUD) with seeded chess registration (input + output schemas)
- [ ] Plugin Manager component on frontend (iframe lifecycle, postMessage bridge)
- [ ] **Intent Classifier** — Phase 1 of two-phase routing (identifies target app from user message)
- [ ] **Two-phase schema injection** — Chat API injects only the matched app's tools, not all registered schemas
- [ ] **Policy Gate** — deterministic approval layer before every tool invocation
- [ ] Tool Orchestrator with **tool-output firewall** (output schema validation, sanitized projection, trust boundary delimiters)
- [ ] Chess app fully integrated:
  - Interactive board using react-chessboard + chess.js
  - Tools: `start_game`, `make_move`, `get_board_state`, `get_legal_moves` (each with declared `outputSchema`)
  - Lifecycle: "let's play chess" > board appears > mid-game help > game ends > discussion
- [ ] Completion signaling working (chess game end > chatbot resumes)
- [ ] Context retention (chatbot remembers game results in follow-up turns)

**Key Tasks:**
1. Create `shared/` package with all TypeScript interfaces (including `ToolSchema`, `PolicyDecision`, `ToolCallRequest`)
2. Build Plugin Registry backend routes + Supabase table (update schema to include `outputSchema` per tool)
3. Seed chess app registration with full tool schemas (input + output) in OpenAI function format
4. Build Intent Classifier — lightweight call using app descriptions only to identify target app
5. Modify Chat API to use two-phase routing: classify intent first, then inject only matched app's schemas
6. Build Policy Gate middleware — checks app status, rate limits, consent before dispatch
7. Build Plugin Manager React component — iframe mount/unmount, postMessage listener
8. Build Tool Orchestrator with tool-output firewall — validate against outputSchema, sanitize, wrap in delimiters
9. Create chess app as standalone Vite/React project in `apps/chess/`
10. Implement chess postMessage bridge (receive tool invocations, send state updates + completion)
11. Test full lifecycle: invocation > Policy Gate > render > interaction > completion > follow-up conversation

**Success Criteria:**
- User says "let's play chess" > board appears in chat > user plays moves > asks "what should I do here?" > chatbot analyzes board state > game ends > chatbot discusses the game
- All 7 PRD testing scenarios pass with chess

**Risks:**
- Completion signaling edge cases (what if user closes iframe? what if game crashes mid-move?) — build defensive handlers early
- postMessage security (verify origin, validate message shape) — implement from day one

---

### Phase 3: Additional Apps — Days 3-4 (Friday 2026-04-03 early submission deadline)

**Goal:** 3 more apps integrated, demonstrating different patterns

**Deliverables:**
- [x] Flashcard Quiz app (internal, no auth, educational)
  - Tools: `start_quiz`, `get_question`, `submit_answer`, `get_results`
  - UI: question display, answer input, score tracking, completion summary
- [x] Drawing Canvas app (internal, rich UI)
  - Tools: `open_canvas`, `save_drawing`, `clear_canvas`, `get_drawing_info`
  - UI: HTML5 Canvas with color picker, brush sizes, undo, export
- [x] Spotify Playlist Creator (OAuth2, external API)
  - OAuth2 flow working (authorize > callback > token storage > refresh)
  - Tools: `search_tracks`, `create_playlist`, `add_to_playlist`, `get_user_playlists`
  - UI: search results, playlist builder, connected account indicator
- [x] Multi-app routing working (chatbot picks correct app)
- [x] App switching within a single conversation
- [x] Error handling for app failures (timeout, crash, invalid response)

**Key Tasks:**
1. Build Flashcard app in `apps/flashcards/` + postMessage bridge + register tools
2. Build Drawing Canvas app in `apps/canvas/` + postMessage bridge + register tools
3. Implement OAuth2 Manager — Spotify authorize URL, callback handler, token storage, refresh
4. Build Spotify app in `apps/spotify/` + postMessage bridge + register tools
5. Test multi-app routing — ask chatbot to use different apps in sequence
6. Test ambiguous query handling — "help me study" (flashcards vs chatbot)
7. Test error recovery — kill an iframe mid-interaction, verify chatbot recovers gracefully
8. Add loading states, spinners, and progress indicators for all app transitions

**Success Criteria:**
- All 4 apps work independently and can be switched between in one conversation
- Spotify OAuth flow works end-to-end (user authorizes > searches tracks > creates playlist)
- Chatbot correctly routes requests and refuses unrelated queries
- Error states handled gracefully with user-visible feedback

**Risks:**
- Spotify API rate limits during testing — use mock data as fallback
- OAuth redirect in iframe context can be tricky — may need popup window approach
- Canvas binary export size limits for Supabase storage

---

### Phase 4: Polish + Deploy + Docs — Days 5-7 (Sunday 2026-04-05 final deadline)

**Goal:** Production-ready, deployed, documented, submitted

**Deliverables:**
- [ ] Error handling hardened across all apps and chat interactions
- [ ] All loading states and UX indicators polished (spinners, streaming text, progress bars)
- [ ] OAuth token refresh working automatically for Spotify
- [ ] Frontend deployed to Vercel (static SPA from `release/app/dist/renderer/`)
- [ ] Backend deployed to Railway
- [ ] Third-party apps deployed (Vercel subdirectories or separate deployments)
- [ ] API documentation for third-party developers (how to build + register an app)
- [ ] README.md with setup guide + architecture overview + deployed link
- [ ] AI Cost Analysis document (actual dev spend + projections at 4 scales)
- [ ] Demo video (3-5 min) showing chat, plugin lifecycle, architecture
- [ ] Social post on X or LinkedIn tagging @GauntletAI

**Key Tasks:**
1. Add error boundaries around all iframe interactions
2. Implement timeout handling (30s default for tool invocations)
3. Add circuit breaker for unreliable apps (3 failures > temporarily disable)
4. Polish all loading/transition animations
5. Configure Vercel project — connect GitLab repo, set build command, output directory
6. Configure Railway project — connect GitLab repo, set env vars, deploy backend
7. Deploy apps to Vercel (static builds from `apps/*/dist/`)
8. Write API documentation (OpenAPI/Swagger or markdown)
9. Write README with full setup guide
10. Calculate actual AI costs from development (track OpenAI dashboard)
11. Build production cost projection spreadsheet
12. Record 3-5 min demo video
13. Write and publish social media post

**Success Criteria:**
- App is publicly accessible at deployed URL
- All 7 PRD testing scenarios pass on deployed version
- Documentation is complete and a third-party developer could build an app from it
- All submission artifacts delivered (GitLab, video, cost analysis, social post)

**Risks:**
- CORS configuration between Vercel (frontend) and Railway (backend) — configure early
- Supabase free tier auto-pauses after 7 days of inactivity — ensure periodic pings or upgrade
- Environment variable management across 3 deployment targets

---

## 7. Cost Analysis

### Development Costs

| Phase                          | Effort Estimate | Paid Tools / Licenses                | Phase Cost |
| ------------------------------ | --------------- | ------------------------------------ | ---------- |
| Phase 1: Foundation            | 1 day           | OpenAI API (~$2 testing)             | ~$2        |
| Phase 2: Plugin System + Chess | 2 days          | OpenAI API (~$5 testing)             | ~$5        |
| Phase 3: Additional Apps       | 2 days          | OpenAI API (~$5), Spotify API (free) | ~$5        |
| Phase 4: Polish + Deploy       | 2 days          | OpenAI API (~$3 final testing)       | ~$3        |
| **Total**                      | **7 days**      |                                      | **~$15**   |

*Note: All infrastructure services (Supabase, Vercel, Railway) are on free tiers during development.*

### Operational Costs at Scale

**Assumptions:**
- Average 15 messages per session
- Average 3 tool invocations per session
- Average 8 sessions per user per month
- GPT-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
- ~500 input tokens per message, ~300 output tokens per message
- ~800 tokens per tool call (combined in+out)
- Per-user monthly LLM cost: ~$0.034

| Component              | 100 users/mo | 1,000 users/mo | 10,000 users/mo | 100,000 users/mo |
| ---------------------- | ------------ | --------------- | ---------------- | ----------------- |
| OpenAI LLM             | $3.40        | $34             | $340             | $3,400            |
| Supabase (DB + Auth)   | $0 (free)    | $25 (Pro)       | $25 + $50 usage  | $599 (Team)       |
| Railway (backend)      | $5           | $10             | $30              | $100+             |
| Vercel (frontend)      | $0 (free)    | $0 (free)       | $20 (Pro)        | $20 (Pro)         |
| Supabase Storage       | $0 (free)    | $0 (free)       | $25              | $75               |
| Spotify API            | $0 (free)    | $0 (free)       | $0 (free)        | $0 (free)         |
| **Monthly Total**      | **~$8.40**   | **~$69**        | **~$490**        | **~$4,194**       |

### Alternative Cost Comparison

#### Database: Supabase vs Neon vs PlanetScale

| Option           | Monthly Cost @ 1K users | Monthly Cost @ 100K users | Notes                                    |
| ---------------- | ----------------------- | ------------------------- | ---------------------------------------- |
| **Supabase**     | $25                     | $599                      | Selected — includes auth + storage       |
| Neon Postgres    | $19                     | $69+                      | Cheaper at scale, but no built-in auth   |
| PlanetScale      | $39                     | $299+                     | MySQL-based, overkill for this use case  |

#### LLM: GPT-4o-mini vs Claude 3.5 Haiku vs GPT-4o

| Option              | Cost per 1M input/output  | Monthly @ 1K users | Notes                                   |
| ------------------- | ------------------------- | ------------------ | --------------------------------------- |
| **GPT-4o-mini**     | $0.15 / $0.60             | $34                | Selected — best cost/performance ratio  |
| Claude 3.5 Haiku    | $0.25 / $1.25             | $72                | More expensive, different tool calling  |
| GPT-4o              | $2.50 / $10.00            | $580               | 17x more expensive, overkill for most   |

#### Hosting: Railway vs Render vs Fly.io

| Option        | Monthly Cost (small server) | Monthly Cost (scaled) | Notes                             |
| ------------- | --------------------------- | --------------------- | --------------------------------- |
| **Railway**   | $5                          | $30-100               | Selected — usage-based, simple    |
| Render        | $7                          | $25-85                | Similar pricing, slightly slower  |
| Fly.io        | $0-5                        | $20-80                | Edge deployment, more complex     |

### Cost Summary

| Category                          | Low Estimate | High Estimate |
| --------------------------------- | ------------ | ------------- |
| Total development (7 days)        | $10          | $20           |
| Monthly ops (at 1K users)         | $69          | $100          |
| Monthly ops (at 10K users)        | $490         | $700          |
| Annual ops (at 1K users)          | $828         | $1,200        |
| Annual ops (at 10K users)         | $5,880       | $8,400        |

---

## 8. Risks & Mitigations

| Risk                                                  | Impact | Likelihood | Mitigation                                                                        |
| ----------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------- |
| Chatbox web build fails or is hard to modify          | High   | Medium     | Follow Byron's exact steps; have fallback plan to build minimal React SPA         |
| Plugin completion signaling breaks in edge cases      | High   | High       | Build defensive handlers early; test iframe crash, close, timeout scenarios       |
| OAuth redirect doesn't work inside iframes            | Medium | High       | Use popup window approach for OAuth instead of iframe redirect                    |
| Supabase free tier pauses after inactivity            | Medium | Medium     | Set up periodic health check ping; upgrade to Pro ($25/mo) if needed             |
| CORS issues between Vercel frontend + Railway API     | Medium | Medium     | Configure CORS middleware on day 1; test cross-origin early                       |
| Intent Classifier misroutes user messages             | Medium | Medium     | Fallback: if classifier confidence is low, inject all schemas (graceful degrades) |
| Policy Gate incorrectly blocks legitimate tool calls  | Medium | Low        | Gate logic is simple and deterministic; unit test every deny condition            |
| Tool-output firewall strips valid fields from results | Medium | Low        | Define outputSchemas carefully per app; log all stripped fields during dev        |
| OpenAI function calling hallucinates tool names       | Medium | Low        | Validate tool names against registry before Policy Gate; return clear errors      |
| Spotify API rate limits during demo                   | Low    | Medium     | Cache search results; have pre-built playlist as demo fallback                    |
| Running out of time on Day 7                          | High   | Medium     | Prioritize: 1 solid app > 4 broken apps. Chess must work perfectly first.        |

---

## 9. Next Steps

1. **Fork chatboxai/chatbox** to GitLab and verify web build works locally
2. **Create Supabase project** and run initial migration (conversations, messages, app_registrations tables)
3. **Scaffold Express backend** with TypeScript, AI SDK, and basic `/api/chat` SSE endpoint
4. **Write the 500-word Case Study Analysis** for the pre-search document
5. **Record architecture video** presenting this plan
