import type { AppRegistration } from '../../../shared/types/app'
import type { PolicyDecision, PolicyDenyReason } from '../../../shared/types/policy'
import type { ToolCallRequest } from '../../../shared/types/tools'

// In-memory rate limiter (per userId + toolName, resets every minute)
// For MVP — replace with Redis in production
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 30 // max 30 tool calls per user per minute

function isRateLimited(userId: string, toolName: string): boolean {
  const key = `${userId}:${toolName}`
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 })
    return false
  }

  entry.count++
  if (entry.count > RATE_LIMIT) return true
  return false
}

/**
 * Policy Gate — deterministic, non-LLM approval layer.
 * Called before every tool invocation. The LLM suggests; the Gate approves or denies.
 */
export function approveToolCall(
  call: ToolCallRequest,
  app: AppRegistration | null | undefined,
): PolicyDecision {
  // 1. App must exist and be active
  if (!app) {
    return deny('app_unavailable')
  }
  if (app.status !== 'active') {
    return deny('app_disabled')
  }

  // 2. Tool must exist in app's registered tools
  const tool = app.tools.find((t) => t.name === call.toolName)
  if (!tool) {
    return deny('tool_not_found')
  }

  // 3. Rate limit check
  if (isRateLimited(call.userId, call.toolName)) {
    return deny('rate_limited')
  }

  // 4. Consent check (for tools that require explicit user consent)
  // In MVP we auto-grant consent; in production this checks a consent table
  if (tool.requiresConsent) {
    // TODO: check consent table. For MVP, auto-approve.
    // return deny('consent_required')
  }

  return { approved: true }
}

function deny(reason: PolicyDenyReason): PolicyDecision {
  return { approved: false, reason }
}
