import { useEffect, useState } from 'react'
import { useRollLog } from '../lib/rolls'
import { riderViews, unresolvedOf } from '../lib/rollView'
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

  /* THE ONLY ROLL NOTIFICATION. The panel shows strictly more than the old
     bottom-right toast did, so the toast went and this took over the job of
     saying "something landed" — on the button that opens the thing to look at.

     Seeded with the newest roll already in the log, so arriving on a screen with
     history behind you does not ping for rolls you have seen. */
  // The newest entry that has NOT already announced itself. A rest toast is its
  // own notification, so it neither raises the ping nor hides an earlier roll
  // that is still unread.
  const latest = rolls.find(r => !r.quiet)
  const [seen, setSeen] = useState<string | null>(() => latest?.id ?? null)
  useEffect(() => {
    if (rollPanelOpen && latest) setSeen(latest.id)
  }, [rollPanelOpen, latest?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const unseen = !!latest && latest.id !== seen
  /* Two tones, because "a roll happened" and "the roll is waiting on you" are
     different urgencies. Red means there is a decision the engine could not make
     for you — an unanswered ask, or a formula that failed. */
  const urgent = unseen && (
    unresolvedOf(riderViews(latest)).some(v => !v.rider.on)
    || (latest.problems ?? []).some(p => p.sev === 'err')
  )

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
            title={unseen ? (urgent ? 'Roll context — waiting on you' : 'Roll context — new roll') : 'Roll context'}
          >
            <i className="fa-solid fa-dice-d20" /> ROLLS
            {unseen && <span className={`${styles.bbPing} ${urgent ? styles.urgent : ''}`} aria-hidden="true" />}
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
