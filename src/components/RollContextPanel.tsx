/**
 * Roll Context Panel — placeholder. Toggled from the Bottombar; ported from
 * nothing yet (guide-hud/project/roll-context.js is an orphaned mockup with
 * per-die reroll, conditional "riders", and a catalog lookup sheet — a much
 * bigger feature than lib/rolls.tsx's data model supports today, which only
 * stores pre-computed results, not individual dice). This just reserves the
 * button + panel; lib/rolls.tsx's own header comment already anticipates
 * "the Character screen will later render the full scrollable history from
 * this same context" — that's the real content this panel gets next.
 */
import { createPortal } from 'react-dom'
import styles from './RollContextPanel.module.css'

export function RollContextPanel({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Roll Context">
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.rail}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>G.U.I.D.E.</span>
          <h1 className={styles.title}>Roll Context</h1>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>
        <div className={styles.body}>
          <i className="fa-solid fa-dice-d20" />
          <span className={styles.soon}>Coming Soon</span>
          <span className={styles.hint}>The full roll history — every die, every modifier — lands here next.</span>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
