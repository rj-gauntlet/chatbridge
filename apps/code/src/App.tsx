import { useState, useEffect, useRef, useCallback } from 'react'
import { registerTool, initBridge, sendStateUpdate } from './bridge'

/* ------------------------------------------------------------------ */
/*  JS execution sandbox                                               */
/* ------------------------------------------------------------------ */

function executeCode(source: string): { output: string; error?: string } {
  const logs: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    logs.push(
      args
        .map((a) =>
          typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
        )
        .join(' '),
    )
  }
  console.warn = console.log
  console.error = console.log

  try {
    // eslint-disable-next-line no-eval
    const result = eval(source)
    if (result !== undefined && logs.length === 0) {
      logs.push(String(result))
    }
    return { output: logs.join('\n') }
  } catch (err) {
    return {
      output: logs.join('\n'),
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
  }
}

/* ------------------------------------------------------------------ */
/*  App component                                                      */
/* ------------------------------------------------------------------ */

export default function App() {
  const [code, setCode] = useState<string>('// Write your JavaScript here\n')
  const [output, setOutput] = useState<string[]>([])
  const [prompt, setPrompt] = useState<string>('')
  const [isReadonly, setIsReadonly] = useState<boolean>(false)
  const [language] = useState<string>('javascript')

  // Refs for tool handlers to always see latest state
  const codeRef = useRef(code)
  codeRef.current = code

  /* ---- Run handler ------------------------------------------------ */

  const handleRun = useCallback(
    (sourceOverride?: string) => {
      const source = sourceOverride ?? codeRef.current
      const result = executeCode(source)
      const lines: string[] = []
      if (result.output) lines.push(result.output)
      if (result.error) lines.push(`❌ Error: ${result.error}`)
      setOutput(lines)

      sendStateUpdate({
        language,
        codeLength: source.length,
        hasError: !!result.error,
      })

      return result
    },
    [language],
  )

  /* ---- Register bridge tools -------------------------------------- */

  useEffect(() => {
    registerTool('set_code', async (params) => {
      const newCode = String(params.code ?? '')
      setCode(newCode)
      codeRef.current = newCode
      return { success: true }
    })

    registerTool('run_code', async (params) => {
      let source = codeRef.current
      if (params.code !== undefined) {
        source = String(params.code)
        setCode(source)
        codeRef.current = source
      }
      const result = executeCode(source)
      const lines: string[] = []
      if (result.output) lines.push(result.output)
      if (result.error) lines.push(`❌ Error: ${result.error}`)
      setOutput(lines)

      sendStateUpdate({
        language,
        codeLength: source.length,
        hasError: !!result.error,
      })

      return { output: result.output, error: result.error }
    })

    registerTool('get_code', async () => {
      return { code: codeRef.current }
    })

    registerTool('set_prompt', async (params) => {
      const text = String(params.prompt ?? '')
      setPrompt(text)
      if (params.readonly !== undefined) setIsReadonly(Boolean(params.readonly))
      return { success: true }
    })

    initBridge()
  }, [language])

  /* ---- Line numbers ----------------------------------------------- */

  const lineCount = code.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join(
    '\n',
  )

  /* ---- Render ----------------------------------------------------- */

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerIcon}>&#x276F;</span>
        <span style={styles.headerTitle}>Code Playground</span>
        <span style={styles.headerLang}>{language.toUpperCase()}</span>
      </div>

      {/* Prompt area */}
      {prompt && (
        <div style={styles.promptArea}>
          <div style={styles.promptLabel}>Exercise</div>
          <div style={styles.promptText}>{prompt}</div>
        </div>
      )}

      {/* Editor */}
      <div style={styles.editorWrapper}>
        <pre style={styles.lineNumbers}>{lineNumbers}</pre>
        <textarea
          style={styles.editor}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          readOnly={isReadonly}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
        />
      </div>

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button style={styles.runButton} onClick={() => handleRun()}>
          &#9654; Run
        </button>
        <button
          style={styles.clearButton}
          onClick={() => setOutput([])}
        >
          Clear Output
        </button>
      </div>

      {/* Output panel */}
      <div style={styles.outputWrapper}>
        <div style={styles.outputLabel}>Output</div>
        <pre style={styles.outputArea}>
          {output.length === 0 ? (
            <span style={styles.outputPlaceholder}>
              Run your code to see output here...
            </span>
          ) : (
            output.map((line, i) => (
              <div
                key={i}
                style={
                  line.startsWith('❌')
                    ? styles.outputError
                    : styles.outputLine
                }
              >
                {line}
              </div>
            ))
          )}
        </pre>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    maxHeight: '100vh',
    overflow: 'hidden',
    background: '#1e1e2e',
    color: '#cdd6f4',
  },

  /* Header */
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: '#181825',
    borderBottom: '1px solid #313244',
    flexShrink: 0,
  },
  headerIcon: {
    fontSize: 18,
    color: '#89b4fa',
    fontWeight: 700,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#cdd6f4',
    flex: 1,
  },
  headerLang: {
    fontSize: 11,
    fontWeight: 600,
    color: '#a6adc8',
    background: '#313244',
    padding: '2px 8px',
    borderRadius: 4,
    letterSpacing: 1,
  },

  /* Prompt */
  promptArea: {
    padding: '12px 16px',
    background: '#1a1a2e',
    borderBottom: '1px solid #313244',
    flexShrink: 0,
  },
  promptLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#f9e2af',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 6,
  },
  promptText: {
    fontSize: 14,
    lineHeight: 1.5,
    color: '#bac2de',
    whiteSpace: 'pre-wrap' as const,
  },

  /* Editor */
  editorWrapper: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  lineNumbers: {
    width: 48,
    padding: '12px 8px 12px 12px',
    textAlign: 'right' as const,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 14,
    lineHeight: '1.5',
    color: '#585b70',
    background: '#181825',
    borderRight: '1px solid #313244',
    overflow: 'hidden',
    userSelect: 'none' as const,
    flexShrink: 0,
  },
  editor: {
    flex: 1,
    padding: '12px 16px',
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 14,
    lineHeight: '1.5',
    color: '#cdd6f4',
    background: '#1e1e2e',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    overflow: 'auto',
    tabSize: 2,
  },

  /* Toolbar */
  toolbar: {
    display: 'flex',
    gap: 8,
    padding: '8px 16px',
    background: '#181825',
    borderTop: '1px solid #313244',
    borderBottom: '1px solid #313244',
    flexShrink: 0,
  },
  runButton: {
    padding: '6px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: '#1e1e2e',
    background: '#89b4fa',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  clearButton: {
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 500,
    color: '#a6adc8',
    background: '#313244',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },

  /* Output */
  outputWrapper: {
    flexShrink: 0,
    height: '30%',
    minHeight: 100,
    display: 'flex',
    flexDirection: 'column',
    background: '#181825',
  },
  outputLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#a6adc8',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    padding: '8px 16px 4px',
  },
  outputArea: {
    flex: 1,
    padding: '4px 16px 12px',
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: 13,
    lineHeight: '1.6',
    overflow: 'auto',
    margin: 0,
  },
  outputPlaceholder: {
    color: '#585b70',
    fontStyle: 'italic' as const,
  },
  outputLine: {
    color: '#a6e3a1',
  },
  outputError: {
    color: '#f38ba8',
  },
}
