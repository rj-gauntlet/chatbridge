import type { AppRegistration } from '../../../shared/types/app'
import type { PolicyDecision, PolicyDenyReason } from '../../../shared/types/policy'
import type { ToolCallRequest } from '../../../shared/types/tools'
import { rateLimiter } from './rateLimiter'

const RATE_LIMIT = 30 // max 30 tool calls per user per minute
const RATE_WINDOW_MS = 60_000

/**
 * Policy Gate — deterministic, non-LLM approval layer.
 * Called before every tool invocation. The LLM suggests; the Gate approves or denies.
 */
export async function approveToolCall(
  call: ToolCallRequest,
  app: AppRegistration | null | undefined,
): Promise<PolicyDecision> {
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
  const rateLimitKey = `${call.userId}:${call.toolName}`
  if (await rateLimiter.isLimited(rateLimitKey, RATE_LIMIT, RATE_WINDOW_MS)) {
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
