/**
 * Which rules engine answers: the TypeScript original, the Rust/WebAssembly
 * port, or both.
 *
 *   ts      the original. The default until the port has proven itself.
 *   wasm    the port.
 *   shadow  BOTH run; the TypeScript answer is used and any difference is
 *           logged. For development and for the DM's device during real sessions.
 *
 * Per DEVICE, like lib/chime.ts — it is a fact about this browser's rollout
 * stage, not about a character. `ENGINE=…` in the environment wins, which is how
 * the test suite runs every existing case against both engines.
 */
export type EngineMode = 'ts' | 'wasm' | 'shadow'

const KEY = 'guide.engine'
const isMode = (v: unknown): v is EngineMode => v === 'ts' || v === 'wasm' || v === 'shadow'

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ENGINE

/** Under the test runner a difference is a failure, not a log line. */
export const STRICT = isMode(env)

function initial(): EngineMode {
  if (isMode(env)) return env
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    if (isMode(v)) return v
  } catch { /* private window: default */ }
  return 'ts'
}

// Read once: the dispatcher runs on every formula, and storage is a synchronous read.
let current = initial()

export const engineMode = (): EngineMode => current

export function setEngineMode(mode: EngineMode): void {
  current = mode
  try { localStorage.setItem(KEY, mode) } catch { /* private window: this session only */ }
}
