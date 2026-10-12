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

/** Bottom strip: one line of flavour, then the real controls. Nothing here
 *  may look like live status unless it is — a ticking "Save" counter or a
 *  hardcoded "DM Online" reads as fact to a player. */
export function Bottombar({ shopOpen, shopDismissed, onReopenShop, rollPanelOpen, onToggleRollPanel }: Props) {
  const { rolls } = useRollLog()

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
        <span className={styles.bbDot} aria-hidden="true" />
        <span className="lab" aria-hidden="true">Neural Link:</span><span className="val" aria-hidden="true">Stable</span>

        <div className={styles.bbRight}>
          {/* Left the shop takeover open with "Leave Shop" — the DM hasn't
              closed it server-side, so it's still live for the taking. */}
          {shopOpen && shopDismissed && (
            <button type="button" className={styles.bbBtn} onClick={onReopenShop} title="Reopen the live shop">
              <i className="fa-solid fa-shop" /> SHOP
            </button>
          )}
          <button
            type="button" className={`${styles.bbBtn} ${rollPanelOpen ? styles.on : ''}`}
            onClick={onToggleRollPanel}
            title={badge > 0 ? `Roll context — ${badge} unresolved` : 'Roll context'}
          >
            <i className="fa-solid fa-dice-d20" aria-hidden="true" /> ROLL CONTEXT
            {badge > 0 && (
              <span className={styles.bbBadge} aria-label={`${badge} unresolved`}>{badge}</span>
            )}
          </button>
          <span className="sep" aria-hidden="true">|</span>
          <span className="lab" aria-hidden="true">Codex</span><span className="val" aria-hidden="true">v 2.4.7</span>
        </div>
      </div>
    </footer>
  )
}
