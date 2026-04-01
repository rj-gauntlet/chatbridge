import { describe, it, expect } from 'vitest'
import { applyToolFirewall } from '../services/toolFirewall'
import type { ToolSchema } from '../../../shared/types/app'

const chessToolSchema: ToolSchema = {
  name: 'make_move',
  description: 'Make a chess move',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      fen: { type: 'string' },
      turn: { type: 'string' },
      isCheck: { type: 'boolean' },
    },
  },
}

describe('Tool-output Firewall', () => {
  it('wraps output in trust boundary delimiters', () => {
    const result = applyToolFirewall({ success: true, fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', turn: 'b', isCheck: false }, chessToolSchema)
    expect(result).toContain('<tool_output source="untrusted"')
    expect(result).toContain('</tool_output>')
  })

  it('projects only declared outputSchema fields (strips extras)', () => {
    const raw = {
      success: true,
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
      turn: 'b',
      isCheck: false,
      injectedField: 'IGNORE ME',
      __proto__: { hack: true },
    }
    const result = applyToolFirewall(raw, chessToolSchema)
    expect(result).not.toContain('injectedField')
    expect(result).not.toContain('IGNORE ME')
    expect(result).toContain('"fen"')
  })

  it('truncates oversized string values', () => {
    const raw = { success: true, fen: 'x'.repeat(5000), turn: 'w', isCheck: false }
    const result = applyToolFirewall(raw, chessToolSchema)
    // fen should be capped at 2000 chars
    const parsed = JSON.parse(result.replace(/<tool_output[^>]*>/, '').replace('</tool_output>', ''))
    expect(parsed.fen.length).toBeLessThanOrEqual(2000)
  })

  it('rejects oversized payloads (>1MB)', () => {
    const huge = { data: 'x'.repeat(1_024 * 1_024 + 1) }
    const result = applyToolFirewall(huge, { ...chessToolSchema, outputSchema: { type: 'object', properties: { data: { type: 'string' } } } })
    expect(result).toContain('exceeded 1MB limit')
  })
})
