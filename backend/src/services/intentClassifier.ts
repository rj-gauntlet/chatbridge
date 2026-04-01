import { generateText } from 'ai'
import { openai, CLASSIFIER_MODEL } from './openai'
import type { AppRegistration } from '../../../shared/types/app'

/**
 * Phase 1 of two-phase routing.
 * Given a user message and list of registered apps, returns the matched app slug or null.
 * Uses a lightweight OpenAI call with app descriptions only (no full tool schemas).
 */
export async function classifyIntent(
  message: string,
  apps: AppRegistration[],
): Promise<string | null> {
  if (apps.length === 0) return null

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
    const { text } = await generateText({
      model: openai(CLASSIFIER_MODEL),
      prompt,
      maxTokens: 10,
      temperature: 0,
    })

    const slug = text.trim().toLowerCase().replace(/['"]/g, '')
    if (slug === 'null' || !slug) return null

    // Validate the returned slug is a real app
    const matched = apps.find((a) => a.slug === slug)
    return matched ? slug : null
  } catch (err) {
    console.error('[IntentClassifier] error:', err)
    return null // fail open — fall back to conversational
  }
}
