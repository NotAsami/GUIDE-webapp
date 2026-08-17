/**
 * Effect authoring — the graph block, hostable anywhere.
 *
 * Extracted from FeatureEditor when slice 6b gave spells a graph to author and
 * 6c will give items and shard nodes the same one. The vocabulary is the node's,
 * not the feature's: an `add` targeting `roll:damage` means the same thing
 * whatever declared it, so there is one component and three hosts rather than
 * three copies drifting apart.
 *
 * SELF-CONTAINED ON PURPOSE. It owns its expanded-card state and its own two
 * popovers (the catalog picker and the when/ask/target help), because a host
 * form should be able to drop it in without learning what a PopKind is. The
 * feature editor's other popovers — icon, delete, revert, folder — are editor
 * chrome and stayed behind.
 *
 * Every field an effect shows still comes from lib/opSchema.ts (§26): adding an
 * op is a schema entry, and no host has to change.
 *
 * ONE STYLESHEET, NOT A SPLIT. These components use 83 classes from what was
 * FeatureEditor.module.css; 45 of them are nested selectors and 27 are form atoms
 * the editor's own chrome still needs. Splitting would have copied ~128 rules
 * into a second module and left them to drift. The module moved here instead and
 * both hosts import it — it IS the DM authoring design language, not one
 * screen's private styling, and the bytes already shipped.
 */
import { useState } from 'react'
import type { GraphEffect, GraphOp, VarDef } from '../lib/database.types'
import {
  OPS, OP_ORDER, OP_TITLE, PALETTE, PALETTE_MORE, PALETTE_ACT, ROLL_SELECTORS,
  IS_ACTIVATION, IS_DAMAGE_FLAG, type OpField,
} from '../lib/opSchema'
import { useAutoGrow } from '../lib/textareaHooks'
import { matchCount, normalizeTag, type AuthoredNode } from '../lib/graph'
import styles from './authoring.module.css'

const cx = (...v: (string | false | undefined | null)[]) => v.filter(Boolean).join(' ')

/** What a target selector names. Three namespaces and that is the whole
 *  language (§12): a thing by gid, a tag, or a class of roll. */
export type SelKind = 'thing' | 'tag' | 'roll'

const KINDS: { k: SelKind; ic: string; l: string }[] = [
  { k: 'thing', ic: 'fa-crosshairs', l: 'Thing' },
  { k: 'tag', ic: 'fa-tag', l: 'Tag' },
  { k: 'roll', ic: 'fa-dice-d20', l: 'Roll kind' },
]

type PopKind =
  | { k: 'thing'; ei: number; ti: number }
  | { k: 'help'; which: 'when' | 'ask' | 'target' }
  | null

export function splitSel(s: string): { kind: SelKind; value: string } {
  if (s.startsWith('tag:')) return { kind: 'tag', value: s.slice(4) }
  if (s.startsWith('roll:')) return { kind: 'roll', value: s.slice(5) }
  return { kind: 'thing', value: s }
}
const joinSel = (kind: SelKind, value: string) =>
  kind === 'tag' ? `tag:${value}` : kind === 'roll' ? `roll:${value}` : value

const blankArr = () => new Array<string>(21).fill('')
const newId = () => `e${Math.random().toString(36).slice(2, 8)}`

function blankEffect(op: GraphOp): GraphEffect {
  const eff: GraphEffect = { id: newId(), op, target: [], label: '' }
  for (const fd of OPS[op].fields) {
    if (fd.type === 'array') (eff as unknown as Record<string, unknown>)[fd.key] = blankArr()
    else if (fd.type === 'boolean') (eff as unknown as Record<string, unknown>)[fd.key] = false
    else (eff as unknown as Record<string, unknown>)[fd.key] = ''
  }
  return eff
}

const HELP = {
  when: {
    t: 'when — the app decides',
    body: (
      <>
        <p><code>when</code> is a condition the app evaluates. If it reads false, the node contributes nothing and the player never sees it mentioned.</p>
        <p className={styles.mono}>Written over this feature’s variables and the character sheet. No prose, no prompt, no choice.</p>
        <div className={styles.dl}>
          <span className={styles.k}>Example</span><span className={styles.v}>hp &lt; hpMax / 2</span>
          <span className={styles.k}>Example</span><span className={styles.v}>charges &gt; 0 &amp;&amp; isRaging</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>Always true — the node always contributes.</span>
        </div>
      </>
    ),
  },
  ask: {
    t: 'ask — a human decides',
    body: (
      <>
        <p><code>ask</code> turns the node into a toggle the <em>player</em> flips at the table. The text you write is the label on that toggle.</p>
        <p className={styles.mono}>Orthogonal to <code>when</code>. A node can have both: the app checks whether the choice is legal, the player chooses whether to spend it. Two effects sharing one <code>ask</code> label become one checkbox.</p>
        <p className={styles.mono}>On a <code>note</code> it REVEALS rather than applies — legal only when the text computes something, so the DC shows once the player confirms the hit landed. A note with nothing to compute has nothing to resolve; use <code>when</code>.</p>
        <div className={styles.dl}>
          <span className={styles.k}>Example</span><span className={styles.v}>Spend a use to press the attack?</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>No prompt — the node applies on its own.</span>
        </div>
      </>
    ),
  },
  target: {
    t: 'Target selectors',
    body: (
      <>
        <p>A target list is a set of selectors. Three kinds, and they resolve differently:</p>
        <div className={styles.dl}>
          <span className={styles.k}>Thing</span><span className={styles.v}>One named entity from the catalog — a spell, item or feature. Picked by name; stored as an id.</span>
          <span className={styles.k}>Tag</span><span className={styles.v}>Every entity carrying the tag. <code>tag:fire_damage</code> follows the catalog as it grows.</span>
          <span className={styles.k}>Roll kind</span><span className={styles.v}>A class of roll rather than a thing. <code>roll:save.dex</code>, or <code>roll:save</code> for all of them.</span>
          <span className={styles.k}>Empty</span><span className={styles.v}>The node’s own roll — the feature acting on itself.</span>
        </div>
        <p className={styles.mono}>The match count beside the list is the only thing that tells a typo from a selector that correctly matches nothing yet. Read it every time.</p>
              <p className={styles.mono}>
          With two or more, the <b>or / and</b> toggle beside the heading decides how they combine.
          <b> or</b> (the default) means any one is enough: <code>weapon:sword</code> or <code>weapon:axe</code>.
          <b> and</b> means every one must hold of the SAME roll — which is the only way to say
          “a fire weapon, on its damage roll”, because <code>tag:fire</code> on its own rides into the
          attack roll too.
        </p>
</>
    ),
  },
}

/** A free identifier for a new variable, seeded from the effect's label.
 *
 *  Must satisfy VarDef's /^[a-z][a-zA-Z0-9]*$/ — so the label is stripped to
 *  camelCase and falls back to `toggle` when it strips to nothing (an unlabelled
 *  effect, or a label that is entirely punctuation). Suffixed until it is unique,
 *  because collectVars is FIRST-WINS: a duplicate name would silently bind to
 *  the other declaration instead of erroring. */
function freeName(vars: VarDef[], label: string | undefined): string {
  const words = (label ?? '').replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const base = words.length
    ? words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('')
    : 'toggle'
  const taken = new Set(vars.map(v => v.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
}

/* ---------- the block itself ---------- */

/** The whole effect list for one node: the op palette, a collapsed row per
 *  effect, one expanded card at a time, and the popovers those need.
 *
 *  `graph` and `vars` come from the host and go back through `onChange` — this
 *  owns no node state of its own, so a form can keep saving exactly the way it
 *  already saves. */
export function GraphEffects({ graph, vars, nodes, namesByGid, onChange, onVarsChange }: {
  graph: GraphEffect[]
  /** Declared variables, for the `reference` fields an op schema can ask for. */
  vars: VarDef[]
  /** The catalog, for target pickers and match counts. */
  nodes: AuthoredNode[]
  namesByGid: Map<string, { name: string; kind: string }>
  onChange: (next: GraphEffect[]) => void
  /** Lets an effect DECLARE a variable, not just read one — the `when` row's
   *  player toggle is the only user. Optional so a host that does not own its
   *  vars simply does not offer the shortcut, rather than offering a button that
   *  silently does nothing. */
  onVarsChange?: (next: VarDef[]) => void
}) {
  const [openEffect, setOpenEffect] = useState<number | null>(null)
  const [moreOps, setMoreOps] = useState(false)
  const [pop, setPop] = useState<PopKind>(null)

  const setEffect = (i: number, p: Partial<GraphEffect>) =>
    onChange(graph.map((g, j) => (j === i ? { ...g, ...p } : g)))
  const add = (op: GraphOp) => {
    onChange([...graph, blankEffect(op)])
    setOpenEffect(graph.length)
  }

  return (
    <>
      <div className={styles.blkOptin}>
        <i className="fa-solid fa-circle-info" />
        <span>One op per node, collapsed by default — each row says what it does and where it goes. Click a row to edit it. Pick an op below to add a node.</span>
      </div>

      <div className={styles.oppal}>
        <div className={styles.oppalGrp}><span className={styles.gl}>Contributions</span></div>
        <div className={styles.oppalRow}>
          {PALETTE.map(o => (
            <button key={o} type="button" className={styles.opb} onClick={() => add(o)}>
              <i className="fa-solid fa-plus" />{OP_TITLE[o]}
            </button>
          ))}
          {moreOps
            ? PALETTE_MORE.map(o => (
              <button key={o} type="button" className={styles.opb} onClick={() => add(o)}>
                <i className="fa-solid fa-plus" />{OP_TITLE[o]}
              </button>
            ))
            : <button type="button" className={cx(styles.opb, styles.more)} onClick={() => setMoreOps(true)}>
                <i className="fa-solid fa-ellipsis" />More
              </button>}
        </div>
        {/* Activations answer a different question from everything above —
            "what happens when the player presses this" rather than "what
            modifies this roll" — so they get their own group. */}
        <div className={styles.oppalGrp}><span className={cx(styles.gl, styles.act)}>Activation outcomes</span></div>
        <div className={styles.oppalRow}>
          {PALETTE_ACT.map(o => (
            <button key={o} type="button" className={cx(styles.opb, styles.act)} onClick={() => add(o)}>
              <i className="fa-solid fa-plus" />{OP_TITLE[o]}
            </button>
          ))}
        </div>
      </div>

      {graph.map((eff, ei) => (
        openEffect === ei
          ? <EffectCard key={eff.id} eff={eff} ei={ei} graph={graph} vars={vars}
              setEffect={setEffect} setGraph={onChange} onVarsChange={onVarsChange}
              nodes={nodes} namesByGid={namesByGid} setPop={setPop}
              onClose={() => setOpenEffect(null)} />
          : <EffectRow key={eff.id} eff={eff} namesByGid={namesByGid}
              onOpen={() => setOpenEffect(ei)}
              onDelete={() => { onChange(graph.filter((_, j) => j !== ei)); setOpenEffect(null) }} />
      ))}

      {pop && (
        <GraphPopover pop={pop} onClose={() => setPop(null)} nodes={nodes} namesByGid={namesByGid}
          onPick={(ei, ti, gidValue) => onChange(graph.map((g, j) => (j === ei
            ? { ...g, target: (g.target ?? []).map((t, k) => (k === ti ? gidValue : t)) }
            : g)))} />
      )}
    </>
  )
}

/* ---------- popovers this block owns ---------- */

function GraphPopover({ pop, onClose, nodes, namesByGid, onPick }: {
  pop: NonNullable<PopKind>; onClose: () => void
  nodes: AuthoredNode[]; namesByGid: Map<string, { name: string; kind: string }>
  onPick: (ei: number, ti: number, gid: string) => void
}) {
  const [q, setQ] = useState('')
  const small = pop.k !== 'thing'

  return (
    <div className={styles.scrim} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={cx(styles.pop, small && styles.small)}>
        {pop.k === 'thing' && (<>
          <div className={styles.popHead}>
            <i className="fa-solid fa-crosshairs" style={{ color: 'var(--beige)' }} />
            <span className={styles.pt}>Pick a thing</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>
            <input className={styles.in} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search the catalog by name…" autoFocus />
            <div className={styles.mono} style={{ margin: '-4px 0 10px' }}>One named entity. Names only — the id is what gets stored.</div>
            <div className={styles.pkList}>
              {(() => {
                const rows = nodes
                  .map(n => ({ n, meta: namesByGid.get(n.gid) }))
                  .filter(x => x.meta && (!q.trim() || x.meta.name.toLowerCase().includes(q.toLowerCase().trim())))
                  .slice(0, 60)
                if (!rows.length) return <div className={styles.pkNone}>Nothing in the catalog matches that.</div>
                return rows.map(({ n, meta }) => (
                  <button key={n.gid} type="button" className={styles.pkRow}
                    onClick={() => { onPick(pop.ei, pop.ti, n.gid); onClose() }}>
                    <span className={styles.n}>{meta!.name}</span>
                    <span className={styles.tg}>{(n.tags ?? []).slice(0, 2).map(t => `tag:${normalizeTag(t)}`).join(' ')}</span>
                    <span className={styles.k}>{meta!.kind}</span>
                  </button>
                ))
              })()}
            </div>
          </div>
        </>)}

        {pop.k === 'help' && (<>
          <div className={styles.popHead}>
            <i className="fa-regular fa-circle-question" style={{ color: 'var(--cyan-hot)' }} />
            <span className={styles.pt}>{HELP[pop.which].t}</span>
            <button type="button" className={styles.px} onClick={onClose}><i className="fa-solid fa-xmark" /></button>
          </div>
          <div className={styles.popBody}>{HELP[pop.which].body}</div>
        </>)}
      </div>
    </div>
  )
}

/* ---------- collapsed effect row ---------- */

function selLabel(t: string, namesByGid: Map<string, { name: string }>): string {
  const s = splitSel(t)
  if (s.kind === 'tag') return `tag:${normalizeTag(s.value) || '?'}`
  if (s.kind === 'roll') return `roll:${s.value || '?'}`
  return namesByGid.get(t)?.name ?? t
}

function opValueBit(eff: GraphEffect): string {
  if (eff.op === 'add') {
    const byL = (eff.byLevel ?? []).some((x, i) => i > 0 && String(x).trim())
    return byL ? 'by level' : eff.value ? `+${eff.value}` : ''
  }
  if (eff.op === 'crit') return eff.threshold ? `on ${eff.threshold}+` : ''
  if (eff.op === 'note') { const t = eff.text ?? ''; return t.length > 46 ? `${t.slice(0, 46)}…` : t }
  return ''
}

function EffectRow({ eff, namesByGid, onOpen, onDelete }: {
  eff: GraphEffect; namesByGid: Map<string, { name: string }>
  onOpen: () => void; onDelete: () => void
}) {
  const cfg = OPS[eff.op]
  const badLab = !eff.label?.trim()
  const ts = eff.target ?? []
  const val = opValueBit(eff)
  const flags = [eff.when?.trim() && 'when', eff.ask?.trim() && 'ask'].filter(Boolean)
  return (
    <div className={cx(styles.efrow, IS_DAMAGE_FLAG(eff.op) && styles.flag, IS_ACTIVATION(eff.op) && styles.act, badLab && styles.bad)}
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}>
      <i className={cx('fa-solid fa-chevron-right', styles.ch)} />
      <span className={styles.efGlFrame}><i className={`fa-solid ${cfg?.icon ?? 'fa-circle'}`} /></span>
      <span className={styles.op}>{cfg?.label ?? eff.op}</span>
      <span className={cx(styles.lab, badLab && styles.miss)}>{badLab ? 'no label' : eff.label}</span>
      <span className={styles.sum}>
        {val && <><span className={styles.v}>{val}</span><span className={styles.sep}>·</span></>}
        <span className={cx(styles.tg, !ts.length && styles.own)}>
          {ts.length ? ts.map(t => selLabel(t, namesByGid)).join(eff.match === 'and' ? ' + ' : ' | ') : 'own roll'}
        </span>
        {flags.length > 0 && <><span className={styles.sep}>·</span><span className={styles.fl}>{flags.join(' + ')}</span></>}
      </span>
      <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
        onClick={e => { e.stopPropagation(); onDelete() }} title="Delete node" />
    </div>
  )
}
/* ---------- expanded effect card ---------- */

function EffectCard({ eff, ei, graph, vars, setEffect, setGraph, onVarsChange, nodes, namesByGid, setPop, onClose }: {
  eff: GraphEffect; ei: number
  /** The whole list, for sibling lookups — an `ask` is a grouping key. */
  graph: GraphEffect[]
  vars: VarDef[]
  setEffect: (i: number, p: Partial<GraphEffect>) => void
  setGraph: (next: GraphEffect[]) => void
  onVarsChange?: (next: VarDef[]) => void
  nodes: AuthoredNode[]; namesByGid: Map<string, { name: string; kind: string }>
  setPop: (p: PopKind) => void; onClose: () => void
}) {
  const cfg = OPS[eff.op]
  // Every OTHER ask authored on this node — the set this effect could join.
  const siblingAsks = [...new Set(
    graph.filter(x => x.id !== eff.id).map(x => x.ask?.trim()).filter((a): a is string => !!a),
  )]
  const badLab = !eff.label?.trim()
  const targets = eff.target ?? []
  const isFlag = IS_DAMAGE_FLAG(eff.op)
  const isAct = IS_ACTIVATION(eff.op)

  const counts = targets.map(t => (t.startsWith('roll:') ? Infinity : matchCount(t, nodes)))
  const thingsAndTags = counts.filter(n => Number.isFinite(n)).reduce((a: number, b) => a + b, 0)
  const rollCount = counts.filter(n => !Number.isFinite(n)).length
  const summary = !targets.length
    ? { own: true, text: 'this node’s own roll' }
    : {
        own: false,
        zero: thingsAndTags === 0 && rollCount === 0,
        text: [
          (thingsAndTags || !rollCount) ? `targets ${thingsAndTags} thing${thingsAndTags === 1 ? '' : 's'}` : '',
          rollCount ? `${rollCount} roll kind${rollCount === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' · '),
      }

  const setTarget = (ti: number, v: string) =>
    setEffect(ei, { target: targets.map((t, j) => (j === ti ? v : t)) })

  return (
    <div className={cx(styles.card, badLab && styles.err)}>
      <div className={styles.cardHead}>
        <i className={cx('fa-solid fa-chevron-down', styles.ch)} onClick={onClose}
          style={{ fontSize: 9, color: 'var(--amber)', cursor: 'pointer' }} />
        <span className={styles.cix}>NODE {String(ei + 1).padStart(2, '0')}</span>
        <select className={styles.opSel} value={eff.op} onChange={e => {
          // Switching the op should feel like changing a verb, not losing your
          // work: targets, label and both gates survive, and so does any field
          // the new op shares with the old one.
          const next = e.target.value as GraphOp
          const fresh = blankEffect(next)
          const keep: GraphEffect = { ...fresh, id: eff.id, target: eff.target, label: eff.label, when: eff.when, ask: eff.ask }
          for (const fd of OPS[next].fields) {
            const cur = (eff as unknown as Record<string, unknown>)[fd.key]
            if (cur !== undefined) (keep as unknown as Record<string, unknown>)[fd.key] = cur
          }
          setGraph(graph.map((g, j) => (j === ei ? keep : g)))
        }}>
          {OP_ORDER.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className={cx(styles.grpPill, isFlag && styles.flag, isAct && styles.act)}>
          <i className={`fa-solid ${isAct ? 'fa-bolt' : isFlag ? 'fa-shield-halved' : 'fa-infinity'}`} />
          {isAct ? 'Activation outcome' : isFlag ? 'Damage flag' : 'Passive contribution'}
        </span>
        <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
          onClick={() => { setGraph(graph.filter((_, j) => j !== ei)); onClose() }} />
      </div>
      <div className={styles.opBlurb}>{cfg?.blurb}</div>

      {/* targets — activations have none: they write a variable on this
          character rather than reaching out at another node. */}
      {isAct ? (
        <div className={styles.tgtOwn}>
          <i className="fa-solid fa-bolt" />
          <span>No target — this writes one of this feature’s own variables when the player presses Use.</span>
        </div>
      ) : (<>
      <div className={styles.subsec}>
        <span className={styles.sl}>Target</span>
        {/* How the list combines. Only meaningful once there are two, so it
            appears then — a toggle over one selector is noise, and the audit
            says so if you set it anyway. */}
        {targets.length > 1 && (
          <span className={styles.matchSeg}>
            <button type="button" className={cx(eff.match !== 'and' && styles.on)}
              onClick={() => setEffect(ei, { match: undefined })}
              title="Any one of these targets is enough">or</button>
            <button type="button" className={cx(eff.match === 'and' && styles.on)}
              onClick={() => setEffect(ei, { match: 'and' })}
              title="Every target must hold of the same roll — e.g. a fire weapon, on its damage roll">and</button>
          </span>
        )}
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'target' })}>?</span>
        <span className={cx(styles.cnt, summary.own && styles.own, !summary.own && summary.zero && styles.zero)}>
          <i className={`fa-solid ${summary.own ? 'fa-arrow-turn-down' : 'fa-crosshairs'}`} />{summary.text}
        </span>
      </div>
      {targets.map((t, ti) => {
        const s = splitSel(t)
        const n = counts[ti]
        return (
          <div key={ti} className={cx(styles.tgt, s.kind === 'thing' ? styles.kThing : s.kind === 'tag' ? styles.kTag : styles.kRoll)}>
            <span className={cx(styles.seg, styles.tiny, styles.kseg)}>
              {KINDS.map(K => (
                <button key={K.k} type="button" title={K.l}
                  className={cx(s.kind === K.k && styles.on, s.kind === K.k && styles[K.k])}
                  onClick={() => { if (s.kind !== K.k) setTarget(ti, joinSel(K.k, '')) }}>
                  <i className={`fa-solid ${K.ic}`} /> {K.l}
                </button>
              ))}
            </span>
            <span className={styles.tval}>
              {s.kind === 'thing' && (
                <button type="button" className={styles.pickbtn} style={{ flex: 1 }}
                  onClick={() => setPop({ k: 'thing', ei, ti })}>
                  <span className={styles.in} style={{ margin: 0, display: 'block', textAlign: 'left' }}>
                    {namesByGid.get(t)?.name ?? (t || 'Search the catalog…')}
                  </span>
                </button>
              )}
              {s.kind === 'tag' && (<>
                <span className={styles.pfx}>tag:</span>
                <input value={s.value} placeholder="fire_damage" spellCheck={false}
                  onChange={e => setTarget(ti, joinSel('tag', e.target.value))} />
              </>)}
              {s.kind === 'roll' && (<>
                <span className={styles.pfx}>roll:</span>
                <select value={s.value} onChange={e => setTarget(ti, joinSel('roll', e.target.value))}>
                  <option value="">— pick —</option>
                  {ROLL_SELECTORS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </>)}
            </span>
            <span className={cx(styles.n, n === 0 && styles.zero)}>
              {Number.isFinite(n) ? `${n} match${n === 1 ? '' : 'es'}` : 'always live'}
            </span>
            <button type="button" className={cx('fa-solid fa-xmark', styles.dx)}
              onClick={() => setEffect(ei, { target: targets.filter((_, j) => j !== ti) })} />
          </div>
        )
      })}
      {!targets.length && (
        <div className={styles.tgtOwn}>
          <i className="fa-solid fa-arrow-turn-down" />
          <span>No selectors — this node applies to its own roll. Add one to reach out at other things. Multiple selectors are OR.</span>
        </div>
      )}
      <button type="button" className={styles.addmini} onClick={() => setEffect(ei, { target: [...targets, 'tag:'] })}>
        <i className="fa-solid fa-plus" /> Add selector
      </button>
      </>)}

      {/* schema-driven parameters */}
      <div className={styles.subsec}><span className={styles.sl}>{cfg?.label} parameters</span></div>
      {cfg?.fields.length ? (
        <>
          {cfg.fields.filter(f => !f.wide).length > 0 && (
            <div className={cfg.fields.filter(f => !f.wide).length > 1 ? styles.grid2 : undefined}>
              {cfg.fields.filter(f => !f.wide).map(fd => (
                <div key={fd.key}><SchemaField fd={fd} eff={eff} ei={ei} setEffect={setEffect} vars={vars} /></div>
              ))}
            </div>
          )}
          {cfg.fields.filter(f => f.wide).map(fd => (
            <SchemaField key={fd.key} fd={fd} eff={eff} ei={ei} setEffect={setEffect} vars={vars} />
          ))}
        </>
      ) : (
        <div className={styles.blkOptin} style={{ marginBottom: 12 }}>
          <i className="fa-solid fa-minus" /><span>None — this op is fully described by its target list.</span>
        </div>
      )}

      {/* statement */}
      <div className={styles.subsec}><span className={styles.sl}>Statement</span></div>
      <span className={styles.fieldLab}>Label<span className={styles.req}>*</span><span className={styles.ty}>text</span></span>
      <div className={styles.hlp}>
        <span className={styles.d}>What the player sees for this node in a roll breakdown. Required on every effect.</span>
        <span className={styles.e}><b>e.g.</b>Savage damage bonus</span>
      </div>
      <input className={cx(styles.in, badLab && styles.bad)} value={eff.label ?? ''}
        placeholder="required — shown in the roll breakdown"
        onChange={e => setEffect(ei, { label: e.target.value })} />

      <div className={cx(styles.wa, styles.when)}>
        <span className={styles.tagl}>
          <span className={styles.k}><i className="fa-solid fa-code-branch" /> when</span>
          <span className={styles.who}>formula · the app decides</span>
        </span>
        <input value={eff.when ?? ''} placeholder="hp < hpMax / 2" spellCheck={false}
          onChange={e => setEffect(ei, { when: e.target.value || undefined })} />
        {/* A STANCE, not a formula. "While the hood is up" is not computable from
            character state — only the player knows — and the shape that expresses
            it is a stored bool they can flip. That was already possible and
            nothing said so, which is how a prose condition ended up with no way
            to author it at all. One press declares the variable and points `when`
            at it; the variable then shows in the vars block like any other, so
            there is no hidden state. */}
        {onVarsChange && !eff.when?.trim() && (
          <button type="button" className={styles.whenTog} title="Declare a stored toggle the player flips"
            onClick={() => {
              const name = freeName(vars, eff.label)
              onVarsChange([...vars, {
                name, kind: 'stored', type: 'bool', scope: 'player',
                initial: false, label: eff.label?.trim() || undefined,
              }])
              setEffect(ei, { when: name })
            }}>
            <i className="fa-solid fa-toggle-on" />player toggle
          </button>
        )}
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'when' })}>?</span>
      </div>
      <div className={cx(styles.wa, styles.ask)}>
        <span className={styles.tagl}>
          <span className={styles.k}><i className="fa-regular fa-square-check" /> ask</span>
          <span className={styles.who}>prose · a human decides</span>
        </span>
        <span className={styles.askbox}><i className="fa-regular fa-square" /></span>
        {/* The ask is also the GROUPING KEY — effects sharing one become a single
            checkbox (§32). Retyping a sentence by hand to match is how you end up
            with two toggles for one decision, so the asks already on this node
            are offered rather than remembered. */}
        <input value={eff.ask ?? ''} placeholder="No checkbox — applies on its own"
          list={`asks-${eff.id}`}
          onChange={e => setEffect(ei, { ask: e.target.value || undefined })} />
        <datalist id={`asks-${eff.id}`}>
          {siblingAsks.map(a => <option key={a} value={a} />)}
        </datalist>
        <span className={styles.qm} onClick={() => setPop({ k: 'help', which: 'ask' })}>?</span>
      </div>
    </div>
  )
}
/* ---------- the closed set of field types ---------- */

function SchemaField({ fd, eff, ei, setEffect, vars }: {
  fd: OpField; eff: GraphEffect; ei: number
  setEffect: (i: number, p: Partial<GraphEffect>) => void; vars: VarDef[]
}) {
  const raw = (eff as unknown as Record<string, unknown>)[fd.key]
  const put = (v: unknown) => setEffect(ei, { [fd.key]: v } as Partial<GraphEffect>)
  const textRef = useAutoGrow(typeof raw === 'string' ? raw : '')

  const label = (
    <>
      <span className={styles.fieldLab}>
        {fd.label}{fd.required && <span className={styles.req}>*</span>}
        <span className={styles.ty}>{fd.type}</span>
      </span>
      <div className={styles.hlp}>
        <span className={styles.d}>{fd.desc}</span>
        {fd.example && <span className={styles.e}><b>e.g.</b>{fd.example}</span>}
      </div>
    </>
  )

  if (fd.type === 'formula') {
    return <>{label}<input className={styles.in} value={String(raw ?? '')} placeholder={fd.example}
      spellCheck={false} onChange={e => put(e.target.value)} /></>
  }
  if (fd.type === 'text') {
    return <>{label}<textarea ref={textRef} className={cx(styles.prose, styles.short)} value={String(raw ?? '')}
      placeholder={fd.example} onChange={e => put(e.target.value)} /></>
  }
  if (fd.type === 'enum') {
    // An OPTIONAL enum needs a way back to unset, or the first option becomes a
    // value the author never chose. Stored as absent, not as an empty string.
    return <>{label}<select className={styles.in} value={String(raw ?? '')}
      onChange={e => put(e.target.value || undefined)}>
      {!fd.required && <option value="">—</option>}
      {(fd.options ?? []).map(o => <option key={o}>{o}</option>)}
    </select></>
  }
  if (fd.type === 'boolean') {
    return <>{label}<div className={styles.in} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
      onClick={() => put(!raw)}>
      <i className={`fa-solid ${raw ? 'fa-square-check' : 'fa-square'}`} />{fd.label}
    </div></>
  }
  if (fd.type === 'reference' && fd.ref !== 'variable') return null
  if (fd.type === 'reference' && fd.ref === 'variable') {
    const known = vars.some(v => v.name === raw)
    const stale = !!raw && !known
    return <>{label}<select className={cx(styles.in, stale && styles.bad)} value={String(raw ?? '')}
      onChange={e => put(e.target.value)}>
      <option value="">— pick a variable —</option>
      {vars.filter(v => v.name).map(v => <option key={v.name} value={v.name}>{v.name}{v.label ? ` · ${v.label}` : ''}</option>)}
      {stale && <option value={String(raw)}>{String(raw)} · UNDECLARED</option>}
    </select></>
  }
  if (fd.type === 'array') {
    const arr = Array.isArray(raw) ? (raw as string[]) : blankArr()
    const filled = arr.filter((x, i) => i > 0 && String(x).trim()).length
    return <>{label}
      <div className={styles.arr}>
        <div className={styles.arrGrid}>
          {arr.map((x, i) => (
            <div key={i} className={cx(styles.arrSlot, i === 0 && styles.zero)}>
              <span className={styles.ix}>{i}</span>
              {i === 0
                ? <input disabled value="—" />
                : <input value={x} onChange={e => put(arr.map((y, j) => (j === i ? e.target.value : y)))} />}
            </div>
          ))}
        </div>
        <div className={styles.arrNote}>
          <i className="fa-solid fa-hashtag" />21 slots · <b>index 0 unused</b> · levels 1–20 · {filled} filled
          {filled > 0 && ' · overrides Amount'}
        </div>
      </div>
    </>
  }
  // `selector` is handled by the target list above — no op declares one as a
  // parameter yet. Rendering nothing beats rendering a control that writes
  // somewhere the engine does not read.
  return null
}



/* ---------- variables ---------- */

/** The state a node carries, and who may write it.
 *
 *  Extracted with the effect block for the same reason: a spell declaring
 *  `shardsHeld` is the same declaration a feature makes, and §31's player/DM
 *  split is a property of the variable, not of what declared it. */
export function VarsBlock({ vars, onChange }: {
  vars: VarDef[]
  onChange: (next: VarDef[]) => void
}) {
  const setVar = (i: number, p: Partial<VarDef>) =>
    onChange(vars.map((v, j) => (j === i ? { ...v, ...p } : v)))

  return (
    <>
      <div className={styles.blkOptin}>
        <i className="fa-solid fa-circle-info" />
        <span>Only needed when an effect must read or write state. Stored variables are saved on the character; derived ones are recomputed from a formula on every read.</span>
      </div>
      {vars.map((v, vi) => {
        const stored = v.kind !== 'derived'
        const dmOnly = v.scope === 'dm'
        return (
          <div key={vi} className={cx(styles.card, !v.name?.trim() && styles.err)}>
            <div className={styles.cardHead}>
              <input className={styles.vname} value={v.name ?? ''} placeholder="identifier" spellCheck={false}
                onChange={e => setVar(vi, { name: e.target.value })} />
              <span className={styles.seg}>
                <button type="button" className={cx(stored && styles.on)}
                  onClick={() => setVar(vi, { kind: 'stored', formula: undefined, type: v.type ?? 'num' })}>
                  <i className="fa-solid fa-database" /> Stored
                </button>
                <button type="button" className={cx(!stored && styles.on)}
                  onClick={() => setVar(vi, { kind: 'derived', type: undefined, initial: undefined, scope: undefined })}>
                  <i className="fa-solid fa-function" /> Derived
                </button>
              </span>
              <button type="button" className={cx('fa-solid fa-trash', styles.dx)}
                onClick={() => onChange(vars.filter((_, j) => j !== vi))} />
            </div>
            {stored ? (
              <>
                <div className={styles.kindnote}>Stored — written on the character sheet and read back. Needs a type.</div>
                <div className={styles.grid3}>
                  <div>
                    <span className={styles.fieldLab}>Type<span className={styles.req}>*</span><span className={styles.ty}>enum</span></span>
                    <select className={cx(styles.in, !v.type && styles.bad)} value={v.type ?? ''}
                      onChange={e => setVar(vi, { type: (e.target.value || undefined) as 'num' | 'bool' | undefined })}>
                      <option value="">— required —</option>
                      <option value="num">Number</option>
                      <option value="bool">Boolean</option>
                    </select>
                  </div>
                  <div>
                    <span className={styles.fieldLab}>Initial value</span>
                    <input className={styles.in} value={v.initial === undefined ? '' : String(v.initial)}
                      placeholder="optional — e.g. 0"
                      onChange={e => {
                        const raw = e.target.value.trim()
                        const initial = raw === '' ? undefined
                          : v.type === 'bool' ? raw === 'true'
                          : Number.isFinite(Number(raw)) ? Number(raw) : undefined
                        setVar(vi, { initial })
                      }} />
                  </div>
                  <div>
                    <span className={styles.fieldLab}>Resets on<span className={styles.ty}>enum</span></span>
                    <select className={styles.in} value={v.resetOn ?? ''}
                      onChange={e => setVar(vi, { resetOn: (e.target.value || undefined) as 'short' | 'long' | undefined })}>
                      <option value="">Never</option>
                      <option value="short">Short rest</option>
                      <option value="long">Long rest</option>
                    </select>
                  </div>
                </div>
                <div className={styles.kindnote} style={{ margin: '-6px 0 11px' }}>
                  Resets return the variable to its initial value on that rest — the same
                  rule a feature’s uses follow. A long rest includes the short-rest ones.
                  <b> Never</b> means only an activation or the player changes it.
                </div>
                <div className={cx(styles.perm, !dmOnly && styles.player)}>
                  <i className={`fa-solid ${dmOnly ? 'fa-lock' : 'fa-user-pen'}`} />
                  <span>
                    <span className={styles.pt}>{dmOnly ? 'DM-only' : 'Player-writable'}</span><br />
                    <span className={styles.ps}>{dmOnly
                      ? 'permission · hidden from the player sheet, only this console writes it'
                      : 'permission · the player can change this from their sheet'}</span>
                  </span>
                  <span className={cx(styles.seg, styles.tiny)}>
                    <button type="button" className={cx(!dmOnly && styles.on, !dmOnly && styles.cy)} onClick={() => setVar(vi, { scope: 'player' })}>Player</button>
                    <button type="button" className={cx(dmOnly && styles.on)} onClick={() => setVar(vi, { scope: 'dm' })}><i className="fa-solid fa-lock" /> DM-only</button>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className={styles.kindnote}>Derived — never stored. Its type comes from the formula, so there is no type to pick.</div>
                <span className={styles.fieldLab}>Formula<span className={styles.req}>*</span></span>
                <input className={cx(styles.in, !v.formula?.trim() && styles.bad)} value={v.formula ?? ''} spellCheck={false}
                  placeholder="level / 4 + 1" onChange={e => setVar(vi, { formula: e.target.value })} />
              </>
            )}
            <span className={styles.fieldLab}>Display label</span>
            <input className={styles.in} value={v.label ?? ''} style={{ marginBottom: 2 }}
              placeholder="optional — what the sheet calls it" onChange={e => setVar(vi, { label: e.target.value })} />
          </div>
        )
      })}
      <button type="button" className={styles.addbtn}
        onClick={() => onChange([...vars, { name: '', kind: 'stored', type: 'num', scope: 'player' }])}>
        <i className="fa-solid fa-plus" /> Add variable
      </button>

    </>
  )
}

/* ---------- tags ---------- */

/** Free-text targeting tags, with autocomplete over what is already in use.
 *
 *  A tag's whole purpose is to reach ACROSS catalogs — `tag:fire` should match a
 *  spell, a weapon and a shard node alike — so every node kind that can be
 *  targeted needs this control. Until slice 6c only the feature editor had it,
 *  which meant `tag:` matched features and nothing else while `Equipment` and
 *  `Spellbook` were both dutifully passing tags into every resolve.
 *
 *  Normalised on save (lib/graph.ts normalizeTag), because free text fragments
 *  silently: `radiant` / `Radiant` / `radient` all look right and match nothing. */
export function TagsBlock({ tags, tagUse, onChange }: {
  tags: string[]
  /** Every tag in use anywhere, with a count — from useCatalogNodes. */
  tagUse: Map<string, number>
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [acOpen, setAcOpen] = useState(false)

  const add = (raw: string) => {
    const t = normalizeTag(raw)
    if (!t) return
    if (!tags.includes(t)) onChange([...tags, t])
    setInput(''); setAcOpen(false)
  }
  const hits = [...tagUse.keys()]
    .filter(t => t.includes(normalizeTag(input)) && !tags.includes(t))
    .slice(0, 8)

  return (
    <>
      <div className={styles.chips}>
        {tags.length
          ? tags.map((t, i) => (
            <span key={t} className={styles.chip}>{t}
              <i className={cx('fa-solid fa-xmark', styles.x)}
                onClick={() => onChange(tags.filter((_, j) => j !== i))} />
            </span>
          ))
          : <span className={cx(styles.chip, styles.empty)}>no tags</span>}
      </div>
      <div className={styles.tagbox}>
        <input className={styles.in} value={input} placeholder="Add a tag — lowercased on save"
          autoComplete="off" spellCheck={false}
          onChange={e => { setInput(e.target.value); setAcOpen(true) }}
          onBlur={() => setTimeout(() => setAcOpen(false), 140)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input) }
            if (e.key === 'Escape') setAcOpen(false)
          }} />
        {acOpen && input.trim() && hits.length > 0 && (
          <div className={styles.ac}>
            <div className={styles.hd}>In use already</div>
            {hits.map(t => (
              <button key={t} type="button" onMouseDown={e => e.preventDefault()} onClick={() => add(t)}>
                <i className="fa-solid fa-tag" style={{ fontSize: 8, color: 'var(--amber-dim)' }} />{t}
                <span className={styles.n}>{tagUse.get(t)} in use</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
