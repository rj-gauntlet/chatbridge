import { describe, it, expect } from 'vitest'
import { approveToolCall } from '../services/policyGate'
import type { AppRegistration } from '../../../shared/types/app'
import type { ToolCallRequest } from '../../../shared/types/tools'

const mockApp: AppRegistration = {
  id: 'app-1',
  name: 'Chess',
  slug: 'chess',
  description: 'Chess game',
  iframe_url: 'http://localhost:5174',
  auth_type: 'internal',
  status: 'active',
  tools: [
    {
      name: 'start_game',
      description: 'Start a chess game',
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'make_move',
      description: 'Make a move',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      outputSchema: { type: 'object', properties: {} },
      requiresConsent: false,
    },
  ],
  created_at: new Date().toISOString(),
}

const mockCall: ToolCallRequest = {
  appId: 'app-1',
  toolName: 'start_game',
  parameters: {},
  userId: 'user-1',
  conversationId: 'conv-1',
}

describe('Policy Gate', () => {
  it('approves a valid tool call', async () => {
    const decision = await approveToolCall(mockCall, mockApp)
    expect(decision.approved).toBe(true)
    expect(decision.reason).toBeUndefined()
  })

  it('denies when app is null (not found)', async () => {
    const decision = await approveToolCall(mockCall, null)
    expect(decision.approved).toBe(false)
    expect(decision.reason).toBe('app_unavailable')
  })

  it('denies when app is disabled', async () => {
    const disabledApp = { ...mockApp, status: 'disabled' as const }
    const decision = await approveToolCall(mockCall, disabledApp)
    expect(decision.approved).toBe(false)
    expect(decision.reason).toBe('app_disabled')
  })

  it('denies when tool not found in app', async () => {
    const call = { ...mockCall, toolName: 'nonexistent_tool' }
    const decision = await approveToolCall(call, mockApp)
    expect(decision.approved).toBe(false)
    expect(decision.reason).toBe('tool_not_found')
  })

  it('denies when pending_review status', async () => {
    const pendingApp = { ...mockApp, status: 'pending_review' as const }
    const decision = await approveToolCall(mockCall, pendingApp)
    expect(decision.approved).toBe(false)
    expect(decision.reason).toBe('app_disabled')
  })
})
