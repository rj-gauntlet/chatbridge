# ChatBridge — Third-Party App Developer Guide

This document explains how to build an app that integrates with ChatBridge. When your app is registered, the AI assistant can discover and invoke its tools automatically.

---

## Overview

ChatBridge apps are web pages that run inside sandboxed iframes. The AI communicates with your app through a postMessage bridge. You define a set of **tools** — structured functions the AI can call — and your app executes them and returns results.

```
AI (backend) → SSE → Frontend → postMessage → Your App
Your App → postMessage → Frontend → POST /api/chat/tool-result → AI (backend)
```

---

## Step 1 — Build Your App

Your app can be built with any framework (React, Vue, Svelte, vanilla JS). It just needs to be a deployable web page.

### Add the Bridge (20 lines)

Copy this into your app:

```typescript
// bridge.ts
const APP_SLUG = 'your-app-slug'  // must match your registration slug
let allowedOrigin: string | null = null

const handlers = new Map<string, (params: Record<string, unknown>) => Promise<Record<string, unknown>>>()

export function registerTool(name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) {
  handlers.set(name, handler)
}

export function signalReady() {
  window.parent.postMessage({ type: 'ready', appSlug: APP_SLUG }, allowedOrigin || '*')
}

export function sendStateUpdate(state: Record<string, unknown>) {
  window.parent.postMessage({ type: 'state_update', appSlug: APP_SLUG, state }, allowedOrigin || '*')
}

export function sendCompletion(summary: string, finalState?: Record<string, unknown>) {
  window.parent.postMessage({ type: 'completion', appSlug: APP_SLUG, summary, finalState }, allowedOrigin || '*')
}

export function initBridge(trustedOrigin?: string) {
  allowedOrigin = trustedOrigin || null

  window.addEventListener('message', async (event) => {
    if (allowedOrigin && event.origin !== allowedOrigin) return
    const msg = event.data

    if (msg.type === 'ping') {
      window.parent.postMessage({ type: 'pong' }, allowedOrigin || '*')
      return
    }

    if (msg.type === 'tool_invoke') {
      const { correlationId, toolName, parameters = {} } = msg
      const handler = handlers.get(toolName)
      if (!handler) {
        window.parent.postMessage({ type: 'tool_result', correlationId, success: false, error: `Unknown tool: ${toolName}` }, allowedOrigin || '*')
        return
      }
      try {
        const result = await handler(parameters)
        window.parent.postMessage({ type: 'tool_result', correlationId, success: true, result }, allowedOrigin || '*')
      } catch (err) {
        window.parent.postMessage({ type: 'tool_result', correlationId, success: false, error: String(err) }, allowedOrigin || '*')
      }
    }
  })

  setTimeout(signalReady, 100)
}
```

### Register Your Tools

```typescript
import { registerTool, initBridge, sendCompletion } from './bridge'

registerTool('my_tool', async (params) => {
  // do your thing
  const result = await doSomething(params.input as string)
  return { output: result, success: true }
})

initBridge() // call once on app load
```

---

## Step 2 — Define Your Tool Schemas

Tools are defined using JSON Schema. Each tool needs:

| Field          | Type   | Description                                        |
| -------------- | ------ | -------------------------------------------------- |
| `name`         | string | Unique tool name (snake_case)                      |
| `description`  | string | What the tool does — the AI reads this             |
| `inputSchema`  | object | JSON Schema for parameters                         |
| `outputSchema` | object | JSON Schema for return value                       |

**Example:**

```json
{
  "name": "get_weather",
  "description": "Get current weather for a city. Use when user asks about weather.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "city": { "type": "string", "description": "City name" },
      "units": { "type": "string", "description": "celsius or fahrenheit" }
    },
    "required": ["city"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "temperature": { "type": "number" },
      "condition": { "type": "string" },
      "humidity": { "type": "number" }
    }
  }
}
```

**Tips for writing good descriptions:**
- Be specific about when the AI should use this tool
- Include example phrases that trigger it ("Use when user says X")
- Keep it under 100 characters for intent classification performance

---

## Step 3 — Register Your App

Once your app is deployed, register it with ChatBridge:

```http
POST /api/apps
Authorization: Bearer <your-jwt-token>
Content-Type: application/json

{
  "name": "Weather App",
  "slug": "weather",
  "description": "Real-time weather lookups. Use when user asks about weather, temperature, or forecast.",
  "iframe_url": "https://your-weather-app.vercel.app",
  "auth_type": "internal",
  "icon_url": "🌤️",
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather for a city.",
      "inputSchema": { ... },
      "outputSchema": { ... }
    }
  ]
}
```

**`auth_type` options:**

| Value      | When to use                                              |
| ---------- | -------------------------------------------------------- |
| `internal` | No external auth needed — app manages its own state      |
| `public`   | App is public, no auth required                          |
| `oauth2`   | App requires OAuth (provide `oauth_config`)              |

**`oauth_config` structure (for OAuth apps):**

```json
{
  "auth_url": "https://provider.com/oauth/authorize",
  "token_url": "https://provider.com/oauth/token",
  "client_id": "your-client-id",
  "scopes": ["read", "write"]
}
```

---

## postMessage Protocol Reference

### Platform → App messages

| `type`       | Payload                                          | Description                              |
| ------------ | ------------------------------------------------ | ---------------------------------------- |
| `tool_invoke`| `{ correlationId, toolName, parameters }`        | AI wants to invoke a tool                |
| `app_close`  | `{}`                                             | Platform is closing the iframe           |
| `ping`       | `{}`                                             | Heartbeat check                          |

### App → Platform messages

| `type`         | Payload                                        | Description                              |
| -------------- | ---------------------------------------------- | ---------------------------------------- |
| `ready`        | `{ appSlug }`                                  | App has loaded and is ready              |
| `tool_result`  | `{ correlationId, success, result?, error? }`  | Response to a `tool_invoke`              |
| `state_update` | `{ appSlug, state }`                           | Push state update (AI receives as context)|
| `completion`   | `{ appSlug, summary, finalState? }`            | Session complete (AI can summarize)      |
| `error`        | `{ appSlug, code, message }`                   | App encountered an error                 |
| `pong`         | `{}`                                           | Response to `ping`                       |

---

## Security Requirements

Your app runs inside a sandboxed iframe:
```html
<iframe sandbox="allow-scripts allow-forms allow-popups">
```

**What this means for you:**
- ✅ JavaScript runs normally
- ✅ Forms work
- ✅ You can open popups (needed for OAuth)
- ❌ No `localStorage` / `sessionStorage` access (no `allow-same-origin`)
- ❌ No cookies
- ❌ No access to parent page DOM

**Origin validation:** Always validate `event.origin` in your message listener. In production, check against the ChatBridge platform origin.

**Tool output:** ChatBridge's firewall strips any fields not declared in your `outputSchema` and caps string values at 2000 characters. Only return what you declare.

---

## Tool Invocation Lifecycle

```
1. User says something in chat
2. Intent Classifier identifies your app slug
3. AI calls your tool via backend SSE event
4. Backend sends { type: 'tool_call', correlationId, toolName, parameters } via SSE
5. Frontend forwards to your iframe via postMessage { type: 'tool_invoke', ... }
6. Your app executes the tool, returns result via postMessage { type: 'tool_result', ... }
7. Frontend POSTs result to /api/chat/tool-result with correlationId
8. Backend resolves the pending promise, passes sanitized result to AI
9. AI continues streaming its response
```

Timeout: 30 seconds per tool invocation. Return an error if you can't respond in time.

---

## Rate Limits

| Limit               | Value             |
| ------------------- | ----------------- |
| Tool calls per min  | 30 per user       |
| Max response size   | 1MB               |
| Max string field    | 2000 characters   |
| Invocation timeout  | 30 seconds        |

---

## Testing Your Integration

1. Run ChatBridge locally (`npm run dev` in backend, `pnpm run dev:web` in frontend)
2. Run your app locally (e.g., `npm run dev` on port 5178)
3. Register your app pointing to `http://localhost:5178`
4. Chat with the AI using phrases that match your app's description
5. Verify tool calls appear in browser console

**Debug tip:** Open your iframe in a new tab directly and use `window.parent.postMessage` in the console to simulate tool invocations:

```javascript
window.dispatchEvent(new MessageEvent('message', {
  data: { type: 'tool_invoke', correlationId: 'test-123', toolName: 'my_tool', parameters: { input: 'hello' } },
  origin: 'http://localhost:5173'
}))
```

---

## Example Apps

| App        | Slug         | Auth     | Tools                                           | Source                  |
| ---------- | ------------ | -------- | ----------------------------------------------- | ----------------------- |
| Chess      | `chess`      | internal | start_game, make_move, get_board_state, get_legal_moves | `apps/chess/`   |
| Flashcards | `flashcards` | internal | start_quiz, get_question, submit_answer, get_results | `apps/flashcards/` |
| Canvas     | `canvas`     | internal | open_canvas, save_drawing, clear_canvas, get_drawing_info | `apps/canvas/` |
| Spotify    | `spotify`    | oauth2   | search_tracks, create_playlist, add_to_playlist, get_user_playlists | `apps/spotify/` |

---

## Support

- GitHub Issues: [chatbridge/issues](#)
- Email: support@chatbridge.app
