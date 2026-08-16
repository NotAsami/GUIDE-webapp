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
import type { AuditItem } from '../lib/graph'
import { riderAmount } from '../lib/rollView'
import type { RiderGroup } from '../lib/rolls'
import styles from './Riders.module.css'

export function Riders({ groups, notes, problems }: {
  groups?: RiderGroup[]
  notes?: string[]
  problems?: AuditItem[]
}) {
  // `always` riders are ALREADY inside the breakdown string above these rows —
  // they exist so the Roll Context Panel can name the source of each folded-in
  // contribution. Repeating them here would show the same number twice, once in
  // the maths and once as a row. The panel renders them in its own contributions
  // section, where they are explicitly labelled as part of the breakdown.
  const shown = (groups ?? [])
    .map(g => ({ ...g, riders: g.riders.filter(r => r.when !== 'always') }))
    .filter(g => g.riders.length)
  const hasGroups = shown.length > 0
  if (!hasGroups && !notes?.length && !problems?.length) return null

  return (
    <div className={styles.riders}>
      {shown.map(g => (
        <div key={g.label} className={styles.group}>
          <span className={styles.gLabel}>{g.label}</span>
          {g.riders.map((r, i) => (
            <div key={i} className={`${styles.rider} ${r.when === 'manual' ? styles.manual : styles.active}`}>
              <span className={styles.box}>
                <i className={`fa-${r.when === 'manual' ? 'regular fa-square' : 'solid fa-square-check'}`} />
              </span>
              <span className={styles.rLabel}>{r.label}</span>
              <span className={styles.rVal}>{riderAmount(r)}</span>
              <span className={styles.rSrc}>
                {r.source}
                {/* Say so out loud. A manual rider is NOT in the total, and a
                    number sitting in a list next to numbers that are counted
                    reads as though it were. */}
                {r.when === 'manual' && <span className={styles.rPend}> · not applied</span>}
              </span>
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
