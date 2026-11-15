/**
 * Which rules engine this device runs — the DM's rollout switch for the Rust
 * port (lib/engine). Three settings, and the middle one is the point:
 *
 *   TypeScript   the original. What every player runs until the port is trusted.
 *   Compare      both run on every roll; the TypeScript answer is used and any
 *                difference is recorded here. For real sessions on the DM's device.
 *   Rust         the port alone.
 *
 * Per DEVICE, like the chime: it says how far the rollout has got on this
 * browser, not anything about a character.
 */
import { useEffect, useState } from 'react'
import { clearEngineDiffs, engineDiffs, engineStatus, selectEngine } from '../lib/engine'
import type { EngineMode } from '../lib/engine/setting'
import styles from './OperatorEngine.module.css'

const CHOICES: { mode: EngineMode; label: string; title: string }[] = [
  { mode: 'ts', label: 'TypeScript', title: 'The original engine' },
  { mode: 'shadow', label: 'Compare', title: 'Run both; use the TypeScript answer and record any difference' },
  { mode: 'wasm', label: 'Rust', title: 'The Rust engine alone' },
]

export function OperatorEngine() {
  const [status, setStatus] = useState(engineStatus)
  const [found, setFound] = useState(() => engineDiffs().length)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Differences arrive from rolls made anywhere in the app, so the count is
  // re-read while comparing rather than pushed.
  useEffect(() => {
    if (status.mode !== 'shadow') return
    const t = setInterval(() => setFound(engineDiffs().length), 4000)
    return () => clearInterval(t)
  }, [status.mode])

  const choose = (mode: EngineMode) => {
    setBusy(true)
    // A module that will not load leaves the setting where it was; the status line says so.
    selectEngine(mode).catch(() => {}).finally(() => { setStatus(engineStatus()); setFound(engineDiffs().length); setBusy(false) })
  }
  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(engineDiffs(), null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className={styles.wrap} role="group" aria-label="Rules engine on this device">
      <span className={styles.label}>Rules engine</span>
      <div className={styles.choices}>
        {CHOICES.map(c => (
          <button key={c.mode} type="button" disabled={busy} title={c.title} aria-pressed={status.mode === c.mode}
            className={status.mode === c.mode ? styles.on : undefined} onClick={() => choose(c.mode)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className={styles.status} role="status">
        {status.failed
          ? 'The Rust engine did not load. Running TypeScript.'
          : status.mode === 'ts' ? 'This device only.'
          : status.mode === 'wasm' ? 'Rust engine running on this device.'
          : found === 0 ? 'Comparing. No differences recorded.'
          : `Comparing. ${found} ${found === 1 ? 'difference' : 'differences'} recorded.`}
      </p>
      {found > 0 && (
        <div className={styles.actions}>
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy differences'}</button>
          <button type="button" onClick={() => { clearEngineDiffs(); setFound(0) }}>Clear</button>
        </div>
      )}
    </div>
  )
}
