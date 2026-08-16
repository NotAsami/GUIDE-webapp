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
 * A DIE, THOUGH, CAN BE REROLLED. That is not a contradiction of the lock: the
 * lock is about the panel never silently re-rolling on its own, and a reroll is
 * the player deliberately spending something (Lucky, Portent, a house rule) and
 * saying so. It shows as rerolled, keeps the face it first had, and every total
 * above it moves. A locked rider's dice and a dropped die are both refused.
 *
 * State lives in the shared roll log, so a rider answered here is answered
 * everywhere. Fold state is local: it is how you are reading the list, not part
 * of the roll.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRollLog, type RollEntry } from '../lib/rolls'
import { rolledDiceTerms } from '../lib/dice'
import { Prose, renderInline } from '../lib/markdown'
import type { CharacterRow, ShardTree } from '../lib/database.types'
import {
  catalogView, lineViews, rerollAt, resolvedOf, riderViews, rollTotals, unresolvedOf,
  type CatalogView, type Die, type DieAddr, type RiderView, type RollLineView,
} from '../lib/rollView'
import styles from './RollContextPanel.module.css'

const cx = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ')

const FLAG_ICON: Record<string, string> = {
  ADVANTAGE: 'fa-angles-up', DISADVANTAGE: 'fa-angles-down', CRIT: 'fa-burst',
}

const stamp = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** "+ 2" / "− 4", with a real minus and a space — a modifier list is read, not
 *  computed, and "-4" jammed against a label is where the sign gets missed. */
const sgn = (n: number) => `${n < 0 ? '−' : '+'} ${Math.abs(n)}`

/* ---------------- tooltip ----------------
 *
 * Its own, rather than useItemTooltip: that one is a FACTS-ONLY item card
 * positioned to the right of its anchor, and this is a three-slot key/value/hint
 * strip that flips above. Same doctrine, different shape — bending one into the
 * other costs more than the twenty lines below. */

type TipData = { k: string; v: ReactNode; hint?: string | null }
type Tip = TipData & { rect: DOMRect }

function TipLayer({ tip }: { tip: Tip | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    // Measured AFTER the content is in, or the flip decision uses a stale height.
    const t = el.getBoundingClientRect()
    const top = tip.rect.top - t.height - 8
    el.style.top = `${top < 8 ? tip.rect.bottom + 8 : top}px`
    el.style.left = `${Math.max(8, Math.min(tip.rect.left - 6, window.innerWidth - t.width - 12))}px`
  }, [tip])
  if (!tip) return null
  return createPortal(
    <div ref={ref} className={cx(styles.tip, styles.show)} role="tooltip">
      <div className={styles.tK}>{tip.k}</div>
      <div className={styles.tV}>{tip.v}</div>
      {tip.hint && <div className={styles.tHint}>{tip.hint}</div>}
    </div>,
    document.body,
  )
}

/** Bind a tooltip to an element: hover AND focus, so a keyboard reaches it. */
function tipProps(show: (t: TipData | null) => void, data: () => TipData) {
  const open = (e: { currentTarget: HTMLElement }) =>
    show({ ...data(), rect: e.currentTarget.getBoundingClientRect() } as TipData)
  return { onMouseEnter: open, onFocus: open, onMouseLeave: () => show(null), onBlur: () => show(null) }
}

type ShowTip = (t: (TipData & { rect?: DOMRect }) | null) => void

/* ---------------- the rail ---------------- */

export function RollContextPanel({ onClose, character, shardTrees }: {
  onClose: () => void
  character?: CharacterRow | null
  shardTrees?: Record<string, ShardTree>
}) {
  const { rolls, updateRoll, clear } = useRollLog()
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [tip, setTip] = useState<Tip | null>(null)
  // The whole entry, not just its subject: the sheet's "Interacts With" block is
  // this roll's riders — the app's honest answer to the mockup's authored list.
  const [cat, setCat] = useState<RollEntry | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const showTip = useCallback<ShowTip>(t => setTip(t as Tip | null), [])

  // A roll that arrives while the panel is open animates in and pulls the body
  // back to the top — a new roll below the fold is a roll you did not see.
  const newestId = rolls[0]?.id
  const seen = useRef<string | undefined>(newestId)
  const [fresh, setFresh] = useState<string | null>(null)
  useEffect(() => {
    if (!newestId || seen.current === newestId) return
    seen.current = newestId
    setFresh(newestId)
    bodyRef.current?.scrollTo({ top: 0 })
  }, [newestId])

  // Escape backs OUT one layer at a time: the catalog sheet first, the rail only
  // once nothing is covering it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (cat) setCat(null); else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cat, onClose])

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

  const catView = cat ? catalogView(character ?? null, cat.subject, shardTrees) : null

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
          <span className={styles.sep} />
          <button type="button" disabled={!rolls.length}
            onClick={() => setFolded(allFolded ? new Set() : new Set(rolls.map(r => r.id)))}>
            {allFolded ? 'Expand all' : 'Collapse all'}
          </button>
          <button type="button" disabled={!rolls.length} onClick={clear}>Clear</button>
        </div>

        <div className={styles.body} ref={bodyRef} aria-live="polite" onScroll={() => setTip(null)}>
          {rolls.length === 0
            ? <div className={styles.empty}>Awaiting Roll</div>
            : rolls.map((entry, i) => (
                <Entry
                  key={entry.id} entry={entry} latest={i === 0} fresh={entry.id === fresh}
                  folded={folded.has(entry.id)} onFold={() => toggleFold(entry.id)}
                  onPatch={(idx, patch) => patchRider(entry, idx, patch)}
                  onReroll={addr => {
                    const patch = rerollAt(entry, addr)
                    if (patch) updateRoll(entry.id, patch)
                    return !!patch
                  }}
                  showTip={showTip}
                  onOpenCat={() => { if (entry.subject) setCat(entry) }}
                  hasCat={!!entry.subject}
                />
              ))}
        </div>

        {cat && <CatalogSheet view={catView} entry={cat} onClose={() => setCat(null)} />}
      </aside>
      <TipLayer tip={tip} />
    </div>,
    document.body,
  )
}

/* ---------------- one roll ---------------- */

function Entry({ entry, latest, fresh, folded, onFold, onPatch, onReroll, showTip, onOpenCat, hasCat }: {
  entry: RollEntry; latest: boolean; fresh: boolean; folded: boolean
  onFold: () => void
  onPatch: (index: number, patch: Partial<RiderView['rider']>) => void
  onReroll: (addr: DieAddr) => boolean
  showTip: ShowTip
  onOpenCat: () => void
  hasCat: boolean
}) {
  const views = useMemo(() => riderViews(entry), [entry])
  const lines = useMemo(() => lineViews(entry), [entry])
  const totals = useMemo(() => rollTotals(entry, views), [entry, views])
  const resolved = resolvedOf(views)
  const unresolved = unresolvedOf(views)
  // Rider fold state is local for the same reason entry fold state is: it is how
  // you are reading the list, not part of the roll.
  const [foldedRiders, setFoldedRiders] = useState<Set<number>>(new Set())
  // Which die is mid-flourish, as "<line>:<die>" or "r<rider>:*" for a whole
  // rider. One at a time — you can only click one.
  const [spin, setSpin] = useState<string | null>(null)
  const spinTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flash = useCallback((key: string) => {
    setSpin(key)
    clearTimeout(spinTimer.current)
    spinTimer.current = setTimeout(() => setSpin(null), 360)
  }, [])
  useEffect(() => () => clearTimeout(spinTimer.current), [])

  const crit = !!(entry.check?.crit || entry.attack?.crit)
  const fumble = !!(entry.check?.fumble || entry.attack?.fumble)
  // Only real failures. An audit item can be 'ok' or 'warn' — an authoring note
  // rendered as a red "Not applied" is the panel lying about the roll.
  const problems = (entry.problems ?? []).filter(p => p.sev === 'err')

  const reroll = (addr: DieAddr, key: string) => { if (onReroll(addr)) flash(key) }

  return (
    <article data-entry={entry.id} className={cx(styles.entry, latest ? styles.latest : styles.stale,
      fresh && styles.fresh, folded && styles.foldedEntry, crit && styles.crit, fumble && !crit && styles.fumble)}>
      {crit && <span className={styles.eTag}>Critical</span>}
      {fumble && !crit && <span className={styles.eTag}>Fumble</span>}
      <span className={styles.eFrame} aria-hidden="true" />
      <div className={styles.eInner}>
        <header className={styles.eHead} onClick={onFold}>
          <span className={styles.eGlyph}><i className={`fa-solid ${entry.icon ?? 'fa-dice-d20'}`} /></span>
          <div>
            <div
              className={cx(styles.eName, hasCat && styles.linked)}
              title={hasCat ? 'Open catalog entry' : undefined}
              onClick={hasCat ? e => {
                e.stopPropagation()
                // A collapsed entry expands first. Clicking the name of something
                // you cannot see the numbers of should show you the numbers.
                if (folded) onFold(); else onOpenCat()
              } : undefined}
            >
              {entry.title}
              {hasCat && <i className={`fa-solid fa-book-open ${styles.bk}`} />}
            </div>
            {entry.subtitle && !folded && <div className={styles.eFlavor}>{entry.subtitle}</div>}
          </div>
          <span className={styles.eRight}>
            <span className={styles.eStamp}>{stamp(entry.at)}</span>
            <span className={styles.eFold}><i className="fa-solid fa-chevron-down" /></span>
          </span>
        </header>

        {!folded && (
          <div className={styles.eBody}>
            {lines.map((l, i) => (
              <Line key={i} line={l} index={i} showTip={showTip} spin={spin}
                onReroll={die => reroll({ line: i, die }, `${i}:${die}`)} />
            ))}

            {/* Resolved: the engine already decided. No switch, nothing to do. */}
            {resolved.length > 0 && (
              <div className={styles.contribs}>
                {resolved.map(v => <Contribution key={v.index} v={v} showTip={showTip} />)}
              </div>
            )}

            {unresolved.length > 0 && (
              <>
                <div className={styles.askH}>
                  <i className="fa-solid fa-diamond" />Your call
                  <span className={styles.sep} /><span>{unresolved.length}</span>
                </div>
                <div className={styles.riders}>
                  {unresolved.map(v => (
                    <Ask
                      key={v.index} v={v} onPatch={onPatch} showTip={showTip} spin={spin}
                      folded={foldedRiders.has(v.index)}
                      onFold={() => setFoldedRiders(prev => {
                        const next = new Set(prev)
                        if (next.has(v.index)) next.delete(v.index); else next.add(v.index)
                        return next
                      })}
                      onRolled={() => {
                        // Rolling opens the rider — the answer is the point.
                        setFoldedRiders(prev => {
                          const next = new Set(prev)
                          next.delete(v.index)
                          return next
                        })
                        flash(`r${v.index}:*`)
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            <footer className={styles.eFoot}>
              <div>{totals.attack !== undefined && (
                <div className={cx(styles.tot, styles.atk)}>
                  {/* The line's OWN label — "Total Save DC" vs "Total Check" is a
                      difference the footer must not guess at. */}
                  <span className={styles.k}>
                    Total {lines.find(l => l.kind === 'attack' || l.kind === 'check')?.label ?? 'Attack'}
                  </span>
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
              <div className={styles.pending} {...tipProps(showTip, () => ({
                k: 'Your call',
                v: unresolved.filter(v => !v.live).map((v, i) => (
                  <div key={i} style={{ marginTop: i ? 8 : 0 }}>
                    <b style={{ color: 'var(--cyan-hot)' }}>{v.rider.label}</b>{' '}
                    {v.rider.on ? 'not rolled' : 'not confirmed'}<br />
                    <span style={{ color: 'var(--beige-dim)' }}>
                      {v.rider.source} · {v.kind === 'flag'
                        ? `grants ${v.grants}`
                        : `${v.rider.formula}${v.rider.dmgType ? ` ${v.rider.dmgType}` : ''}`}
                    </span>
                  </div>
                )),
                hint: 'Answer them on the riders above',
              }))}>
                <i className="fa-solid fa-circle-question" />
                {totals.pending} rider{totals.pending > 1 ? 's' : ''} still waiting on you
              </div>
            )}

            {/* The engine reporting a fault. Deliberately not mixed with notes:
                a formula that broke is not rule text somebody wrote. */}
            {problems.length > 0 && (
              <div className={styles.probs} role="alert">
                <div className={styles.probsH}>
                  <i className="fa-solid fa-triangle-exclamation" />Problems
                  <span className={styles.n}>
                    {problems.length} contribution{problems.length > 1 ? 's' : ''} dropped
                  </span>
                </div>
                {problems.map((p, i) => (
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

function DieChip({ d, locked, spinning, mode, showTip, onReroll }: {
  d: Die; locked?: boolean; spinning?: boolean
  mode?: 'adv' | 'dis'
  showTip: ShowTip
  onReroll?: () => void
}) {
  // A penalty die (Bane's -1d4) shows a negative face. "Max" and "min" are
  // statements about the FACE, and a -3 is neither, so neither fires.
  const best = !d.dropped && d.v > 0 && d.v === d.sides
  const worst = !d.dropped && d.v === 1
  const inert = !!d.dropped || !!locked
  return (
    <button
      type="button" tabIndex={inert ? -1 : 0}
      className={cx(styles.die, d.dropped && styles.dropped, best && styles.max, worst && styles.min,
        d.crit && styles.critdie, d.rerolled && styles.rerolled, spinning && styles.spin,
        locked && styles.lockedDie)}
      onClick={inert ? undefined : onReroll}
      {...tipProps(showTip, () => ({
        k: `d${d.sides}`,
        v: (<>
          natural <b style={{ color: 'var(--cyan-hot)' }}>{d.v}</b> on a d{d.sides}<br />
          range 1–{d.sides}
          {d.dropped && <><br />dropped — {mode === 'dis' ? 'disadvantage keeps the low die' : 'advantage keeps the high die'}</>}
          {d.crit && <><br />extra die from critical hit</>}
          {d.rerolled && <><br />rerolled from <b>{d.orig}</b></>}
        </>),
        hint: locked ? 'Locked — rolled riders keep their value' : d.dropped ? null : 'Click to reroll this die',
      }))}
    >{d.v}</button>
  )
}

function Line({ line, index, showTip, spin, onReroll }: {
  line: RollLineView; index: number; showTip: ShowTip; spin: string | null
  onReroll: (die: number) => void
}) {
  const isAtk = line.kind !== 'damage'
  return (
    <section className={cx(styles.line, line.crit && styles.critLine)}>
      <div className={styles.lHead}>
        <span className={cx(styles.lTag, !isAtk && styles.dmg)}>{line.label}</span>
        {line.type && <span className={styles.lType} data-t={line.type.toLowerCase()}>{line.type}</span>}
        {line.mode && (
          <span className={styles.lType} data-t={line.mode}>
            {line.mode === 'adv' ? 'Advantage' : 'Disadvantage'}
          </span>
        )}
        {line.crit && <span className={styles.lType} data-t="radiant">Crit ×2</span>}
        <span className={styles.lSum}>{line.total}</span>
      </div>
      <div className={styles.lMath}>
        {line.dice.length > 0 && <span className={styles.form}>{line.formula}</span>}
        {line.dice.map((d, i) => (
          <span key={i}>
            {i > 0 && <span className={styles.op}>{line.mode ? 'vs' : '+'}</span>}
            <DieChip d={d} mode={line.mode} showTip={showTip}
              spinning={spin === `${index}:${i}`} onReroll={() => onReroll(i)} />
          </span>
        ))}
        {line.mods !== 0 && (<>
          {/* A dice-less line ("Save DC 15") reads "15 = 15", not "+ 15 = 15". */}
          {line.dice.length > 0 && <span className={styles.op}>{line.mods < 0 ? '−' : '+'}</span>}
          <span className={styles.mod} {...tipProps(showTip, () => ({
            k: 'Modifiers',
            v: line.modParts.length
              ? line.modParts.map((t, i) => (
                  <span key={i}>{i > 0 && <br />}{t.label} <b style={{ color: 'var(--beige)' }}>{sgn(t.value)}</b></span>
                ))
              : sgn(line.mods),
          }))}>
            {line.dice.length === 0 && line.mods < 0 ? '−' : ''}{Math.abs(line.mods)}
          </span>
        </>)}
        <span className={styles.eq}>=</span><span className={styles.res}>{line.total}</span>
      </div>
    </section>
  )
}

/** RESOLVED — a contribution line. No switch, no button, nothing to decide. */
function Contribution({ v, showTip }: { v: RiderView; showTip: ShowTip }) {
  const r = v.rider
  const onAttack = v.group === 'Attack' || v.group === 'Check' || v.group === 'Save'
  return (
    <div className={styles.contrib} {...tipProps(showTip, () => ({
      k: r.label,
      v: (<>
        <b style={{ color: 'var(--cyan-hot)' }}>Resolved by the engine</b><br />
        {r.when === 'always' ? 'unconditional — always part of this roll' : 'condition met from your own state'}
        {r.dice.length > 0 && <><br />{r.dice.join(' + ')}</>}
      </>),
      hint: 'Nothing to decide',
    }))}>
      <span className={styles.cName}>{r.label}</span>
      <span className={styles.cSrc}>{r.source}</span>
      <span className={styles.cRight}>
        {v.kind === 'flag' && v.grants ? (
          <span className={styles.flag} data-f={v.grants.toLowerCase()}>
            <i className={`fa-solid ${FLAG_ICON[v.grants]}`} />{v.grants}
          </span>
        ) : (<>
          {/* "flat →" is not a formula, it is the absence of one. */}
          {r.formula && r.formula !== 'flat' && <span className={styles.cForm}>{r.formula} →</span>}
          <span className={styles.cVal} data-t={r.dmgType?.toLowerCase() ?? (onAttack ? 'atk' : '')}>
            +{v.value}{onAttack ? ' atk' : r.dmgType ? ` ${r.dmgType}` : ''}
          </span>
        </>)}
      </span>
    </div>
  )
}

/** UNRESOLVED — the toggle. Formula, never a pre-rolled number, until the
 *  player says yes. Once rolled it locks. */
function Ask({ v, folded, onPatch, onFold, onRolled, showTip, spin }: {
  v: RiderView
  folded: boolean
  onPatch: (index: number, patch: Partial<RiderView['rider']>) => void
  onFold: () => void
  onRolled: () => void
  showTip: ShowTip
  spin: string | null
}) {
  const r = v.rider
  const locked = v.kind === 'value' && !!r.rolled
  const faces: Die[] = r.rolledDice ?? []
  const onAttack = v.group === 'Attack' || v.group === 'Check' || v.group === 'Save'
  const spinAll = spin === `r${v.index}:*`

  return (
    <div className={cx(styles.rider, !r.on ? styles.off : locked ? styles.locked : styles.on,
      folded && styles.foldedRider)}>
      {/* The head FOLDS; only the switch toggles. Two gestures in one row, and
          the switch is the one that changes the roll — so it is the one that
          needs a deliberate hit, not the whole row. */}
      <div className={styles.rdHead} onClick={onFold}>
        <button
          type="button" className={styles.rdSw}
          role="switch" aria-checked={r.on} aria-label={`${r.label} applies`}
          onClick={e => { e.stopPropagation(); onPatch(v.index, { on: !r.on }) }}
        />
        <span className={styles.rdName}>{r.label}</span>
        <span className={styles.rdSrc}>{r.source}</span>
        {v.kind === 'flag' && v.grants && (
          <span className={cx(styles.flag, !r.on && styles.ghost)} data-f={r.on ? v.grants.toLowerCase() : undefined}>
            {r.on && <i className={`fa-solid ${FLAG_ICON[v.grants]}`} />}{v.grants}
          </span>
        )}
        {v.kind === 'value' && r.on && r.rolled && (
          <span className={styles.rdVal}>+{v.value}{onAttack ? ' atk' : r.dmgType ? ` ${r.dmgType}` : ''}</span>
        )}
        {v.kind === 'note' && r.on && <span className={styles.rdVal}><i className="fa-solid fa-eye" /></span>}
        <span className={styles.rdFold}><i className="fa-solid fa-chevron-down" /></span>
      </div>

      {!folded && (
        <div className={styles.rdBody}>
          {/* The authored question, verbatim. It is the only thing that says what
              the player is actually being asked. */}
          {r.text && <div className={styles.rdText}>{renderInline(r.text)}</div>}

          {v.kind === 'note' ? (
            // §25's inline compute already ran, so this is the sentence WITH its
            // number in it. Held back until the player says the condition held:
            // a DC for a hit that did not land is a number they should not have.
            r.on
              ? <div className={styles.rdReveal}>{renderInline(r.reveal ?? '')}</div>
              : <div className={styles.rdHint}><i className="fa-solid fa-diamond" />Toggle on to reveal</div>
          ) : v.kind === 'flag' ? (
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
                <span key={i}>
                  {i > 0 && <span className={styles.op}>+</span>}
                  <DieChip d={d} locked showTip={showTip} spinning={spinAll} />
                </span>
              ))}
              <span className={styles.eq}>=</span><span className={styles.res}>{v.value}</span>
              {r.dmgType && <span className={styles.lType} data-t={r.dmgType.toLowerCase()} style={{ marginLeft: 4 }}>{r.dmgType}</span>}
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
                onClick={() => { onPatch(v.index, { rolled: true, rolledDice: rolledDiceTerms(r.dice) }); onRolled() }}>
                <span className={styles.bFrame} />
                <span className={styles.bIn}><i className="fa-solid fa-dice-d20" />Roll it</span>
              </button>
            </div>
          </>) : (<>
            <div className={styles.rdRun}><span className={styles.rdForm}>{r.formula}{r.dmgType ? ` ${r.dmgType}` : ''}</span></div>
            <div className={styles.rdHint}><i className="fa-solid fa-diamond" />Toggle on if it applies, then roll</div>
          </>)}
        </div>
      )}
    </div>
  )
}

/* ---------------- the catalog sheet ---------------- */

function CatalogSheet({ view, entry, onClose }: {
  view: CatalogView | null; entry: RollEntry; onClose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [view])
  // "Interacts With" is not a second authored list — it is what the engine
  // actually found for this roll, which is the only version that cannot go
  // stale against the character's real state.
  const riders = (entry.riderGroups ?? []).flatMap(g => g.riders)

  return (
    <div className={styles.cat} role="dialog" aria-label="Catalog entry">
      <div className={styles.catBar}>
        <span className={styles.k}>Catalog Entry</span>
        <span className={styles.src}>Your copy · snapshotted</span>
        <button type="button" className={styles.catClose} onClick={onClose} aria-label="Close">
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div className={styles.catBody} ref={bodyRef}>
        {!view ? (
          // Unequipped, spent, or removed since the roll. The roll still happened.
          <div className={styles.catGone}>
            No longer carried<br />
            <span>This roll's subject is not on your sheet any more.</span>
          </div>
        ) : (<>
          <div className={styles.catName}>{view.name}</div>
          <div className={styles.catLine}>
            <span className={styles.school}><i className={`fa-solid ${view.icon}`} />{view.kind}</span>
            {view.school && (<><span className={styles.sep}>·</span><span>{view.school}</span></>)}
          </div>
          {(view.stats.length > 0 || view.damage.length > 0) && (
            <div className={styles.catGrid}>
              {view.stats.map(([k, val], i) => (
                <div key={i} className={styles.catCell}>
                  <span className={styles.k}>{k}</span><span className={styles.v}>{val}</span>
                </div>
              ))}
              {view.damage.length > 0 && (
                <div className={cx(styles.catCell, styles.span2)}>
                  <span className={styles.k}>Damage</span>
                  <div className={styles.catDmg}>
                    {view.damage.map(([d, t], i) => <span key={i} data-t={t.toLowerCase()}>{d} {t}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
          {view.desc && (<>
            <span className={styles.catLbl}>Description</span>
            <Prose text={view.desc} className={styles.catDesc} />
          </>)}
          {riders.length > 0 && (<>
            <span className={styles.catLbl}>Interacts With</span>
            {riders.map((r, i) => (
              <div key={i} className={styles.catRider}>
                <div className={styles.rn}>{r.label}<span>{r.source}</span></div>
                <div className={styles.rt}>
                  {r.text
                    ? renderInline(r.text)
                    : r.op === 'add'
                      ? `Adds ${r.formula || r.flat}${r.dmgType ? ` ${r.dmgType}` : ''} to this roll.`
                      : `Grants ${r.op}.`}
                </div>
              </div>
            ))}
          </>)}
        </>)}
      </div>
    </div>
  )
}
