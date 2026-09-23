import type { ReactNode } from 'react'
import styles from './BootMark.module.css'

/** The one shape a wait has. Four screens used to each render their own bare
 *  line of mono text — `Loading…`, `Linking neural session…`, `Authorizing
 *  operator link…` — and the pre-bundle shell in index.html painted nothing at
 *  all. This is that figure, once: the sigil, the rail, and whatever the wait
 *  is called. `amber` for the operator layer, which keeps its own colour even
 *  while it waits. */
export function BootMark({ children, tone = 'cyan' }: { children: ReactNode; tone?: 'cyan' | 'amber' }) {
  return (
    <div className={`${styles.wrap} ${tone === 'amber' ? styles.amber : ''}`} role="status">
      <div className={styles.mark}><span>G</span></div>
      <div className={styles.name}>G.U.I.D.E.</div>
      <div className={styles.rail}><i /></div>
      <div className={styles.line}>{children}</div>
    </div>
  )
}
