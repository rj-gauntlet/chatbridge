import type { JSONSchema, ToolSchema } from '../../../shared/types/app'

const MAX_OUTPUT_BYTES = 1_024 * 1_024 // 1 MB

/**
 * Tool-output firewall — three controls applied to every tool result
 * before it enters the LLM prompt:
 *
 * 1. Schema validation — strip extra fields, reject oversized payloads
 * 2. Sanitized projection — extract only declared outputSchema fields
 * 3. Trust boundary delimiters — wrap in <tool_output source="untrusted"> tags
 */
export function applyToolFirewall(
  rawResult: Record<string, unknown>,
  toolSchema: ToolSchema,
): string {
  // Control 1: Size check
  const serialized = JSON.stringify(rawResult)
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
    return formatToolOutput({ error: 'Tool output exceeded 1MB limit and was truncated' }, toolSchema.name)
  }

  // Control 2: Schema validation + sanitized projection
  const sanitized = projectToSchema(rawResult, toolSchema.outputSchema)

  // Control 3: Trust boundary delimiters
  return formatToolOutput(sanitized, toolSchema.name)
}

function formatToolOutput(data: unknown, toolName: string): string {
  return `<tool_output source="untrusted" tool="${toolName}">${JSON.stringify(data)}</tool_output>`
}

/**
 * Project an object to only include fields declared in the JSONSchema.
 * Extra fields are dropped. Missing required fields use null.
 */
function projectToSchema(
  obj: Record<string, unknown>,
  schema: JSONSchema,
): Record<string, unknown> {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    // If no schema defined, return a safe subset (top-level keys only, no nesting)
    return sanitizeFlat(obj)
  }

  const result: Record<string, unknown> = {}
  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    const value = obj[key]
    if (value === undefined) {
      result[key] = null
    } else if (fieldSchema.type === 'object' && typeof value === 'object' && value !== null) {
      result[key] = projectToSchema(value as Record<string, unknown>, fieldSchema)
    } else if (fieldSchema.type === 'array' && Array.isArray(value)) {
      result[key] = value.slice(0, 100) // cap arrays at 100 items
    } else {
      result[key] = sanitizeScalar(value)
    }
  }
  return result
}

function sanitizeFlat(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'object' || v === null) {
      result[k] = sanitizeScalar(v)
    } else if (Array.isArray(v)) {
      result[k] = v.slice(0, 20).map(sanitizeScalar)
    } else {
      // Nested objects: include summary only
      result[k] = '[object]'
    }
  }
  return result
}

function sanitizeScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.slice(0, 2000) // cap strings at 2000 chars
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }
  return String(value).slice(0, 500)
}
