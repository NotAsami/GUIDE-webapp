/**
 * Roll Context Panel — the post-roll receipt rail. Every die, every modifier,
 * every contributor, and every contribution the engine had to drop.
 *
 * THE SPLIT THIS PANEL EXISTS TO DRAW (§7, §32):
 *
 *   RESOLVED   the engine decided it applies → a breakdown line, never a control
 *   UNRESOLVED only a human knows            → a toggle, showing its FORMULA
 *
 * A conditional contribution is never pre-rolled. Showing `1d6 [6]` before the
 * player decides whether the creature was judged puts a thumb on that decision —
 * the reason is ordering, not entropy. So an unresolved rider shows what it
 * WOULD roll, and rolls only when the player says it applies.
 *
 * ONCE ROLLED, IT LOCKS. Toggling it off and on again reuses the same value and
 * the roll button is gone (§8 #2) — reopening the panel must never be a free
 * reroll, or the honesty above is worthless.
 *
 * State lives in the shared roll log, so a rider answered here is answered
 * everywhere. Fold state is local: it is how you are reading the list, not part
 * of the roll.
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRollLog, type RollEntry } from '../lib/rolls'
import { rollDiceTerms } from '../lib/dice'
import {
  lineViews, resolvedOf, riderViews, rollTotals, unresolvedOf,
  type Die, type RiderView, type RollLineView,
} from '../lib/rollView'
import styles from './RollContextPanel.module.css'

const cx = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ')

const FLAG_ICON: Record<string, string> = {
  ADVANTAGE: 'fa-angles-up', DISADVANTAGE: 'fa-angles-down', CRIT: 'fa-burst',
}

const stamp = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function RollContextPanel({ onClose }: { onClose: () => void }) {
  const { rolls, updateRoll, clear } = useRollLog()
  const [folded, setFolded] = useState<Set<string>>(new Set())

  const toggleFold = (id: string) =>
    setFolded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const allFolded = rolls.length > 0 && rolls.every(r => folded.has(r.id))

  /** Patch one rider inside one entry. The rider list is flattened across
   *  groups for addressing, so the index walks the same order riderViews built. */
  function patchRider(entry: RollEntry, index: number, patch: Partial<RiderView['rider']>) {
    let i = 0
    const riderGroups = (entry.riderGroups ?? []).map(g => ({
      ...g,
      riders: g.riders.map(r => (i++ === index ? { ...r, ...patch } : r)),
    }))
    updateRoll(entry.id, { riderGroups })
  }

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Roll Context">
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.rail}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>G.U.I.D.E.</span>
          <h1 className={styles.title}>Roll Context</h1>
          <span className={styles.live}><span className={styles.dot} />Live</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </header>

        <div className={styles.sub}>
          <span>{rolls.length} {rolls.length === 1 ? 'roll' : 'rolls'}</span>
          <button type="button" disabled={!rolls.length}
            onClick={() => setFolded(allFolded ? new Set() : new Set(rolls.map(r => r.id)))}>
            {allFolded ? 'Expand all' : 'Collapse all'}
          </button>
          <button type="button" disabled={!rolls.length} onClick={clear}>Clear</button>
        </div>

        <div className={styles.body} aria-live="polite">
          {rolls.length === 0
            ? <div className={styles.empty}>Awaiting Roll</div>
            : rolls.map((entry, i) => (
                <Entry
                  key={entry.id} entry={entry} latest={i === 0}
                  folded={folded.has(entry.id)} onFold={() => toggleFold(entry.id)}
                  onPatch={(idx, patch) => patchRider(entry, idx, patch)}
                />
              ))}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

/* ---------------- one roll ---------------- */

function Entry({ entry, latest, folded, onFold, onPatch }: {
  entry: RollEntry; latest: boolean; folded: boolean
  onFold: () => void
  onPatch: (index: number, patch: Partial<RiderView['rider']>) => void
}) {
  const views = useMemo(() => riderViews(entry), [entry])
  const lines = useMemo(() => lineViews(entry), [entry])
  const totals = useMemo(() => rollTotals(entry, views), [entry, views])
  const resolved = resolvedOf(views)
  const unresolved = unresolvedOf(views)

  const crit = !!(entry.check?.crit || entry.attack?.crit)
  const fumble = !!(entry.check?.fumble || entry.attack?.fumble)

  return (
    <article className={cx(styles.entry, latest ? styles.latest : styles.stale,
      folded && styles.foldedEntry, crit && styles.crit, fumble && !crit && styles.fumble)}>
      {crit && <span className={styles.eTag}>Critical</span>}
      {fumble && !crit && <span className={styles.eTag}>Fumble</span>}
      <div className={styles.eInner}>
        <header className={styles.eHead} onClick={onFold}>
          <span className={styles.eGlyph}><i className={`fa-solid ${entry.icon ?? 'fa-dice-d20'}`} /></span>
          <div className={styles.eTitles}>
            <div className={styles.eName}>{entry.title}</div>
            {entry.subtitle && <div className={styles.eFlavor}>{entry.subtitle}</div>}
          </div>
          <span className={styles.eRight}>
            <span className={styles.eStamp}>{stamp(entry.at)}</span>
            <span className={styles.eFold}><i className="fa-solid fa-chevron-down" /></span>
          </span>
        </header>

        {!folded && (
          <div className={styles.eBody}>
            {lines.map((l, i) => <Line key={i} line={l} />)}

            {/* Resolved: the engine already decided. No switch, nothing to do. */}
            {resolved.length > 0 && (
              <div className={styles.contribs}>
                {resolved.map(v => <Contribution key={v.index} v={v} />)}
              </div>
            )}

            {unresolved.length > 0 && (
              <>
                <div className={styles.askH}>
                  <i className="fa-solid fa-diamond" />Your call
                  <span className={styles.sep} /><span>{unresolved.length}</span>
                </div>
                <div className={styles.riders}>
                  {unresolved.map(v => <Ask key={v.index} v={v} onPatch={onPatch} />)}
                </div>
              </>
            )}

            <footer className={styles.eFoot}>
              <div>{totals.attack !== undefined && (
                <div className={cx(styles.tot, styles.atk)}>
                  <span className={styles.k}>Total {lines.find(l => l.kind === 'check')?.label ?? 'Attack'}</span>
                  <span className={styles.v}>{totals.attack}</span>
                </div>
              )}</div>
              <div>{totals.damage !== undefined && (
                <div className={styles.tot}>
                  <span className={styles.k}>Total Damage</span>
                  <span className={styles.v}>{totals.damage}</span>
                  <div className={styles.split}>
                    {Object.entries(totals.byType).map(([t, n]) => (
                      <span key={t} data-t={t}>{t} <b>{n}</b></span>
                    ))}
                  </div>
                </div>
              )}</div>
            </footer>

            {totals.flags.length > 0 && (
              <div className={styles.grantedRow}>
                <span className={styles.k}>Granted</span>
                {totals.flags.map(f => (
                  <span key={f} className={styles.flag} data-f={f.toLowerCase()}>
                    <i className={`fa-solid ${FLAG_ICON[f]}`} />{f}
                  </span>
                ))}
              </div>
            )}

            {totals.pending > 0 && (
              <div className={styles.pending}>
                <i className="fa-solid fa-circle-question" />
                {totals.pending} rider{totals.pending > 1 ? 's' : ''} still waiting on you
              </div>
            )}

            {/* The engine reporting a fault. Deliberately not mixed with notes:
                a formula that broke is not rule text somebody wrote. */}
            {(entry.problems ?? []).length > 0 && (
              <div className={styles.probs} role="alert">
                <div className={styles.probsH}>
                  <i className="fa-solid fa-triangle-exclamation" />Problems
                  <span className={styles.n}>
                    {entry.problems!.length} contribution{entry.problems!.length > 1 ? 's' : ''} dropped
                  </span>
                </div>
                {entry.problems!.map((p, i) => (
                  <div key={i} className={styles.prob}>
                    <div className={styles.pTop}>
                      <span className={styles.pName}>{p.t}</span>
                      <span className={styles.pDrop}>Not applied</span>
                    </div>
                    <div className={styles.pWhy}>{p.s}</div>
                  </div>
                ))}
              </div>
            )}

            {(entry.notes ?? []).map((n, i) => (
              <div key={i} className={styles.note}><i className="fa-solid fa-circle-info" /><span>{n}</span></div>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/* ---------------- pieces ---------------- */

function DieChip({ d, locked }: { d: Die; locked?: boolean }) {
  return (
    <span className={cx(styles.die, d.dropped && styles.dropped,
      !d.dropped && d.v === d.sides && styles.max, !d.dropped && d.v === 1 && styles.min,
      locked && styles.lockedDie)}>{d.v}</span>
  )
}

function Line({ line }: { line: RollLineView }) {
  const isAtk = line.kind !== 'damage'
  return (
    <section className={cx(styles.line, line.crit && styles.critLine)}>
      <div className={styles.lHead}>
        <span className={cx(styles.lTag, !isAtk && styles.dmg)}>{line.label}</span>
        {line.type && <span className={styles.lType} data-t={line.type}>{line.type}</span>}
        {line.mode && (
          <span className={styles.lType} data-t={line.mode}>
            {line.mode === 'adv' ? 'Advantage' : 'Disadvantage'}
          </span>
        )}
        {line.crit && <span className={styles.lType} data-t="crit">Crit ×2</span>}
        <span className={styles.lSum}>{line.total}</span>
      </div>
      <div className={styles.lMath}>
        {line.dice.length > 0 && <span className={styles.form}>{line.formula}</span>}
        {line.dice.map((d, i) => (
          <span key={i}>
            {i > 0 && <span className={styles.op}>{line.mode ? 'vs' : '+'}</span>}
            <DieChip d={d} />
          </span>
        ))}
        {line.mods !== 0 && (<>
          <span className={styles.op}>{line.mods < 0 ? '−' : '+'}</span>
          <span className={styles.mod}>{Math.abs(line.mods)}</span>
        </>)}
        <span className={styles.eq}>=</span><span className={styles.res}>{line.total}</span>
      </div>
    </section>
  )
}

/** RESOLVED — a contribution line. No switch, no button, nothing to decide. */
function Contribution({ v }: { v: RiderView }) {
  return (
    <div className={styles.contrib}>
      <span className={styles.cName}>{v.rider.label}</span>
      <span className={styles.cSrc}>{v.rider.source}</span>
      <span className={styles.cRight}>
        {v.kind === 'flag' && v.grants ? (
          <span className={styles.flag} data-f={v.grants.toLowerCase()}>
            <i className={`fa-solid ${FLAG_ICON[v.grants]}`} />{v.grants}
          </span>
        ) : (<>
          {v.rider.formula && <span className={styles.cForm}>{v.rider.formula} →</span>}
          <span className={styles.cVal} data-t={v.rider.dmgType ?? (v.group === 'Attack' ? 'atk' : '')}>
            +{v.value}{v.rider.dmgType ? ` ${v.rider.dmgType}` : ''}
          </span>
        </>)}
      </span>
    </div>
  )
}

/** UNRESOLVED — the toggle. Formula, never a pre-rolled number, until the
 *  player says yes. Once rolled it locks. */
function Ask({ v, onPatch }: {
  v: RiderView; onPatch: (index: number, patch: Partial<RiderView['rider']>) => void
}) {
  const r = v.rider
  const locked = v.kind === 'value' && !!r.rolled
  const faces: Die[] = (r.rolledDice ?? []).map(n => ({ v: n, sides: 0 }))

  return (
    <div className={cx(styles.rider, !r.on ? styles.off : locked ? styles.locked : styles.on)}>
      <div className={styles.rdHead} onClick={() => onPatch(v.index, { on: !r.on })} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPatch(v.index, { on: !r.on }) } }}>
        <span className={cx(styles.rdSw, r.on && styles.swOn)} />
        <span className={styles.rdName}>{r.label}</span>
        <span className={styles.rdSrc}>{r.source}</span>
        {v.kind === 'flag' && v.grants && (
          <span className={cx(styles.flag, !r.on && styles.ghost)} data-f={r.on ? v.grants.toLowerCase() : undefined}>
            {r.on && <i className={`fa-solid ${FLAG_ICON[v.grants]}`} />}{v.grants}
          </span>
        )}
        {v.kind === 'value' && r.on && r.rolled && (
          <span className={styles.rdVal}>+{v.value}{r.dmgType ? ` ${r.dmgType}` : ''}</span>
        )}
      </div>

      <div className={styles.rdBody}>
        {v.kind === 'flag' ? (
          r.on
            ? <div className={styles.rdGrant}>
                <span className={styles.flag} data-f={v.grants?.toLowerCase()}>
                  <i className={`fa-solid ${FLAG_ICON[v.grants!]}`} />{v.grants}
                </span>granted to this roll
              </div>
            : <div className={styles.rdCond}><i className="fa-solid fa-diamond" />Condition is yours to judge · grants {v.grants}</div>
        ) : locked ? (<>
          <div className={styles.rdResult}>
            <span className={styles.form}>{r.formula}</span>
            {faces.map((d, i) => (
              <span key={i}>{i > 0 && <span className={styles.op}>+</span>}<DieChip d={d} locked /></span>
            ))}
            <span className={styles.eq}>=</span><span className={styles.res}>{v.value}</span>
          </div>
          {/* Says the quiet part: the number is settled. Toggling reuses it. */}
          <div className={styles.rdGrant}>
            <span className={styles.rdLock}><i className="fa-solid fa-lock" />Rolled · locked</span>
            toggling reuses this value
          </div>
        </>) : r.on ? (<>
          <div className={styles.rdCond}><i className="fa-solid fa-diamond" />Condition is yours to judge</div>
          <div className={styles.rdRun}>
            <span className={styles.rdForm}>{r.formula}{r.dmgType ? ` ${r.dmgType}` : ''}</span>
            <button type="button" className={styles.rdBtn}
              onClick={() => onPatch(v.index, { rolled: true, rolledDice: rollDiceTerms(r.dice) })}>
              <i className="fa-solid fa-dice-d20" />Roll it
            </button>
          </div>
        </>) : (<>
          <div className={styles.rdRun}><span className={styles.rdForm}>{r.formula}{r.dmgType ? ` ${r.dmgType}` : ''}</span></div>
          <div className={styles.rdHint}><i className="fa-solid fa-diamond" />Toggle on if it applies, then roll</div>
        </>)}
      </div>
    </div>
  )
}
