import { useEffect, useState } from 'react'
import { useRollLog } from '../lib/rolls'
import { pendingTotal } from '../lib/rollView'
import styles from './Layout.module.css'

interface Props {
  shopOpen: boolean
  shopDismissed: boolean
  onReopenShop: () => void
  rollPanelOpen: boolean
  onToggleRollPanel: () => void
}

/** Telemetry strip ported from Codex.html lines 1203–1224. All values are
 *  cosmetic for now (no character data feeds them in Phase 0); the save
 *  counter ticks once per second to match the mockup's "live" feel. */
export function Bottombar({ shopOpen, shopDismissed, onReopenShop, rollPanelOpen, onToggleRollPanel }: Props) {
  const [tick, setTick] = useState(14)
  const { rolls } = useRollLog()

  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % 60), 1000)
    return () => clearInterval(id)
  }, [])

  /* THE REMINDER THAT OUTLIVES THE TOAST.
     The toast is the glance — five seconds, gone whether or not anyone looked.
     This is what remains, and it is a COUNT rather than a dot on purpose: "2"
     reads as two things need you, where a dot reads as "something happened" and
     is easy to defer. It counts things, not rolls, and `pendingOf` is the single
     definition of what counts (lib/rollView.ts) so the toast's own line and this
     number can never disagree.

     No seen/unseen memory: a count of what is still outstanding needs none. A
     rest never reaches it either, having nothing unresolved to contribute. */
  const pending = pendingTotal(rolls)
  // Hidden while the panel is open — a badge on the button that opens the thing
  // you are already looking at is noise.
  const badge = rollPanelOpen ? 0 : pending

  return (
    <footer className={styles.bottombar} role="contentinfo">
      <div className={styles.bbLine}>
        <span className={styles.bbDot} />
        <span className="lab">Neural Link:</span><span className="val">Stable</span>
        <span className="sep">|</span>
        <span className="lab">Shard Integrity:</span><span className="val">98.2%</span>
        <span className="sep">|</span>
        <span className="lab">Last Sync:</span><span className="val">0.07 ms</span>
        <span className="sep">|</span>
        <span className="lab">Castella-08:</span><span className="dim">Clear · Wind NNW 4kt</span>
        <span className="sep">|</span>
        <span className="lab">Tide:</span><span className="dim">Low @ 03:47</span>

        <div className={styles.bbRight}>
          {/* Left the shop takeover open with "Leave Shop" — the DM hasn't
              closed it server-side, so it's still live for the taking. */}
          {shopOpen && shopDismissed && (
            <button type="button" className={styles.bbBtn} onClick={onReopenShop} title="Reopen the live shop">
              <i className="fa-solid fa-shop" /> Shop
            </button>
          )}
          <button
            type="button" className={`${styles.bbBtn} ${rollPanelOpen ? styles.on : ''}`}
            onClick={onToggleRollPanel}
            title={badge > 0 ? `Roll context — ${badge} unresolved` : 'Roll context'}
          >
            <i className="fa-solid fa-dice-d20" /> ROLLS
            {badge > 0 && (
              <span className={styles.bbBadge} aria-label={`${badge} unresolved`}>{badge}</span>
            )}
          </button>
          <span className="sep">|</span>
          <span className="lab">Codex</span><span className="val">v 2.4.7</span>
          <span className="sep">|</span>
          <span className={styles.bbDot} /><span className="val">DM Online</span>
          <span className="sep">|</span>
          <span className="lab">Save · 00:{tick.toString().padStart(2, '0')}</span>
        </div>
      </div>
    </footer>
  )
}
