import { supabaseAdmin } from './supabase'
import type { AppRegistration } from '../../../shared/types/app'

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

let cachedApps: AppRegistration[] | null = null
let cacheExpiresAt = 0

/**
 * Get all active app registrations, with in-memory caching.
 * Cache TTL is 5 minutes — app registrations rarely change.
 */
export async function getActiveApps(): Promise<AppRegistration[]> {
  const now = Date.now()
  if (cachedApps && now < cacheExpiresAt) {
    return cachedApps
  }

  const { data, error } = await supabaseAdmin
    .from('app_registrations')
    .select('*')
    .eq('status', 'active')
    .order('name')

  if (error) {
    console.error('[AppRegistryCache] Failed to fetch apps:', error.message)
    // Return stale cache if available, otherwise empty
    return cachedApps || []
  }

  cachedApps = (data || []) as AppRegistration[]
  cacheExpiresAt = now + CACHE_TTL
  return cachedApps
}

/**
 * Invalidate the cache (call after app registration changes).
 */
export function invalidateAppCache() {
  cachedApps = null
  cacheExpiresAt = 0
}
