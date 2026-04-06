/**
 * Content moderation + prompt injection defense for K-12 safety.
 * Three layers:
 * 1. Prompt injection pattern detection (regex, instant)
 * 2. OpenAI Moderation API (content safety, ~50ms, free)
 * 3. System prompt hardening (handled in openai.ts, not here)
 */

interface ModerationResult {
  allowed: boolean
  reason?: string
  category?: string
}

// Common prompt injection patterns
const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: 'instruction_override' },
  { pattern: /ignore\s+(all\s+)?prior\s+instructions/i, label: 'instruction_override' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/i, label: 'instruction_override' },
  { pattern: /you\s+are\s+now\s+(DAN|evil|unrestricted|jailbroken)/i, label: 'role_hijack' },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(DAN|evil|unrestricted|unfiltered)/i, label: 'role_hijack' },
  { pattern: /enter\s+(DAN|developer|god)\s+mode/i, label: 'role_hijack' },
  { pattern: /reveal\s+(your\s+)?(system\s+prompt|instructions|initial\s+prompt)/i, label: 'prompt_extraction' },
  { pattern: /what\s+(are|is)\s+your\s+(system\s+)?instructions/i, label: 'prompt_extraction' },
  { pattern: /show\s+(me\s+)?(your\s+)?(system\s+prompt|hidden\s+instructions)/i, label: 'prompt_extraction' },
  { pattern: /repeat\s+(the\s+)?(text|words|prompt)\s+above/i, label: 'prompt_extraction' },
  { pattern: /output\s+(your\s+)?(system|initial)\s+(prompt|message|instructions)/i, label: 'prompt_extraction' },
  { pattern: /jailbreak/i, label: 'jailbreak' },
  { pattern: /do\s+anything\s+now/i, label: 'jailbreak' },
]

/**
 * Check for prompt injection patterns (instant, no API call)
 */
function checkInjectionPatterns(message: string): ModerationResult {
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { allowed: false, reason: `Prompt injection detected: ${label}`, category: label }
    }
  }
  return { allowed: true }
}

/**
 * Check content via OpenAI Moderation API (free, ~50ms)
 */
async function checkOpenAIModeration(message: string): Promise<ModerationResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: message }),
    })

    if (!response.ok) {
      console.error('[Moderation] API returned', response.status)
      return { allowed: true } // fail open if API is down
    }

    const data = await response.json() as {
      results: Array<{
        flagged: boolean
        categories: Record<string, boolean>
      }>
    }

    const result = data.results?.[0]
    if (result?.flagged) {
      const flaggedCategories = Object.entries(result.categories)
        .filter(([, flagged]) => flagged)
        .map(([category]) => category)

      return {
        allowed: false,
        reason: `Content flagged by moderation: ${flaggedCategories.join(', ')}`,
        category: flaggedCategories[0] || 'unknown',
      }
    }

    return { allowed: true }
  } catch (err) {
    console.error('[Moderation] Error:', err)
    return { allowed: true } // fail open
  }
}

/**
 * Run all moderation checks on user input.
 * Returns { allowed: true } if safe, or { allowed: false, reason, category } if blocked.
 */
export async function moderateMessage(message: string): Promise<ModerationResult> {
  // Layer 1: Injection pattern detection (instant)
  const injectionCheck = checkInjectionPatterns(message)
  if (!injectionCheck.allowed) return injectionCheck

  // Layer 2: OpenAI content moderation (free, ~50ms)
  const contentCheck = await checkOpenAIModeration(message)
  if (!contentCheck.allowed) return contentCheck

  return { allowed: true }
}
