// ============================================================
// Policy Gate types
// ============================================================

export type PolicyDenyReason =
  | 'app_unavailable'
  | 'rate_limited'
  | 'consent_required'
  | 'app_disabled'
  | 'tool_not_found'
  | 'schema_invalid'

export interface PolicyDecision {
  approved: boolean
  reason?: PolicyDenyReason
}
