/**
 * Rider rows — the feature graph's contributions, rendered.
 *
 * §7 splits a roll into a base breakdown that "needs nothing from the engine"
 * and riders that do. This is the second half. It is shared because both roll
 * surfaces need it and they must not drift: the toast (transient, newest roll)
 * and the Character screen's roll log (persistent, scrollable history).
 *
 * READ-ONLY, deliberately. §32's `manual` riders are toggles a human flips, and
 * §7 says a conditional contribution shows its FORMULA with a one-tap roll —
 * pre-rolling `1d6 [6]` before the player decides whether the creature was
 * judged puts a thumb on that decision. The tap belongs to the Roll Context
 * Panel, which owns roll display once it is built; wiring it into a toast that
 * lives 4.8 seconds and is about to be retired for rolls would be work thrown
 * away. Until then an `ask` rider renders as UNRESOLVED — visible, named, and
 * honestly not applied.
 */
import type { Rider } from '../lib/graph'
import type { AuditItem } from '../lib/graph'
import type { RiderGroup } from '../lib/rolls'
import styles from './Riders.module.css'

/** What a rider contributes, as text. `manual` riders show the formula rather
 *  than a number — see the module note. */
function riderValue(r: Rider): string {
  if (r.op !== 'add') return r.op.toUpperCase()
  if (r.when === 'manual') return r.formula || '—'
  const dice = r.dice.join(' + ')
  if (r.flat && dice) return `${dice} ${r.flat > 0 ? '+' : '−'} ${Math.abs(r.flat)}`
  if (dice) return dice
  return r.flat > 0 ? `+${r.flat}` : String(r.flat)
}

export function Riders({ groups, notes, problems }: {
  groups?: RiderGroup[]
  notes?: string[]
  problems?: AuditItem[]
}) {
  const hasGroups = (groups ?? []).some(g => g.riders.length)
  if (!hasGroups && !notes?.length && !problems?.length) return null

  return (
    <div className={styles.riders}>
      {(groups ?? []).filter(g => g.riders.length).map(g => (
        <div key={g.label} className={styles.group}>
          <span className={styles.gLabel}>{g.label}</span>
          {g.riders.map((r, i) => (
            <div key={i} className={`${styles.rider} ${r.when === 'manual' ? styles.manual : styles.active}`}>
              <span className={styles.box}>
                <i className={`fa-${r.when === 'manual' ? 'regular fa-square' : 'solid fa-square-check'}`} />
              </span>
              <span className={styles.rLabel}>{r.label}</span>
              <span className={styles.rVal}>{riderValue(r)}</span>
              <span className={styles.rSrc}>{r.source}</span>
            </div>
          ))}
        </div>
      ))}

      {/* Authored prose. Kept apart from problems on purpose — a note is a rule
          the DM wrote, and a problem is the engine failing. */}
      {(notes ?? []).map((n, i) => (
        <div key={i} className={styles.note}><i className="fa-solid fa-circle-info" /><span>{n}</span></div>
      ))}

      {(problems ?? []).map((p, i) => (
        <div key={i} className={styles.problem}>
          <i className="fa-solid fa-triangle-exclamation" />
          <span><b>{p.t}</b> {p.s}</span>
        </div>
      ))}
    </div>
  )
}
