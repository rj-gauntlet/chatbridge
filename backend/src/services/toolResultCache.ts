/**
 * Short-lived cache for deterministic tool results.
 * Avoids redundant tool invocations when the LLM calls the same tool
 * with the same parameters within a short window (e.g., get_legal_moves
 * for the same FEN, get_code right after set_code).
 */

const CACHE_TTL = 30_000 // 30 seconds
const MAX_ENTRIES = 500

// Tools whose output is deterministic for the same input
const CACHEABLE_TOOLS = new Set([
  'get_legal_moves',
  'get_board_state',
  'get_code',
  'get_expressions',
  'get_playback_state',
])

interface CacheEntry {
  result: Record<string, unknown>
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function buildKey(appSlug: string, toolName: string, params: Record<string, unknown>): string {
  return `${appSlug}:${toolName}:${JSON.stringify(params)}`
}

/**
 * Check if a cached result exists for this tool call.
 */
export function getCachedToolResult(
  appSlug: string,
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!CACHEABLE_TOOLS.has(toolName)) return null

  const key = buildKey(appSlug, toolName, params)
  const entry = cache.get(key)

  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }

  return entry.result
}

/**
 * Store a tool result in the cache.
 */
export function cacheToolResult(
  appSlug: string,
  toolName: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
): void {
  if (!CACHEABLE_TOOLS.has(toolName)) return

  // Evict oldest entries if cache is full
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }

  const key = buildKey(appSlug, toolName, params)
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL })
}

/**
 * Invalidate cache entries for an app (e.g., after a state-changing tool call).
 * Called after tools like make_move, set_code, add_expression that change app state.
 */
export function invalidateAppCache(appSlug: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${appSlug}:`)) {
      cache.delete(key)
    }
  }
}

// Periodic cleanup every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(key)
  }
}, 120_000)
