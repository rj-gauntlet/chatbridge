import { generateText } from 'ai'
import { openai, CLASSIFIER_MODEL } from './openai'
import type { AppRegistration } from '../../../shared/types/app'

// ── Keyword/pattern triggers for fast app routing (no LLM needed) ──
const KEYWORD_TRIGGERS: Record<string, string[]> = {
  chess: ['chess', 'play chess', 'chess game', 'checkmate'],
  flashcards: ['flashcard', 'flash card', 'quiz me', 'study cards', 'flashcards'],
  canvas: ['draw', 'drawing', 'canvas', 'paint', 'sketch'],
  spotify: ['music', 'play music', 'song', 'spotify', 'playlist', 'play a song', 'listen to'],
  desmos: ['graph', 'graphing', 'plot', 'desmos', 'equation', 'calculator', 'function'],
  code: ['code', 'coding', 'program', 'javascript', 'write code', 'code playground', 'let\'s code'],
  worldmap: ['map', 'geography', 'country', 'countries', 'capital', 'where is', 'world map', 'continent'],
}

// Pre-sort triggers: longer phrases first to avoid false positives
// (e.g., "play music" should match spotify before "play" could match something else)
const sortedTriggers: { slug: string; phrase: string }[] = Object.entries(KEYWORD_TRIGGERS)
  .flatMap(([slug, phrases]) => phrases.map((phrase) => ({ slug, phrase })))
  .sort((a, b) => b.phrase.length - a.phrase.length)

/**
 * Check if a message matches any keyword trigger.
 * Returns the matched app slug or null.
 */
function keywordMatch(message: string, validSlugs: Set<string>): string | null {
  const lower = message.toLowerCase()
  for (const { slug, phrase } of sortedTriggers) {
    if (!validSlugs.has(slug)) continue
    if (lower.includes(phrase)) {
      return slug
    }
  }
  return null
}

// ── LLM classification cache with TTL ──────────────────────────────
const classificationCache = new Map<string, { slug: string | null; expiresAt: number }>()
const CACHE_TTL = 60_000 // 60 seconds

// Periodic cleanup to avoid memory leaks — remove expired entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of classificationCache) {
    if (entry.expiresAt <= now) {
      classificationCache.delete(key)
    }
  }
}, 5 * 60_000)

/**
 * Phase 1 of two-phase routing.
 * Given a user message and list of registered apps, returns the matched app slug or null.
 *
 * Optimization order:
 *  1. Keyword triggers — instant match, no LLM call
 *  2. Active app passthrough — if an app is already active and no keyword switch detected, keep it
 *  3. Cache lookup — reuse recent LLM classifications for identical messages
 *  4. LLM classification — fallback to OpenAI call
 */
export async function classifyIntent(
  message: string,
  apps: AppRegistration[],
  activeAppSlug?: string | null,
): Promise<string | null> {
  if (apps.length === 0) return null

  const validSlugs = new Set(apps.map((a) => a.slug))

  // 1. Keyword triggers — fast path, no LLM call
  const kwMatch = keywordMatch(message, validSlugs)
  if (kwMatch) {
    console.log('[IntentClassifier] keyword match:', kwMatch)
    return kwMatch
  }

  // 2. If an app is already active and no keyword triggered a switch, keep it
  if (activeAppSlug && validSlugs.has(activeAppSlug)) {
    console.log('[IntentClassifier] keeping active app:', activeAppSlug)
    return activeAppSlug
  }

  // 3. Check cache for recent LLM classification of the same message
  const cacheKey = message.trim().toLowerCase()
  const cached = classificationCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    console.log('[IntentClassifier] cache hit:', cached.slug)
    return cached.slug
  }

  // 4. Fall back to LLM classification
  const appList = apps
    .map((a) => `- slug: "${a.slug}" | name: "${a.name}" | description: "${a.description}"`)
    .join('\n')

  const prompt = `You are a routing classifier. Given a user message, determine which app (if any) the user wants to use.

Available apps:
${appList}

User message: "${message}"

Respond with ONLY the app slug (e.g. "chess") if the message clearly targets an app, or "null" if it's a general conversational message.
Do not explain. Respond with exactly one word.`

  try {
    console.log('[IntentClassifier] calling OpenAI...')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const { text } = await generateText({
      model: openai(CLASSIFIER_MODEL),
      prompt,
      maxTokens: 10,
      temperature: 0,
      abortSignal: controller.signal,
    })
    clearTimeout(timer)
    console.log('[IntentClassifier] got response:', text.trim())

    const slug = text.trim().toLowerCase().replace(/['"]/g, '')
    const result = (slug === 'null' || !slug) ? null : (apps.find((a) => a.slug === slug) ? slug : null)

    // Cache the result
    classificationCache.set(cacheKey, { slug: result, expiresAt: Date.now() + CACHE_TTL })

    return result
  } catch (err) {
    console.error('[IntentClassifier] error:', err)
    return null // fail open — fall back to conversational
  }
}
