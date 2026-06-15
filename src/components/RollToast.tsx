import { useEffect, useRef, useState } from 'react'
import { useRollLog } from '../lib/rolls'
import styles from './RollToast.module.css'

const VISIBLE_MS = 4800

/** Pops the newest roll from the shared log, bottom-right, and auto-dismisses.
 *  Only reacts to rolls created AFTER mount (so navigating to a screen doesn't
 *  resurface a stale roll), and keys on entry id so two identical totals re-fire. */
export function RollToast() {
  const { rolls } = useRollLog()
  const latest = rolls[0]
  const mountRef = useRef(Date.now())
  const [dismissed, setDismissed] = useState<string | null>(null)

  // Show only a fresh, not-yet-dismissed roll. Derived each render (no ref-mutation
  // guard) so StrictMode's double-invoke can't strand the auto-dismiss timer.
  const show = latest && latest.at >= mountRef.current && latest.id !== dismissed ? latest : null

  useEffect(() => {
    if (!show) return
    const t = setTimeout(() => setDismissed(show.id), VISIBLE_MS)
    return () => clearTimeout(t)
  }, [show?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null

  const a = show.attack
  const d = show.damage
  return (
    <div
      className={styles.toast} key={show.id} role="status"
      onClick={() => setDismissed(show.id)} title="Dismiss"
    >
      <div className={styles.head}>
        <span className={styles.icon}><i className={`fa-solid ${show.icon ?? 'fa-dice-d20'}`} /></span>
        <div className={styles.titles}>
          <span className={styles.title}>{show.title}</span>
          {show.subtitle && <span className={styles.sub}>{show.subtitle}</span>}
        </div>
        <span className={styles.dismiss}><i className="fa-solid fa-xmark" /></span>
      </div>

      {a && (
        <div className={`${styles.line}${a.crit ? ' ' + styles.crit : ''}${a.fumble ? ' ' + styles.fumble : ''}`}>
          <span className={styles.lab}>{a.crit ? 'Critical!' : a.fumble ? 'Attack (nat 1)' : 'Attack'}</span>
          <span className={styles.total}>{a.total}</span>
          <span className={styles.bd}>{a.breakdown}</span>
        </div>
      )}
      {d && (
        <div className={`${styles.line}${d.crit ? ' ' + styles.crit : ''}`}>
          <span className={styles.lab}>Damage{d.type ? ` · ${d.type}` : ''}</span>
          <span className={styles.total}>{d.total}</span>
          <span className={styles.bd}>{d.breakdown}</span>
        </div>
      )}
      {(show.lines ?? []).map((l, i) => (
        <div key={i} className={`${styles.line}${l.tone === 'heal' ? ' ' + styles.heal : l.tone === 'buff' ? ' ' + styles.buff : ''}`}>
          <span className={styles.lab}>{l.label}</span>
          <span className={styles.total}>{l.total}</span>
          {l.breakdown && <span className={styles.bd}>{l.breakdown}</span>}
        </div>
      ))}
    </div>
  )
}
