import { describe, it, expect } from 'vitest'
import { approveToolCall } from '../services/policyGate'
import { applyToolFirewall } from '../services/toolFirewall'
import type { AppRegistration } from '../../../shared/types/app'
import type { ToolCallRequest } from '../../../shared/types/tools'

// ── Shared fixtures ──────────────────────────────────────────────────────────

const makeApp = (slug: string, tools: string[]): AppRegistration => ({
  id: `app-${slug}`,
  name: slug,
  slug,
  description: `${slug} app`,
  iframe_url: `http://localhost:517x/${slug}`,
  auth_type: 'internal',
  status: 'active',
  tools: tools.map(name => ({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object', properties: {} },
  })),
  created_at: new Date().toISOString(),
})

// ── Flashcard Quiz App ────────────────────────────────────────────────────────

describe('Flashcard Quiz — Policy Gate', () => {
  const flashcardApp = makeApp('flashcards', ['start_quiz', 'get_question', 'submit_answer', 'get_results'])

  const makeCall = (toolName: string): ToolCallRequest => ({
    appId: 'app-flashcards',
    toolName,
    parameters: {},
    userId: 'user-1',
    conversationId: 'conv-1',
  })

  it('approves start_quiz', async () => {
    const d = await approveToolCall(makeCall('start_quiz'), flashcardApp)
    expect(d.approved).toBe(true)
  })

  it('approves get_question', async () => {
    const d = await approveToolCall(makeCall('get_question'), flashcardApp)
    expect(d.approved).toBe(true)
  })

  it('approves submit_answer', async () => {
    const d = await approveToolCall(makeCall('submit_answer'), flashcardApp)
    expect(d.approved).toBe(true)
  })

  it('approves get_results', async () => {
    const d = await approveToolCall(makeCall('get_results'), flashcardApp)
    expect(d.approved).toBe(true)
  })

  it('denies unknown tool', async () => {
    const d = await approveToolCall(makeCall('delete_quiz'), flashcardApp)
    expect(d.approved).toBe(false)
    expect(d.reason).toBe('tool_not_found')
  })
})

// ── Canvas App ───────────────────────────────────────────────────────────────

describe('Drawing Canvas — Policy Gate', () => {
  const canvasApp = makeApp('canvas', ['open_canvas', 'save_drawing', 'clear_canvas', 'get_drawing_info'])

  const makeCall = (toolName: string): ToolCallRequest => ({
    appId: 'app-canvas',
    toolName,
    parameters: {},
    userId: 'user-1',
    conversationId: 'conv-1',
  })

  it('approves all canvas tools', async () => {
    for (const tool of ['open_canvas', 'save_drawing', 'clear_canvas', 'get_drawing_info']) {
      expect((await approveToolCall(makeCall(tool), canvasApp)).approved).toBe(true)
    }
  })
})

// ── Spotify App ──────────────────────────────────────────────────────────────

describe('Spotify — Policy Gate', () => {
  const spotifyApp = makeApp('spotify', ['search_tracks', 'create_playlist', 'add_to_playlist', 'get_user_playlists'])

  const makeCall = (toolName: string): ToolCallRequest => ({
    appId: 'app-spotify',
    toolName,
    parameters: {},
    userId: 'user-1',
    conversationId: 'conv-1',
  })

  it('approves all spotify tools', async () => {
    for (const tool of ['search_tracks', 'create_playlist', 'add_to_playlist', 'get_user_playlists']) {
      expect((await approveToolCall(makeCall(tool), spotifyApp)).approved).toBe(true)
    }
  })

  it('denies disabled spotify app', async () => {
    const disabled = { ...spotifyApp, status: 'disabled' as const }
    expect((await approveToolCall(makeCall('search_tracks'), disabled)).approved).toBe(false)
    expect((await approveToolCall(makeCall('search_tracks'), disabled)).reason).toBe('app_disabled')
  })
})

// ── Tool Firewall — Phase 3 schemas ──────────────────────────────────────────

describe('Tool Firewall — Phase 3 schemas', () => {
  it('strips extra fields from flashcard start_quiz result', () => {
    const schema = {
      name: 'start_quiz',
      description: 'start',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          topic: { type: 'string' },
          totalCards: { type: 'number' },
        },
      },
    }
    const result = applyToolFirewall(
      { success: true, topic: 'math', totalCards: 5, __proto__: { hack: true }, secret: 'IGNORE' },
      schema
    )
    expect(result).toContain('"topic"')
    expect(result).not.toContain('secret')
    expect(result).not.toContain('IGNORE')
  })

  it('wraps canvas get_drawing_info in trust boundary', () => {
    const schema = {
      name: 'get_drawing_info',
      description: 'info',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          strokeCount: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
    }
    const result = applyToolFirewall({ strokeCount: 10, width: 800, height: 600 }, schema)
    expect(result).toContain('<tool_output source="untrusted"')
    expect(result).toContain('"strokeCount"')
  })

  it('strips tracks array extras in search_tracks result', () => {
    const schema = {
      name: 'search_tracks',
      description: 'search',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          tracks: { type: 'array' },
          resultCount: { type: 'number' },
        },
      },
    }
    const result = applyToolFirewall(
      { tracks: [{ id: '1', name: 'Song' }], resultCount: 1, internalMetadata: 'HIDDEN' },
      schema
    )
    expect(result).not.toContain('internalMetadata')
    expect(result).toContain('"tracks"')
  })
})

// ── Multi-app routing ─────────────────────────────────────────────────────────

describe('Multi-app routing (Policy Gate accepts correct app context)', () => {
  const allApps = [
    makeApp('chess', ['make_move']),
    makeApp('flashcards', ['start_quiz']),
    makeApp('canvas', ['open_canvas']),
    makeApp('spotify', ['search_tracks']),
  ]

  it('each app only approves its own tools', async () => {
    for (const app of allApps) {
      const ownTool = app.tools[0].name
      expect((await approveToolCall({ appId: app.id, toolName: ownTool, parameters: {}, userId: 'u', conversationId: 'c' }, app)).approved).toBe(true)

      // Other apps' tools are not found in this app
      const otherTools = allApps
        .filter(a => a.slug !== app.slug)
        .map(a => a.tools[0].name)

      for (const otherTool of otherTools) {
        const d = await approveToolCall({ appId: app.id, toolName: otherTool, parameters: {}, userId: 'u', conversationId: 'c' }, app)
        // Only deny if the tool name doesn't exist in this app
        if (!app.tools.find(t => t.name === otherTool)) {
          expect(d.approved).toBe(false)
        }
      }
    }
  })
})
