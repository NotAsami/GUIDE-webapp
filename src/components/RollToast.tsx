import { useEffect, useRef, useState } from 'react'
import { useRollLog } from '../lib/rolls'
import { lineViews, pendingOf } from '../lib/rollView'
import styles from './RollToast.module.css'
import { Icon } from './Icon'

const VISIBLE_MS = 5200

/**
 * A RESULT, not a notification — the total, and nothing that needs arguing with.
 *
 * The panel is where a roll gets taken apart: riders, breakdowns, the
 * contribution list, the dice you can reroll. None of that is here. What a player
 * needs the instant the dice land is the number, and putting it in one shared
 * toast is what saves every roll surface from displaying its own result.
 *
 * IT WORKS WITH THE NAV BADGE rather than instead of it. This is the glance —
 * gone in five seconds, and gone whether or not anyone looked. The badge is what
 * remains. So the one thing the toast says beyond the number is what it CANNOT
 * show and where that lives: a tappable "2 unresolved · open panel". A badge
 * alone never tells anyone where to go.
 *
 * ONE TOAST FOR EVERYTHING that reaches the roll log — a weapon swing, a potion,
 * a rest. They are all "a thing happened, here is the result", so a second card
 * for one of them would only be a second design to keep in step.
 *
 * Only reacts to rolls created AFTER mount (so navigating to a screen doesn't
 * resurface a stale roll), and keys on entry id so two identical totals re-fire.
 */
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

export function RollToast({ onOpen }: { onOpen: () => void }) {
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

  /* The SAME totals the panel will show, from the same function. Re-reading
     `entry.attack`/`.damage` here would be a second arithmetic that agrees until
     it doesn't. `entry.lines` carries the non-dice rows (healed, armed, effects
     cleared) and already holds display strings. */
  const lines = lineViews(show)
  const extra = show.lines ?? []
  const pending = pendingOf(show)

  return (
    <div className={styles.toast} key={show.id} role="status">
      <div className={styles.head} onClick={() => setDismissed(show.id)} title="Dismiss">
        <span className={styles.icon}><Icon name={show.icon ?? 'fa-dice-d20'} /></span>
        <div className={styles.titles}>
          <span className={styles.title}>{show.title}</span>
          {show.subtitle && <span className={styles.sub}>{show.subtitle}</span>}
        </div>
        <span className={styles.dismiss}><i className="fa-solid fa-xmark" /></span>
      </div>

      {lines.map((l, i) => (
        <div key={i} className={`${styles.res}${l.crit ? ' ' + styles.crit : ''}`}>
          <span className={styles.lab}>{l.totalLabel ?? l.label}{l.type ? ` · ${l.type}` : ''}</span>
          <span className={styles.total}>{l.total}</span>
        </div>
      ))}
      {extra.map((l, i) => (
        <div key={i} className={`${styles.res}${l.tone === 'heal' ? ' ' + styles.heal : l.tone === 'buff' ? ' ' + styles.buff : ''}`}>
          <span className={styles.lab}>{l.label}</span>
          <span className={styles.total}>{l.total}</span>
        </div>
      ))}

      {/* Names what is waiting AND where to go, and is the tap target for going
          there. A real button: focusable, and it reads as pressable rather than
          as a caption under the number.

          ALWAYS PRESENT, not only when something is unresolved. It used to be
          gated on `pending.total > 0`, which meant a roll with nothing to answer
          offered no route to the panel at all — you could see a result and have
          no way to take it apart. A quiet link is not a nag: it opens nothing by
          itself, and the count and the alert icon still appear only when there
          is genuinely something waiting, so the urgent case still reads as
          urgent. */}
      <button type="button" className={cx(styles.cta, pending.total === 0 && styles.ctaQuiet)}
        onClick={() => { setDismissed(show.id); onOpen() }}>
        {pending.total > 0 && <>
          <i className="fa-solid fa-circle-exclamation" />
          <span className={styles.ctaN}>{pending.total}</span>
          <span>{pending.asks > 0 ? 'unresolved' : pending.total === 1 ? 'problem' : 'problems'}</span>
        </>}
        <span className={styles.ctaGo}>open panel <i className="fa-solid fa-arrow-right" /></span>
      </button>
    </div>
  )
}
