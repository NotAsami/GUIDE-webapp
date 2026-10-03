/**
 * The Feature Editor's GRAPH and SCRIPT views, plus the graph inspector.
 * Ported from guide-hud/project/G.U.I.D.E. Feature Graph.html + feature-graph.js.
 *
 * Everything drawn here is lib/featureGraph.ts `project()` of the draft the form
 * edits — the canvas owns nothing but `layout`. This slice DRAWS: selecting a
 * node opens the same editors the form uses; dragging, wiring and adding nodes
 * arrive with slice 3, which is why nothing here writes positions yet.
 *
 * Heights are computed, not measured: every port and wire position is a
 * function of the node's kind and row count, so the SVG never waits on layout.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { CatalogFeatureData, GraphEffect, VarDef } from '../lib/database.types'
import {
  addNode, autoLayout, connectTarget, detailLines, editGroup, makeGroup, setPositions, ungroup, ovFit, zoomLevel, type ZoomLevel, disconnectTarget, editGate, editedGateKey, project, regate, removeNode, retarget,
  setMatch, targetRefusal,
  type AddKind, type FeatureGraph as Graph, type GEdge, type GNode, type WireType,
} from '../lib/featureGraph'
import { ROLL_SELECTORS, blankEffect } from '../lib/opSchema'
import { classHas, grantLevels, previewBool, progressionScope, progressionState } from '../lib/previewScope'
import { evalExpr, interpolate } from '../lib/expr'
import type { FeatureGrantRef } from '../lib/database.types'
import { colour, serialize } from '../lib/featureScript'
import { asKey, matchCount, normalizeTag, probeScope, type AuditItem, type AuthoredNode } from '../lib/graph'
import { OPS } from '../lib/opSchema'
import { Inline } from '../lib/markdown'
import { usePanZoom } from '../lib/usePanZoom'
import { EffectEditor, VarCard } from './GraphEffects'
import { Icon } from './Icon'
import styles from './featureGraph.module.css'

const cx = (...v: (string | false | undefined | null)[]) => v.filter(Boolean).join(' ')

/* ---------- geometry ---------- */

const HDR = 30
const ROW = 22
type Kind = GNode['kind']
const WIDTH: Record<Kind, number> = {
  press: 230, ask: 250, cond: 240, outcome: 240, contrib: 290, sheet: 230,
  var: 250, ext: 290, ctx: 200, picks: 230, dest: 220,
}
const DEST_H = 66

/** `{…}` spans shortened — the editor has no character to evaluate them against. */
const shortT = (s: string) => s.replace(/\{[^}]*\}/g, '{…}')

type NodeView = { n: GNode; x: number; y: number; w: number; h: number; base: number; body: number; ins: string[]; out: WireType | null; det: string[] }

function bodyH(n: GNode): number {
  switch (n.kind) {
    case 'contrib': return 52 + (n.eff.ask ? 16 : 0)
    case 'ask': return 62
    case 'picks': return 46
    case 'cond': return 30
    case 'press': case 'ctx': return 22
    default: return 26
  }
}

const DET_LINE = 15

/** Placed and sized nodes. Auto-placed nodes space by the height they are
 *  DRAWN at, so Detail's taller nodes never overlap; saved positions stay put. */
function views(g: Graph, saved: CatalogFeatureData['layout'], f: CatalogFeatureData, level: ZoomLevel): Map<string, NodeView> {
  const ins = new Map<string, string[]>()
  const out = new Map<string, WireType>()
  for (const e of g.edges) {
    if (e.kind !== 'data') continue
    const l = ins.get(e.to) ?? []
    if (!l.includes(e.ident)) ins.set(e.to, [...l, e.ident])
    out.set(e.from, e.type)
  }
  const outOf = (n: GNode): WireType | null =>
    n.kind === 'var' ? out.get(n.key) ?? (n.def.type === 'bool' ? 'b' : 'n')
      : n.kind === 'ext' ? out.get(n.key) ?? 'n'
      : n.kind === 'ctx' ? 'x' : null
  type Size = { base: number; body: number; h: number; ins: string[]; out: WireType | null; det: string[] }
  const size = new Map<string, Size>(g.nodes.map((n): [string, Size] => {
    if (n.kind === 'dest') return [n.key, { base: 0, body: 0, h: DEST_H, ins: [], out: null, det: [] }]
    const i = ins.get(n.key) ?? [], o = outOf(n), rows = Math.max(i.length, o ? 1 : 0)
    const det = level === 'detail' ? detailLines(n, f, g) : []
    const extra = det.length ? det.length * DET_LINE + 2 : 0
    return [n.key, { base: bodyH(n), body: bodyH(n) + extra, h: HDR + bodyH(n) + extra + rows * ROW + 8, ins: i, out: o, det }]
  }))
  const pos = autoLayout(g, saved?.pos, k => size.get(k)?.h ?? 100)
  return new Map(g.nodes.map(n => {
    const s = size.get(n.key)!
    return [n.key, { n, x: pos[n.key][0], y: pos[n.key][1], w: WIDTH[n.kind], base: s.base, body: s.body, h: s.h, ins: s.ins, out: s.out, det: s.det }]
  }))
}

/** The mockup's wire curve: horizontal tangents, a loop-back when the target sits left. */
function curve(x1: number, y1: number, x2: number, y2: number) {
  const gx = x2 - x1, gy = Math.abs(y2 - y1)
  const dx = gx >= 0 ? Math.min(160, Math.max(gx * 0.5, Math.min(gy * 0.35, 60), 8)) : Math.max(60, -gx * 0.5 + gy * 0.25)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

const flowIn = (v: NodeView): [number, number] => [v.x, v.y + (v.n.kind === 'cond' ? v.h / 2 : 15)]
const flowOut = (v: NodeView): [number, number] => [v.x + v.w, v.y + v.h / 2]
const dataIn = (v: NodeView, ident: string): [number, number] => [v.x, v.y + HDR + v.body + Math.max(0, v.ins.indexOf(ident)) * ROW + 11]
const dataOut = (v: NodeView): [number, number] => [v.x + v.w, v.y + HDR + v.body + 11]

/* ---------- node content ---------- */

const ACT_LABEL: Record<string, string> = { action: 'Action', bonus: 'Bonus action', reaction: 'Reaction', free: 'Free action' }
const RESET_LABEL: Record<string, string> = { turn: 'start of turn', short: 'short rest', long: 'long rest' }

function effSummary(e: GraphEffect): ReactNode {
  switch (e.op) {
    case 'setVar': return <>{e.variable ?? '?'} ← {e.value}</>
    case 'addVar': return <>{e.variable ?? '?'} += {e.value}</>
    case 'setHp': return <>hp ← {e.value}</>
    case 'addUses': return <>uses {e.value}</>
    case 'addSlot': return <>slot {e.budget ? `budget ${e.budget}` : e.value}</>
    case 'grant': return <>grant {e.value}</>
    case 'boost': return <>{e.stat} +{e.value}</>
    case 'useability': return <>may use {e.ability}</>
    case 'note': return <>“<Inline text={e.text ?? ''} />”</>
    case 'crit': return <>crits on {e.threshold ?? e.value}</>
    case 'floor': return <>at least {e.minimum}</>
    case 'reroll': return <>reroll · {e.keep ?? 'new'}</>
    case 'adv': return <>advantage</>
    case 'dis': return <>disadvantage</>
    default: return <>{OPS[e.op]?.label ?? e.op}</>
  }
}

function head(n: GNode, f: CatalogFeatureData, namesByGid: Map<string, { name: string; kind: string }>): { icon: string; title: string; chip: string } {
  switch (n.kind) {
    case 'press': return { icon: 'fa-hand-pointer', title: `Press · ${f.name || 'this feature'}`, chip: 'press' }
    case 'ask': return { icon: 'fa-user', title: 'Ask', chip: 'ask' }
    case 'cond': return { icon: 'fa-code-branch', title: 'Condition', chip: 'when' }
    case 'outcome': case 'contrib': case 'sheet':
      return { icon: OPS[n.eff.op]?.icon ?? 'fa-cube', title: n.eff.label ?? '', chip: n.eff.op }
    case 'var': return {
      icon: n.def.uses ? 'fa-battery-half' : n.def.kind === 'derived' ? 'fa-square-root-variable' : 'fa-database',
      title: n.def.name, chip: n.def.uses ? 'use-counter' : n.def.kind,
    }
    case 'ext': return { icon: 'fa-link', title: n.ident, chip: 'external' }
    case 'ctx': return { icon: 'fa-dice-d20', title: `roll · ${n.ident}`, chip: 'roll ctx' }
    case 'picks': return { icon: 'fa-list-check', title: 'Picks', chip: 'feature' }
    case 'dest': return { icon: destKind(n.sel) === 'tag' ? 'fa-tags' : destKind(n.sel) === 'roll' ? 'fa-dice-d20' : 'fa-arrow-up-right-from-square', title: destLabel(n.sel, namesByGid), chip: destKind(n.sel) === 'tag' ? 'tag' : destKind(n.sel) === 'roll' ? 'roll kind' : 'reference' }
  }
}

const destKind = (sel: string) => (sel.startsWith('tag:') ? 'tag' : sel.startsWith('roll:') ? 'roll' : 'thing')
function destLabel(sel: string, namesByGid: Map<string, { name: string; kind: string }>) {
  const k = destKind(sel)
  return k === 'tag' ? sel.slice(4) : k === 'roll' ? sel.slice(5).replace('.', ' · ') : namesByGid.get(sel)?.name ?? sel
}

const EXT_NOTE = { 'has_*': 'true once the character has that feature', catalog: 'declared by another node in the catalog', engine: 'kept by the turn tracker' } as const

/* ---------- the canvas ---------- */

export type GraphProps = {
  d: CatalogFeatureData
  catalogTypes: Record<string, 'num' | 'bool'>
  nodes: AuthoredNode[]
  namesByGid: Map<string, { name: string; kind: string }>
  ready: boolean
  audit: AuditItem[]
  sel: string | null
  onSelect: (key: string | null) => void
  /** Bumps to pan the canvas onto `sel` (an audit jump). */
  focusTick: number
  /** Changes when the feature does, so the canvas re-fits. */
  fitKey: string
  onForm: () => void
  /** Room the floating inspector takes on the right, so the zoom buttons clear it. */
  rightInset?: number
  /** Every canvas edit, already applied — the host writes it through its draft. */
  onChange: (f: CatalogFeatureData) => void
  onToggleInsp?: () => void
  /** The multi-selection (two or more node keys), owned by the host so the inspector sees it. */
  multi: string[]
  onMulti: (keys: string[]) => void
  /** The class-progression lens: which class and level, and the data to decide it. */
  progression: {
    classes: { id: string; name: string; features: FeatureGrantRef[]; vars?: VarDef[] }[]
    names: Map<string, string>
    featureId: string | null
    pv: { cls: string; lv: number } | null
    onPv: (pv: { cls: string; lv: number } | null) => void
  }
}

/** What can be added, in the mockup's "Node kinds" order. */
export const ADD_KINDS: { k: AddKind; l: string; s: string; c: string; sw: string }[] = [
  { k: 'press', l: 'Event', s: 'the press · one per feature', c: 'var(--amber)', sw: 'event' },
  { k: 'cond', l: 'Condition', s: 'when · app decides', c: 'var(--beige)', sw: 'cond' },
  { k: 'ask', l: 'Ask', s: 'ask · a human decides', c: 'var(--cyan)', sw: 'ask' },
  { k: 'outcome', l: 'Activation outcome', s: 'writes on press', c: 'var(--text)', sw: 'action' },
  { k: 'contrib', l: 'Contribution', s: 'modifies a roll', c: 'var(--violet)', sw: 'contrib' },
  { k: 'sheet', l: 'Sheet rule', s: 'moves a sheet number', c: '#bfae80', sw: 'sheet' },
  { k: 'var', l: 'Variable', s: 'derived · a formula', c: 'var(--good)', sw: 'var' },
  { k: 'picks', l: 'Picks', s: 'take N of the offers', c: 'var(--amber)', sw: 'picks' },
]
/** The HTML drag type a Node-kinds row carries onto the canvas. */
export const KIND_DRAG = 'application/x-guide-node-kind'
const FLOW_CHILD: AddKind[] = ['outcome', 'cond', 'ask']

/** The mockup's "Node kinds" list — rows dragged onto the canvas. */
export function NodeKinds() {
  return (
    <div className={styles.kinds}>
      {ADD_KINDS.map(K => (
        <div key={K.k} className={styles.kindRow} draggable title={`${K.l} — ${K.s}`}
          style={{ ['--kc' as string]: K.c } as CSSProperties}
          onDragStart={e => { e.dataTransfer.setData(KIND_DRAG, K.k); e.dataTransfer.effectAllowed = 'copy' }}>
          <span className={cx(styles.sw, styles[`sw_${K.sw}`])} />{K.l}
        </div>
      ))}
    </div>
  )
}

type WireDrag = { mode: 'out' | 'lift' | 'at'; key: string; x: number; y: number; over: string | null; legal: Map<string, string | null> }

type SelKind = 'tag' | 'roll' | 'thing'
const SEL_KINDS: { k: SelKind; l: string; ic: string; s: string }[] = [
  { k: 'tag', l: 'Tag', ic: 'fa-tags', s: 'a set — everything carrying it' },
  { k: 'roll', l: 'Roll kind', ic: 'fa-dice-d20', s: 'every roll of one kind' },
  { k: 'thing', l: 'Thing', ic: 'fa-arrow-up-right-from-square', s: 'one catalog row' },
]

/** Pick a target for one or more rules. Every candidate is filtered by
 *  `targetRefusal` — the audit's own answer — so what is offered is exactly
 *  what would pass, for every rule it would be written to. */
export function TargetChooser({ f, srcs, cur, nodes, namesByGid, catalogTypes, onPick }: {
  f: CatalogFeatureData
  /** Rule keys the pick is written to (one for a new wire; all of a target's for a retarget). */
  srcs: string[]
  /** The selector being replaced, when retargeting. */
  cur?: string
  nodes: AuthoredNode[]
  namesByGid: Map<string, { name: string; kind: string }>
  catalogTypes: Record<string, 'num' | 'bool'>
  onPick: (sel: string) => void
}) {
  /* ONE AUDIT PER KIND, not per candidate. The target rules judge a selector by
     what it is — a tag, a roll kind, a feature/spell/item reference — never by
     its particular name, and every candidate here comes from the catalog, so
     none can be dangling. Auditing each of a thousand catalog rows (each audit
     scanning the catalog) froze the tab for most of a minute. */
  const verdicts = useMemo(() => new Map<string, boolean>(), [f, srcs.join(), nodes, catalogTypes]) // eslint-disable-line react-hooks/exhaustive-deps
  /* Already targeted by one of these rules: offering it again would be a no-op. */
  const have = useMemo(() => {
    const g = project(f, catalogTypes)
    return new Set(srcs.flatMap(k => {
      const n = g.nodes.find(x => x.key === k)
      return n && 'eff' in n ? (n.eff.target ?? []).map(asKey) : []
    }))
  }, [f, srcs.join(), catalogTypes]) // eslint-disable-line react-hooks/exhaustive-deps
  const legal = (c: string) => {
    if (have.has(asKey(c))) return false
    const rep = c.startsWith('roll:') ? c : c.startsWith('tag:') ? 'tag:' : c.slice(0, c.indexOf(':') + 1)
    let ok = verdicts.get(rep)
    if (ok === undefined) {
      ok = srcs.every(s => targetRefusal(f, s, c, nodes, catalogTypes) === null)
      verdicts.set(rep, ok)
    }
    return ok
  }
  const pool = useMemo(() => ({
    tag: [...new Set(nodes.flatMap(n => (n.tags ?? []).map(t => `tag:${normalizeTag(t)}`)))].sort(),
    roll: ROLL_SELECTORS.map(r => `roll:${r}`),
    thing: [...namesByGid.keys()],
  }), [nodes, namesByGid])
  const legalPool = useMemo(() => ({
    tag: pool.tag.filter(legal), roll: pool.roll.filter(legal), thing: pool.thing.filter(legal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pool, f, srcs.join()])
  const open = SEL_KINDS.filter(K => legalPool[K.k].length || (K.k === 'tag' && legal('tag:new_tag')))
  const [kind, setKind] = useState<SelKind | null>(cur ? destKind(cur) : open.length === 1 ? open[0].k : null)
  const [q, setQ] = useState('')
  const lab = (c: string) => (destKind(c) === 'thing' ? namesByGid.get(c)?.name ?? c : c.slice(c.indexOf(':') + 1))
  if (!kind) return (
    <div className={styles.chooser}>
      {SEL_KINDS.map(K => {
        const ok = open.some(o => o.k === K.k)
        return <button key={K.k} type="button" className={styles.qaI} disabled={!ok} onClick={() => setKind(K.k)}>
          <Icon name={K.ic} />{K.l}<span className={styles.s}>{ok ? K.s : 'not for this rule'}</span>
        </button>
      })}
    </div>
  )
  const needle = q.trim().toLowerCase()
  let items = legalPool[kind].filter(c => !needle || c.toLowerCase().includes(needle) || lab(c).toLowerCase().includes(needle))
  const typed = kind === 'tag' && needle ? `tag:${normalizeTag(needle)}` : null
  if (typed && !pool.tag.includes(typed) && legal(typed)) items = [typed, ...items]
  return (
    <div className={styles.chooser}>
      <input className={styles.gateIn} autoFocus value={q} onChange={e => setQ(e.target.value)} spellCheck={false}
        placeholder={kind === 'tag' ? 'Search, or type a new tag…' : kind === 'roll' ? 'Search roll kinds…' : 'Search the catalog…'}
        onKeyDown={e => { if (e.key === 'Enter' && items[0]) onPick(items[0]) }} />
      <div className={styles.chList}>
        {items.slice(0, 60).map(c => (
          <button key={c} type="button" className={cx(styles.qaI, c === cur && styles.on)} disabled={c === cur} onClick={() => onPick(c)}>
            {lab(c)}<span className={styles.s}>{c === cur ? 'current' : kind === 'tag' && !pool.tag.includes(c) ? 'new tag · 0 things' : kind === 'tag' ? `${matchCount(c, nodes)} things` : kind === 'thing' ? namesByGid.get(c)?.kind : ''}</span>
          </button>
        ))}
        {!items.length && <div className={styles.chNone}>Nothing legal matches.</div>}
      </div>
    </div>
  )
}

export function FeatureGraph({ d, catalogTypes, nodes, namesByGid, ready, audit, sel: selProp, onSelect, focusTick, fitKey, onForm, rightInset = 10, onChange, onToggleInsp, multi, onMulti, progression }: GraphProps) {
  const pz = usePanZoom({ skip: t => !!t.closest('[data-node]') })
  const dRef = useRef(d)
  dRef.current = d
  /* A node being dragged is drawn at its live position; the layout is written
     once, on release, so a drag is one edit rather than sixty. */
  const [moving, setMoving] = useState<Record<string, [number, number]> | null>(null)
  /** Shift-drag rectangle, in world coordinates. */
  const [marq, setMarq] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [wire, setWire] = useState<WireDrag | null>(null)
  const [quick, setQuick] = useState<{ sx: number; sy: number; wx: number; wy: number; src?: string } | null>(null)
  /** An applies-to wire dropped on open canvas: choose what it points at. */
  const [pick, setPick] = useState<{ sx: number; sy: number; key: string } | null>(null)
  const [notice, setNotice] = useState<{ text: string; x?: number; y?: number } | null>(null)
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2200); return () => clearTimeout(t) }, [notice])

  const layout = useMemo(() => (moving ? { ...d.layout, pos: { ...d.layout?.pos, ...moving } } : d.layout), [d.layout, moving])
  const g = useMemo(() => project(d, catalogTypes), [d, catalogTypes])
  const zl = zoomLevel(pz.view.z)
  const vs = useMemo(() => views(g, layout, d, zl), [g, layout, d, zl])
  const vsRef = useRef(vs)
  vsRef.current = vs
  /* A selection whose node is gone (a pending gate that just turned real, a
     deleted rule) is no selection — otherwise every wire dims for nothing. */
  const groups = d.layout?.groups ?? []
  const sel = selProp && (vs.has(selProp) || selProp.startsWith('w:') || (selProp.startsWith('g:') && groups[+selProp.slice(2)])) ? selProp : null
  const selGroup = sel?.startsWith('g:') ? +sel.slice(2) : null

  /* CLASS PROGRESSION (lib/previewScope). Decides level and that class's grants,
     nothing else; a contribution whose when is false there is shown off. */
  const { pv, classes, names } = progression
  const pvCls = pv ? classes.find(c => c.id === pv.cls) ?? null : null
  const pvScope = useMemo(() => (pvCls && pv
    ? progressionScope(pv.lv, classHas(pvCls.features, names, pv.lv), [...(d.vars ?? []), ...(pvCls.vars ?? [])])
    : null), [pvCls, pv, names, d.vars])
  const offKeys = useMemo(() => {
    const out = new Set<string>()
    if (!pvScope) return out
    const isBool = previewBool(probeScope(d.vars ?? [], undefined, catalogTypes))
    for (const n of g.nodes) if (n.kind === 'contrib' && progressionState(n.eff, pvScope, isBool) === 'off') out.add(n.key)
    for (const n of g.nodes) {
      if (n.kind !== 'dest') continue
      const srcs = g.edges.filter(e => e.kind === 'target' && e.to === n.key).map(e => e.from)
      if (srcs.length && srcs.every(k => out.has(k))) out.add(n.key)
    }
    return out
  }, [pvScope, g, catalogTypes, d.vars])
  const offWire = (e: { from: string; to: string }) => offKeys.has(e.from) || offKeys.has(e.to)
  /** A label's {…} resolved where the preview decides it; the rest stays literal. */
  const titleOf = (t: string) => shortT(pvScope ? interpolate(t, pvScope).text : t)
  const selWire = sel?.startsWith('w:') ? { key: sel.slice(2, sel.indexOf('|')), sel: sel.slice(sel.indexOf('|') + 1) } : null

  const apply = (r: { ok: true; f: CatalogFeatureData } | { ok: false; why: string }, at?: [number, number]) => {
    if (r.ok) { onChange(r.f); return true }
    setNotice({ text: r.why, x: at?.[0], y: at?.[1] })
    return false
  }
  const nodeAt = (cx: number, cy: number) => (document.elementFromPoint(cx, cy)?.closest('[data-node]') as HTMLElement | null)?.dataset.node ?? null

  /** Drag `keys` together; `onClick` runs instead when the pointer never moved. */
  function dragNodes(keys: string[], e: { clientX: number; clientY: number }, onClick: () => void) {
    const base = Object.fromEntries(keys.map(k => [k, vsRef.current.get(k)]).filter(([, v]) => v).map(([k, v]) => [k, [(v as NodeView).x, (v as NodeView).y]])) as Record<string, [number, number]>
    const sx = e.clientX, sy = e.clientY, z = pz.view.z
    let moved = false
    const at = (ev: PointerEvent) => Object.fromEntries(Object.entries(base).map(([k, [x, y]]) => [k, [x + (ev.clientX - sx) / z, y + (ev.clientY - sy) / z]])) as Record<string, [number, number]>
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return
      moved = true
      setMoving(at(ev))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMoving(null)
      if (!moved) { onClick(); return }
      onChange(setPositions(dRef.current, at(ev)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* A node in a multi-selection drags the whole selection; Shift-click adds or
     removes it instead of selecting it alone. */
  function startMove(key: string, e: RPointerEvent) {
    if (e.shiftKey) {
      const cur = multi.length ? multi : sel && vs.has(sel) ? [sel] : []
      const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
      onMulti(next.length > 1 ? next : [])
      onSelect(next.length === 1 ? next[0] : null)
      return
    }
    dragNodes(multi.includes(key) ? multi : [key], e, () => { onMulti([]); onSelect(key) })
  }

  function startMarquee(e: RPointerEvent) {
    const [x0, y0] = pz.toWorld(e.clientX, e.clientY)
    setMarq({ x0, y0, x1: x0, y1: y0 })
    const move = (ev: PointerEvent) => {
      const [x1, y1] = pz.toWorld(ev.clientX, ev.clientY)
      setMarq({ x0, y0, x1, y1 })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarq(null)
      const [x1, y1] = pz.toWorld(ev.clientX, ev.clientY)
      const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1)
      const hit = [...vsRef.current.values()].filter(v => v.x < R && v.x + v.w > L && v.y < B && v.y + v.h > T).map(v => v.n.key)
      onMulti(hit.length > 1 ? hit : [])
      onSelect(hit.length === 1 ? hit[0] : null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* FLOW WIRING. From an out-port (press, ask, cond) onto something that takes
     the flow, or lift an in-port and drop it on a new parent. Legality is the
     edit itself: `regate` is run for every candidate up front, so a port that
     dims is one whose edit would be refused, with the same sentence. */
  function startWire(mode: 'out' | 'lift', key: string, e: RPointerEvent) {
    const f = dRef.current
    const legal = new Map<string, string | null>()
    for (const n of g.nodes) {
      if (n.key === key) continue
      const r = mode === 'out' ? regate(f, n.key, key, catalogTypes) : regate(f, key, n.key, catalogTypes)
      legal.set(n.key, r.ok ? null : r.why)
    }
    const [x, y] = pz.toWorld(e.clientX, e.clientY)
    setWire({ mode, key, x, y, over: null, legal })
    const move = (ev: PointerEvent) => {
      const [wx, wy] = pz.toWorld(ev.clientX, ev.clientY)
      const over = nodeAt(ev.clientX, ev.clientY)
      setWire(w => (w ? { ...w, x: wx, y: wy, over } : w))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWire(null)
      const over = nodeAt(ev.clientX, ev.clientY)
      if (over && over !== key) {
        const r = mode === 'out' ? regate(dRef.current, over, key, catalogTypes) : regate(dRef.current, key, over, catalogTypes)
        apply(r, [ev.clientX, ev.clientY])
        return
      }
      // Dropped on open canvas from an out-port: add something already wired.
      if (!over && mode === 'out' && (ev.target as Element | null)?.closest?.(`.${styles.pad}`)) {
        const r = pz.ref.current!.getBoundingClientRect()
        const [wx, wy] = pz.toWorld(ev.clientX, ev.clientY)
        setQuick({ sx: ev.clientX - r.left, sy: ev.clientY - r.top, wx, wy, src: key })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* APPLIES-TO. From a rule's square port onto a target: legal where the audit
     would pass it (targetRefusal), refused with the audit's sentence otherwise.
     Dropped on open canvas, it opens the chooser there. */
  function startAt(key: string, e: RPointerEvent) {
    const f = dRef.current
    const legal = new Map<string, string | null>()
    for (const n of g.nodes) {
      if (n.key === key) continue
      legal.set(n.key, n.kind === 'dest' ? targetRefusal(f, key, n.sel, nodes, catalogTypes)
        : 'A target is a tag, a roll kind or a catalog row — drop on open canvas to choose one.')
    }
    const [x, y] = pz.toWorld(e.clientX, e.clientY)
    setWire({ mode: 'at', key, x, y, over: null, legal })
    const move = (ev: PointerEvent) => {
      const [wx, wy] = pz.toWorld(ev.clientX, ev.clientY)
      const over = nodeAt(ev.clientX, ev.clientY)
      setWire(w => (w ? { ...w, x: wx, y: wy, over } : w))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWire(null)
      const over = nodeAt(ev.clientX, ev.clientY)
      const n = over ? g.nodes.find(x => x.key === over) : null
      if (n && over !== key) {
        const why = legal.get(over!)
        if (why) { setNotice({ text: why }); return }
        if (n.kind === 'dest') onChange(connectTarget(dRef.current, key, n.sel))
        return
      }
      if (!over && (ev.target as Element | null)?.closest?.(`.${styles.pad}`)) {
        const r = pz.ref.current!.getBoundingClientRect()
        setPick({ sx: ev.clientX - r.left, sy: ev.clientY - r.top, key })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function add(kind: AddKind, at: [number, number], src?: string) {
    setQuick(null)
    const r = addNode(dRef.current, kind, at, blankEffect)
    if (!r.ok) { setNotice({ text: r.why }); return }
    let f = r.f
    if (src && r.key) {
      const w = regate(f, r.key, src, catalogTypes)
      if (w.ok) f = w.f
    }
    onChange(f)
    if (r.key) onSelect(r.key)
  }

  /* Keys, as the mockup: Del deletes, A adds, I folds the inspector, Esc backs
     out. Never while typing — the inspector is full of inputs. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') { setQuick(null); setPick(null); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.key === 'g' || e.key === 'G') && (multi.length > 1 || (sel && vs.has(sel)))) {
        e.preventDefault()
        const keys = multi.length > 1 ? multi : [sel!]
        const f = makeGroup(dRef.current, keys)
        onChange(f)
        onMulti([])
        onSelect(`g:${(f.layout?.groups?.length ?? 1) - 1}`)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selGroup != null) {
        e.preventDefault()
        onChange(ungroup(dRef.current, selGroup))
        onSelect(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selWire) {
        e.preventDefault()
        onChange(disconnectTarget(dRef.current, selWire.key, selWire.sel))
        onSelect(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        const r = removeNode(dRef.current, sel, catalogTypes)
        if (apply(r)) onSelect(null)
      } else if (e.key === 'a' || e.key === 'A') {
        const r = pz.ref.current?.getBoundingClientRect()
        if (!r) return
        e.preventDefault()
        const [wx, wy] = pz.toWorld(r.left + r.width / 2, r.top + r.height / 2)
        setQuick({ sx: r.width / 2 - 110, sy: r.height / 2 - 120, wx, wy })
      } else if ((e.key === 'i' || e.key === 'I') && onToggleInsp) {
        e.preventDefault()
        onToggleInsp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const bbox = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const v of vs.values()) {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x + v.w + 50); y1 = Math.max(y1, v.y + v.h)
    }
    return { x0, y0, x1, y1 }
  }
  // Re-fit when a different feature opens, not on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (vs.size) pz.fit(bbox(), 48, rightInset) }, [fitKey])
  useLayoutEffect(() => {
    const v = sel ? vs.get(sel) : null
    if (focusTick && v) pz.centreOn(v.x + v.w / 2, v.y + v.h / 2, rightInset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])

  const bad = useMemo(() => {
    const m = new Map<string, 'err' | 'warn'>()
    for (const a of audit) {
      if (!a.id || (a.sev !== 'err' && a.sev !== 'warn')) continue
      for (const k of [`eff:${a.id}`, `var:${a.id}`]) if (vs.has(k) && m.get(k) !== 'err') m.set(k, a.sev)
    }
    return m
  }, [audit, vs])

  const related = (e: { from: string; to: string }) => !sel || e.from === sel || e.to === sel
  const edgesOf = <K extends GEdge['kind']>(k: K) => g.edges.filter((e): e is Extract<GEdge, { kind: K }> => e.kind === k)
  const effects = g.nodes.filter(n => n.kind === 'outcome' || n.kind === 'contrib' || n.kind === 'sheet')
  const formFits = effects.length <= 1 && !g.nodes.some(n => n.kind === 'var')

  /* ---- wires ---- */
  const wires: ReactNode[] = []
  for (const e of edgesOf('flow')) {
    const a = vs.get(e.from), b = vs.get(e.to)
    if (!a || !b) continue
    const [x1, y1] = flowOut(a), [x2, y2] = flowIn(b)
    const p = curve(x1, y1, x2 - 6, y2), dim = !related(e)
    wires.push(<g key={`f${e.from}>${e.to}`}>
      <path className={cx(styles.wFlow, dim && styles.dim)} d={p} markerEnd="url(#fgFlowHead)" />
      <path className={styles.wFlowCore} d={p} style={{ opacity: dim ? 0.12 : 0.8 }} />
      {!dim && <path className={styles.wFlowRun} d={p} />}
    </g>)
  }
  for (const e of edgesOf('data')) {
    const a = vs.get(e.from), b = vs.get(e.to)
    if (!a || !b) continue
    const [x1, y1] = dataOut(a), [x2, y2] = dataIn(b, e.ident)
    wires.push(<path key={`d${e.from}>${e.to}.${e.ident}.${e.field}`} className={cx(styles.wData, styles[`t_${e.type}`], !related(e) && styles.dim, offWire(e) && styles.off)} d={curve(x1, y1, x2, y2)} />)
  }
  const press = vs.get('press')
  if (press) for (const e of edgesOf('arm')) {
    const c = vs.get(e.to)
    if (!c) continue
    wires.push(<path key={`a${e.to}`} className={cx(styles.wArm, !related(e) && styles.dim, offWire(e) && styles.off)}
      // From the TIP: the press is pointed, so any other point on its right
      // side is outside the shape and the wire appears out of nothing.
      d={curve(press.x + press.w, press.y + press.h / 2, c.x - 4, c.y + 15)} />)
  }
  const picks = vs.get('picks')
  if (picks) for (const e of edgesOf('offer')) {
    const o = vs.get(e.from)
    if (!o) continue
    wires.push(<path key={`o${e.from}`} className={cx(styles.wOffer, !related(e) && styles.dim, offWire(e) && styles.off)}
      d={curve(o.x + o.w + 50, o.y + 15, picks.x, picks.y + picks.h / 2)} />)
  }
  const juncs = new Set<string>()
  for (const e of edgesOf('target')) {
    const s = vs.get(e.from), dv = vs.get(e.to)
    if (!s || !dv || !('eff' in s.n)) continue
    const eff = s.n.eff, x0 = s.x + s.w + 7, y0 = s.y + 15, jx = s.x + s.w + 46
    const gate = eff.ask ? styles.gAsk : eff.when ? styles.gWhen : undefined
    const hi = sel === e.from || sel === e.to
    if (e.and && !juncs.has(e.from)) {
      juncs.add(e.from)
      wires.push(<path key={`j${e.from}`} className={cx(styles.wAt, gate, sel && !hi && styles.dim)} d={`M${x0},${y0} L${jx - 7},${y0}`} />)
    }
    const wk = `w:${e.from}|${dv.n.kind === 'dest' ? dv.n.sel : ''}`
    const p = e.and ? curve(jx + 7, y0, dv.x - 6, dv.y + dv.h / 2) : curve(x0, y0, dv.x - 6, dv.y + dv.h / 2)
    wires.push(<path key={`t${e.from}>${e.to}`} className={cx(styles.wAt, gate, sel && (hi || sel === wk ? styles.hi : styles.dim), offWire(e) && styles.off)}
      d={p} markerEnd="url(#fgAtHead)" />)
    wires.push(<path key={`h${e.from}>${e.to}`} className={styles.wHit} d={p}
      onPointerDown={ev => ev.stopPropagation()} onClick={ev => { ev.stopPropagation(); onSelect(wk) }} />)
  }

  if (wire?.mode === 'at') {
    const a = vs.get(wire.key)
    const why = wire.over ? wire.legal.get(wire.over) : null
    const tgt = wire.over && why === null ? vs.get(wire.over) : null
    if (a) wires.push(<path key="ghost" className={cx(styles.wGhost, styles.at, !!why && styles.refuse)}
      d={curve(a.x + a.w + 7, a.y + 15, tgt ? tgt.x - 6 : wire.x, tgt ? tgt.y + tgt.h / 2 : wire.y)} />)
  } else if (wire) {
    const a = vs.get(wire.key)
    if (a) {
      const why = wire.over ? wire.legal.get(wire.over) : null
      const tgt = wire.over && why === null ? vs.get(wire.over) : null
      const [x1, y1] = wire.mode === 'out' ? flowOut(a) : [wire.x, wire.y]
      const [x2, y2] = wire.mode === 'out'
        ? (tgt ? flowIn(tgt) : [wire.x, wire.y])
        : (tgt ? flowOut(tgt) : flowIn(a))
      wires.push(<path key="ghost" className={cx(styles.wGhost, !!why && styles.refuse)}
        d={wire.mode === 'out' ? curve(x1, y1, x2, y2) : curve(x2, y2, x1, y1)} />)
    }
  }

  /* ---- nodes ---- */
  const connected = new Set(g.edges.flatMap(e => [e.from, e.to]))
  const nodeEls = [...vs.values()].map(v => {
    const { n } = v
    const h0 = head(n, d, namesByGid)
    const h = 'eff' in n ? { ...h0, title: titleOf(h0.title) } : h0
    const sev = bad.get(n.key)
    const armed = 'eff' in n && n.eff.once
    let body: ReactNode = null
    switch (n.kind) {
      case 'press': {
        const uses = d.uses?.max != null ? `${d.uses.max} / ${RESET_LABEL[d.recharge ?? ''] ?? 'manual'}` : 'at-will'
        body = <span className={styles.fx} style={{ color: 'var(--muted)' }}>{ACT_LABEL[d.activation ?? ''] ?? 'No activation set'} · {uses}</span>
        break
      }
      case 'cond': body = <span className={styles.fx}>{n.when}</span>; break
      case 'ask': {
        const k = g.edges.filter(e => e.kind === 'flow' && e.from === n.key).length
        body = <><div className={`${styles.askQ} prose-voice`}>“{n.ask}”</div><div className={styles.askTog}><span className={styles.sw2} />one checkbox · {k} branch{k === 1 ? '' : 'es'}</div></>
        break
      }
      case 'outcome': case 'sheet': body = <span className={styles.fx}><b>{effSummary(n.eff)}</b></span>; break
      case 'contrib': {
        const e = n.eff
        body = <>
          <div className={styles.caRow}>
            {e.op === 'add'
              ? <span className={cx(styles.contribAmt, String(e.value ?? '').length > 9 && styles.expr)}>{e.value}<small>{e.dmgType}</small></span>
              : <span className={cx(styles.contribAmt, styles.sm)}>{effSummary(e)}</span>}
            {e.once ? <span className={styles.armed}>armed by the press</span> : <span className={styles.always}>always on</span>}
          </div>
          <div className={styles.whenStrip}><span className={styles.hx} />when <b>{e.when || 'always'}</b></div>
          {e.ask && <div className={cx(styles.whenStrip, styles.ask)}><span className={styles.hx} />ask <b className="prose-voice">{e.ask}</b></div>}
        </>
        break
      }
      case 'var': {
        const def: VarDef = n.def
        body = <span className={styles.fx}>{def.uses
          ? <>uses of <b>{namesByGid.get(def.uses)?.name ?? def.uses}</b> left</>
          : def.kind === 'derived' ? <>ƒ = <b>{def.formula}</b></>
          : <>{def.type === 'bool' ? 'Boolean' : 'Number'} · init <b>{String(def.initial ?? (def.type === 'bool' ? false : 0))}</b>{def.scope === 'dm' && <> · <b>DM</b></>}</>}</span>
        break
      }
      case 'ext': body = <span className={styles.fx} style={{ color: 'var(--muted)' }}>{EXT_NOTE[n.decl]}</span>; break
      case 'ctx': body = <span className={styles.fx} style={{ color: 'var(--muted)' }}>only while a roll is made</span>; break
      case 'picks': {
        const offers = g.edges.filter(e => e.kind === 'offer')
        const k = pvScope ? offers.filter(e => !offKeys.has(e.from)).length : offers.length
        const pv0 = pvScope && typeof d.picks === 'string' ? evalExpr(d.picks, pvScope) : null
        const shown = pv0?.t === 'num' && !pv0.dice.length ? String(pv0.flat) : String(d.picks ?? '—')
        body = <div className={cx(styles.pk, shown.length > 4 && styles.long)}>may take <b>{shown}</b> of {k}{pvScope ? ' live' : ''} offer{k === 1 ? '' : 's'}</div>
        break
      }
      case 'dest': {
        const kind = destKind(n.sel)
        const broken = kind === 'thing' && ready && !namesByGid.has(n.sel)
        const count = kind === 'tag' ? matchCount(n.sel, nodes) : null
        const fan = g.edges.filter(e => e.kind === 'target' && e.to === n.key).length
        body = <><span className={styles.fx}>{kind === 'roll' ? 'every roll of this kind'
          : kind === 'tag' ? `${count} thing${count === 1 ? '' : 's'}`
          : !ready ? 'loading catalog…' : broken ? 'no catalog row · dangling' : namesByGid.get(n.sel)?.kind}</span>
          <span className={styles.fan}>{fan} in</span></>
        break
      }
    }
    const kindCls = n.kind === 'dest'
      ? cx(styles.kDest, destKind(n.sel) === 'roll' ? styles.dkRoll : destKind(n.sel) === 'thing' && styles.dkRef,
          destKind(n.sel) === 'thing' && ready && !namesByGid.has(n.sel) && styles.broken)
      : n.kind === 'var' ? styles.kVar
      : n.kind === 'ext' ? cx(styles.kVar, styles.decl)
      : styles[`k_${n.kind}`]
    const own = 'own' in n && n.own
    const pend = (n.kind === 'ask' || n.kind === 'cond') && !!n.pending
    const verdict = wire && wire.key !== n.key ? wire.legal.get(n.key) : undefined
    return (
      <div key={n.key} data-node={n.key}
        className={cx(styles.gn, kindCls, sel === n.key && styles.sel, sev === 'err' && styles.bad, pend && styles.pend,
          verdict === null && styles.can, typeof verdict === 'string' && styles.no, wire?.over === n.key && typeof verdict === 'string' && styles.deny,
          !!moving?.[n.key] && styles.lifting, multi.includes(n.key) && styles.msel, offKeys.has(n.key) && styles.off)}
        style={{ left: v.x, top: v.y, width: v.w, height: v.h } as CSSProperties}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => {
          if (e.button !== 0) return
          e.stopPropagation()
          const port = (e.target as Element).closest('[data-port]') as HTMLElement | null
          if (port?.dataset.port === 'at') startAt(n.key, e)
          else if (port?.dataset.port === 'out') startWire('out', n.key, e)
          else if (port?.dataset.port === 'in') startWire('lift', n.key, e)
          else startMove(n.key, e)
        }}>
        <div className={styles.gf} />
        <div className={styles.gi}>
          <div className={styles.gh}>
            <Icon name={h.icon} />
            <span className={styles.gt} title={n.kind === 'dest' ? n.sel : h.title}>{h.title || <span style={{ color: 'var(--danger-hot)' }}>no label</span>}</span>
            {armed && <span className={styles.gflag}>once</span>}
            {'eff' in n && n.eff.oneOf && <span className={styles.gflag}>one of</span>}
            <span className={styles.gk}>{h.chip}</span>
          </div>
          <div className={styles.gb} style={{ height: v.base || v.h - HDR - 8 }}>{body}</div>
          {v.det.length > 0 && (
            <div className={styles.gdet} style={{ height: v.det.length * 15 + 2 }}>
              {/* Inline: a detail line can carry a note's authored markdown. */}
              {v.det.map((l, i) => <div key={i} className={styles.dl} title={l}><Inline text={l} /></div>)}
            </div>
          )}
          {Array.from({ length: Math.max(v.ins.length, v.out ? 1 : 0) }, (_, i) => (
            <div key={i} className={styles.growR}><span>{v.ins[i] ?? ''}</span><span className={styles.rr}>{i === 0 && v.out ? 'value' : ''}</span></div>
          ))}
        </div>
        {zl === 'over' && (() => {
          const name = h.title || n.key
          const sub = n.kind === 'var' && n.def.kind === 'derived' ? n.def.formula ?? '' : ''
          const o = ovFit(name, v.w, v.h, !!sub && sub.length <= 34)
          return (
            <div className={styles.ov} style={{ ['--fmax' as string]: `${o.fs}px` } as CSSProperties}>
              <span className={styles.ovK}>{h.chip}</span>
              <span className={styles.ovN}>{name}</span>
              {o.sub && <span className={styles.ovS}>{sub}</span>}
            </div>
          )
        })()}
        {(n.kind === 'ask' || n.kind === 'cond' || n.kind === 'outcome') &&
          <span data-port="in" title="Drag onto another gate or the press to move this" className={cx(styles.port, styles.flow, styles.live, connected.has(n.key) && styles.on)}
            style={{ left: 0, top: flowIn(v)[1] - v.y }} />}
        {(n.kind === 'press' || n.kind === 'ask' || n.kind === 'cond') &&
          <span data-port="out" title="Drag onto an outcome, an Ask or a Condition — or onto empty canvas to add one"
            className={cx(styles.port, styles.flow, styles.live, g.edges.some(e => e.kind === 'flow' && e.from === n.key) && styles.on)}
            style={{ left: v.w, top: v.h / 2 }} />}
        {pend && <span className={cx(styles.gbadge, styles.pendB)}><Icon name="fa-link-slash" />unwired</span>}
        {v.ins.map((id, i) => <span key={id} className={cx(styles.port, styles.data, styles.on, styles[`t_${edgesOf('data').find(e => e.to === n.key && e.ident === id)?.type ?? 'n'}`])}
          style={{ left: 0, top: HDR + v.body + i * ROW + 11 }} />)}
        {v.out && <span className={cx(styles.port, styles.data, connected.has(n.key) && styles.on, styles[`t_${v.out}`])} style={{ left: v.w, top: HDR + v.body + 11 }} />}
        {'eff' in n && (!!n.eff.target?.length || own) && n.kind !== 'sheet' && (<>
          <span data-port="at" title="Drag onto a target — or onto open canvas to choose one" className={cx(styles.port, styles.at, styles.live, !!n.eff.target?.length && styles.on)} style={{ left: v.w, top: 15 }} />
          {own && <span className={cx(styles.ownMk, n.eff.op === 'grant' && styles.err)}>{n.eff.op === 'grant' ? 'no target' : n.eff.op === 'addUses' ? 'own uses' : 'own roll'}</span>}
          {(n.eff.target?.length ?? 0) > 1 && (
            <button type="button" className={cx(styles.mt, n.eff.match === 'and' && styles.and)} title="How these targets combine — click to switch"
              onPointerDown={ev => ev.stopPropagation()}
              onClick={ev => { ev.stopPropagation(); onChange(setMatch(dRef.current, n.key, n.eff.match === 'and' ? 'or' : 'and')) }}>
              {n.eff.match === 'and' ? 'and' : 'or'}
            </button>
          )}
        </>)}
        {n.kind === 'dest' && <span className={styles.atin} />}
        {sev === 'err' && <span className={styles.gbadge}><Icon name="fa-triangle-exclamation" />Error</span>}
        {sev === 'warn' && <span className={cx(styles.gbadge, styles.warnB)}><Icon name="fa-triangle-exclamation" />Warn</span>}
        {offKeys.has(n.key) && !sev && pvCls && <span className={cx(styles.gbadge, styles.offB)} title="Inactive at this class and level. It may still be had another way — feats, shards, DM grants.">Not at {pvCls.name} {pv?.lv}</span>}
        {n.kind === 'ext' && !sev && <span className={cx(styles.gbadge, styles.declB)}><Icon name="fa-arrow-up-right-from-square" />{n.decl}</span>}
      </div>
    )
  })
  const juncEls = [...juncs].map(k => {
    const s = vs.get(k)!
    return <div key={k} className={styles.junc} style={{ left: s.x + s.w + 46, top: s.y + 15 }} title="and — every target must hold of one roll">
      <span className={styles.jd} /><span className={styles.jc}>and</span>
    </div>
  })

  return (
    <div className={styles.graphPane}>
      <div ref={pz.ref} className={cx(styles.pad, pz.grabbing && styles.grabbing, wire && styles.wiring)}
        onPointerDown={e => { if (e.shiftKey && e.button === 0 && !(e.target as Element).closest('[data-node]')) startMarquee(e); else pz.onPointerDown(e) }}
        onClick={e => { if (!pz.wasDrag() && !e.shiftKey) { onSelect(null); onMulti([]); setQuick(null); setPick(null) } }}
        onDoubleClick={e => {
          if ((e.target as Element).closest('[data-node]')) return
          const r = pz.ref.current!.getBoundingClientRect()
          const [wx, wy] = pz.toWorld(e.clientX, e.clientY)
          setQuick({ sx: e.clientX - r.left, sy: e.clientY - r.top, wx, wy })
        }}
        onDragOver={e => { if (e.dataTransfer.types.includes(KIND_DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDrop={e => {
          const k = e.dataTransfer.getData(KIND_DRAG) as AddKind
          if (!k) return
          e.preventDefault()
          add(k, pz.toWorld(e.clientX, e.clientY))
        }}>
        <div className={cx(styles.wcanvas, zl === 'over' && styles.zlOver)}
          style={{ transform: `translate(${pz.view.x}px,${pz.view.y}px) scale(${pz.view.z})`, ['--inv' as string]: (1 / pz.view.z).toFixed(3) } as CSSProperties}>
          <svg className={styles.wsvg} width="1" height="1">
            <defs>
              <marker id="fgAtHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 L3,5 Z" style={{ fill: '#d08a3c' }} /></marker>
              <marker id="fgFlowHead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 L3,5 Z" style={{ fill: 'var(--flow)' }} /></marker>
            </defs>
            {wires}
          </svg>
          {groups.map((gr, i) => {
            const ms = gr.m.map(k => vs.get(k)).filter((v): v is NodeView => !!v)
            if (!ms.length) return null
            const x0 = Math.min(...ms.map(v => v.x)) - 28, y0 = Math.min(...ms.map(v => v.y)) - 34
            const x1 = Math.max(...ms.map(v => v.x + v.w + (v.n.kind === 'contrib' ? 44 : 0))) + 28, y1 = Math.max(...ms.map(v => v.y + v.h)) + 24
            return (
              <div key={`g${i}`} className={cx(styles.grp, selGroup === i && styles.sel)} style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}>
                <span className={styles.gl} title="Drag to move the group · click to rename"
                  onClick={ev => ev.stopPropagation()}
                  onPointerDown={ev => { if (ev.button !== 0) return; ev.stopPropagation(); dragNodes(gr.m, ev, () => { onMulti([]); onSelect(`g:${i}`) }) }}>
                  {gr.l}{gr.s && <span className={styles.gs}>{gr.s}</span>}
                </span>
              </div>
            )
          })}
          {nodeEls}
          {marq && <div className={styles.marq} style={{ left: Math.min(marq.x0, marq.x1), top: Math.min(marq.y0, marq.y1), width: Math.abs(marq.x1 - marq.x0), height: Math.abs(marq.y1 - marq.y0) }} />}
          {juncEls}
        </div>
      </div>
      {quick && (
        <div className={styles.qadd} style={{ left: Math.max(8, quick.sx), top: Math.max(8, quick.sy) }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <div className={styles.qaH}><Icon name={quick.src ? 'fa-plug' : 'fa-plus'} />{quick.src ? 'Add, wired from here' : 'Add node'}</div>
          {ADD_KINDS.filter(K => !quick.src || FLOW_CHILD.includes(K.k)).map(K => (
            <button key={K.k} type="button" className={styles.qaI} style={{ ['--kc' as string]: K.c } as CSSProperties}
              onClick={() => add(K.k, [quick.wx, quick.wy], quick.src)}>
              <span className={cx(styles.sw, styles[`sw_${K.sw}`])} />{K.l}<span className={styles.s}>{K.s}</span>
            </button>
          ))}
        </div>
      )}
      {pick && (
        <div className={cx(styles.qadd, styles.wide)} style={{ left: Math.max(8, pick.sx), top: Math.max(8, pick.sy) }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <div className={styles.qaH}><Icon name="fa-crosshairs" />Applies to a…</div>
          <TargetChooser f={d} srcs={[pick.key]} nodes={nodes} namesByGid={namesByGid} catalogTypes={catalogTypes}
            onPick={t => { onChange(connectTarget(dRef.current, pick.key, t)); setPick(null) }} />
        </div>
      )}
      {wire?.over && typeof wire.legal.get(wire.over) === 'string' && (
        <div className={styles.refuseTip}><b><Icon name="fa-ban" />Refused</b>{wire.legal.get(wire.over)}</div>
      )}
      {notice && <div className={styles.refuseTip}><b><Icon name="fa-ban" />Not done</b>{notice.text}</div>}
      {formFits && !quick && (
        <div className={styles.graphNote}>
          <Icon name="fa-circle-info" />
          <span className={styles.gt2}><b>The form fits this feature</b>One press, one write, nothing derived. The graph shows the same thing in more space.</span>
          <button type="button" className={styles.noteBtn} onClick={onForm}><Icon name="fa-list" /> Back to form</button>
        </div>
      )}
      <div className={styles.probe} onPointerDown={e => e.stopPropagation()}>
        {!pv && <span>Class progression</span>}
        <span className={styles.selw}>
          <select className={styles.probeSel} value={pv?.cls ?? ''} onChange={e => {
            const c = classes.find(x => x.id === e.target.value)
            progression.onPv(c ? { cls: c.id, lv: grantLevels(c.features, names).find(l => l > 1) ?? 1 } : null)
          }}>
            <option value="">Off</option>
            {[...classes].sort((a, b) => Number(b.features.some(r => r.feature_id === progression.featureId)) - Number(a.features.some(r => r.feature_id === progression.featureId)) || a.name.localeCompare(b.name))
              .map(c => <option key={c.id} value={c.id}>{c.name}{c.features.some(r => r.feature_id === progression.featureId) ? ' · grants this' : ''}</option>)}
          </select>
        </span>
        {pvCls && pv && (
          <div className={styles.seg2}>
            {grantLevels(pvCls.features, names).map(l => (
              <button key={l} type="button" className={cx(l === pv.lv && styles.on)} onClick={() => progression.onPv({ cls: pv.cls, lv: l })}>{l}</button>
            ))}
          </div>
        )}
        {pvCls && pv && <span className={styles.pvOn}>Previewing {pvCls.name} {pv.lv}</span>}
      </div>
      <div className={styles.zl}>
        <div className={styles.zlSeg}>
          {(['over', 'normal', 'detail'] as const).map(l => (
            <button key={l} type="button" className={cx(zl === l && styles.on)}
              title={l === 'over' ? 'Kind and name only' : l === 'normal' ? 'Name plus key fields' : 'Every field'}
              onClick={() => pz.zoomAt(({ over: 0.45, normal: 0.85, detail: 1.3 })[l] / pz.view.z)}>
              {l === 'over' ? 'Overview' : l === 'normal' ? 'Normal' : 'Detail'}
            </button>
          ))}
        </div>
        <span className={styles.zlChip}>{Math.round(pz.view.z * 100)}%</span>
      </div>
      <div className={styles.legend}>
        <span className={styles.lg}><span className={styles.lf} />Flow</span>
        <span className={styles.lg} title="Applies to — solid always, dashed when-gated, dotted ask-gated"><span className={styles.la} /><span className={styles.tx}>Applies to</span></span>
        <span className={styles.sep} />
        <span className={cx(styles.lg, styles.t_n)}><span className={styles.ld} /><span className={styles.tx}>Number</span></span>
        <span className={cx(styles.lg, styles.t_b)}><span className={styles.ld} /><span className={styles.tx}>Boolean</span></span>
        <span className={cx(styles.lg, styles.t_x)}><span className={styles.ld} /><span className={styles.tx}>Roll ctx</span></span>
      </div>
      <div className={styles.zoomers} style={{ right: rightInset }}>
        <button type="button" onClick={() => pz.zoomAt(1.2)} title="Zoom in"><Icon name="fa-plus" /></button>
        <button type="button" onClick={() => pz.zoomAt(1 / 1.2)} title="Zoom out"><Icon name="fa-minus" /></button>
        <button type="button" onClick={() => pz.fit(bbox(), 48, rightInset)} title="Fit"><Icon name="fa-expand" /></button>
      </div>
    </div>
  )
}

/* ---------- script (locked) ---------- */

export function FeatureScript({ d, catalogTypes, sel, onSelect }: {
  d: CatalogFeatureData
  catalogTypes: Record<string, 'num' | 'bool'>
  sel: string | null
  onSelect: (key: string | null) => void
}) {
  const lines = useMemo(() => serialize(d, project(d, catalogTypes)), [d, catalogTypes])
  const varNames = useMemo(() => new Set((d.vars ?? []).map(v => v.name)), [d.vars])
  return (
    <div className={styles.scriptPane}>
      <div className={styles.scHead}>
        <span className={styles.scPh} title="The language doesn't exist yet. This text shows layout and linking — not syntax.">
          <Icon name="fa-flask" />Placeholder syntax · illustrative, not a spec
        </span>
        <span className={styles.scLock}><Icon name="fa-lock" />Locked · read-only</span>
      </div>
      <div className={styles.scScroll}>
        <div className={styles.scBody}>
          <div className={styles.scGut}>
            {lines.map((l, i) => (
              <div key={i} className={cx(styles.gl, l.key && styles.linked, l.key && l.key === sel && styles.sel)}
                onClick={() => l.key && onSelect(l.key)}>{i + 1}</div>
            ))}
          </div>
          <pre className={styles.scHl}>
            {lines.map((l, i) => (
              <div key={i} className={cx(styles.sl, l.key && l.key === sel && styles.sel)} onClick={() => l.key && onSelect(l.key)}>
                {l.text ? colour(l.text, varNames).map((t, j) => <span key={j} className={t.c ? styles[`c_${t.c}`] : undefined}>{t.v}</span>) : ' '}
              </div>
            ))}
          </pre>
        </div>
      </div>
      <div className={styles.scFoot}>
        <span>Click a line to select its node</span><span className={styles.grow} />
        <span className={styles.c_ev}>on · event</span><span className={styles.c_cond}>when · if</span><span className={styles.c_ask}>ask</span>
        <span className={styles.c_con}>contribution</span><span className={styles.c_act}>action</span><span className={styles.c_var}>variable</span>
        <span className={styles.c_pk}>take · pick</span><span className={styles.c_tag}>tag:</span><span className={styles.c_roll}>roll:</span>
      </div>
    </div>
  )
}

/* ---------- inspector ---------- */

/** A gate's text. Committed on blur or Enter, not per keystroke: a real gate's
 *  node key is derived from its text, so writing every letter would re-key the
 *  node (and drop the selection) under the author's cursor. */
function GateText({ value, tone, placeholder, onCommit, allowEmpty }: { value: string; tone: string; placeholder: string; onCommit: (v: string) => void; allowEmpty?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { const t = v.trim(); if ((t || allowEmpty) && t !== value) onCommit(t); else setV(value) }
  return <input className={styles.gateIn} style={{ ['--gc' as string]: tone } as CSSProperties} value={v} placeholder={placeholder}
    spellCheck={false} onChange={e => setV(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') setV(value) }} />
}

export function GraphInspector({ d, catalogTypes, sel, update, nodes, namesByGid, featureList, onSelect, pressFields, multi, onMulti }: {
  d: CatalogFeatureData
  catalogTypes: Record<string, 'num' | 'bool'>
  sel: string | null
  update: (fn: (x: CatalogFeatureData) => CatalogFeatureData) => void
  nodes: AuthoredNode[]
  namesByGid: Map<string, { name: string; kind: string }>
  featureList: { gid: string; name: string }[]
  onSelect: (key: string | null) => void
  /** The form's own activation / uses / picks block, for the press and picks nodes. */
  pressFields: ReactNode
  multi: string[]
  onMulti: (keys: string[]) => void
}) {
  const g = useMemo(() => project(d, catalogTypes), [d, catalogTypes])
  const n = sel ? g.nodes.find(x => x.key === sel) : undefined
  const graph = d.graph ?? [], vars = d.vars ?? []
  const setGraph = (next: GraphEffect[]) => update(x => ({ ...x, graph: next }))
  const setVars = (next: VarDef[]) => update(x => ({ ...x, vars: next }))
  const gated = (key: string) => g.edges.filter(e => e.kind === 'flow' && e.from === key).map(e => g.nodes.find(x => x.key === e.to)).filter(Boolean) as GNode[]
  const label = (x: GNode) => ('eff' in x ? x.eff.label || x.eff.op : x.kind === 'cond' ? `if ${x.when}` : x.kind === 'ask' ? `ask “${x.ask}”` : x.key)

  const nameOf = (k: string) => { const x = g.nodes.find(y => y.key === k); return x ? label(x) : k }
  if (multi.length > 1) return <>
    <div className={styles.iblk}><b>{multi.length} nodes selected</b>Drag any one of them to move them together, or group them to label a section of the canvas.</div>
    <div className={styles.conns}>{multi.map(k => (
      <button key={k} type="button" className={styles.conn} onClick={() => { onMulti([]); onSelect(k) }}><b>{nameOf(k)}</b></button>
    ))}</div>
    <button type="button" className={styles.noteBtn} onClick={() => {
      let i = 0
      update(x => { const y = makeGroup(x, multi); i = (y.layout?.groups?.length ?? 1) - 1; return y })
      onMulti([]); onSelect(`g:${i}`)
    }}><Icon name="fa-object-group" /> Group · G</button>
  </>

  if (sel?.startsWith('g:')) {
    const i = +sel.slice(2), gr = d.layout?.groups?.[i]
    if (gr) return <>
      <div className={styles.iblk}><b>Layout only</b>Groups are for reading the canvas. The engine and the form never see them — ungrouping changes nothing about the feature.</div>
      <span className={styles.gateLab}>Name</span>
      <GateText key={`gl${i}`} value={gr.l} tone="var(--beige)" placeholder="Group name" onCommit={t => update(x => editGroup(x, i, { l: t }))} />
      <span className={styles.gateLab}>Subtitle</span>
      <GateText key={`gs${i}`} value={gr.s ?? ''} allowEmpty tone="var(--beige-dim)" placeholder="optional" onCommit={t => update(x => editGroup(x, i, { s: t }))} />
      <span className={styles.gateLab}>Members · {gr.m.length}</span>
      <div className={styles.conns}>{gr.m.map(k => (
        <button key={k} type="button" className={styles.conn} onClick={() => onSelect(k)}><b>{nameOf(k)}</b></button>
      ))}</div>
      <button type="button" className={styles.noteBtn} onClick={() => { update(x => ungroup(x, i)); onSelect(null) }}>
        <Icon name="fa-object-ungroup" /> Ungroup · Del
      </button>
    </>
  }

  if (sel?.startsWith('w:')) {
    const key = sel.slice(2, sel.indexOf('|')), t = sel.slice(sel.indexOf('|') + 1)
    const src = g.nodes.find(x => x.key === key)
    return <>
      <div className={styles.iblk} style={{ ['--bc' as string]: 'var(--orange)' }}>
        <b>Applies-to wire</b>One entry in <code>{src ? label(src) : key}</code>’s target list: <code>{t}</code>. Removing
        the wire removes that entry, and any other spelling that means the same target.
      </div>
      <button type="button" className={styles.noteBtn} onClick={() => { update(x => disconnectTarget(x, key, t)); onSelect(null) }}>
        <Icon name="fa-link-slash" /> Remove wire · Del
      </button>
    </>
  }

  if (!n) return (
    <div className={styles.inspEmpty}>
      <div className={styles.t}>No node selected</div>
      <div className={styles.dsc}>Select a node to edit it. It opens the same editor the form uses for that rule.</div>
      <div className={styles.qa}>
        <div className={styles.q}><Icon name="fa-play" /><span><b>Thick pale wires</b> carry the press to the outcomes it runs. They fan out, never chain — every outcome fires on the same press.</span></div>
        <div className={styles.q}><Icon name="fa-circle" /><span><b>Thin coloured wires</b> are values: the identifiers a formula reads, coloured by type. Edit the formula to change them.</span></div>
        <div className={styles.q}><Icon name="fa-crosshairs" /><span><b>Orange wires</b> are applies-to: a rule pointing at what it affects. Dashed = gated by a when; dotted cyan = gated by an ask.</span></div>
        <div className={styles.q}><Icon name="fa-ellipsis" /><span><b>Dotted amber</b> tethers are the press arming a <b>once</b> rule; dashed ones are offers counting toward Picks.</span></div>
      </div>
    </div>
  )

  if ('eff' in n) return (
    <EffectEditor eff={n.eff} graph={graph} vars={vars} nodes={nodes} namesByGid={namesByGid}
      onChange={setGraph} onVarsChange={setVars} onClose={() => onSelect(null)} />
  )
  if (n.kind === 'var') {
    const vi = vars.indexOf(n.def)
    return <VarCard v={n.def} features={featureList}
      set={p => update(x => ({ ...x, vars: (x.vars ?? []).map((v, j) => (j === vi ? { ...v, ...p } : v)) }))}
      onDelete={() => { setVars(vars.filter((_, j) => j !== vi)); onSelect(null) }} />
  }

  const block = (t: string, body: ReactNode, tone?: string) => (
    <div className={styles.iblk} style={tone ? { ['--bc' as string]: tone } : undefined}><b>{t}</b>{body}</div>
  )
  switch (n.kind) {
    case 'press': return <>
      {block('The press · one per feature', <>These are the feature’s own Activation fields — the same inputs as the form. Every outcome wired from here runs on the same press; outcomes have no order.</>, 'var(--amber)')}
      {pressFields}
    </>
    case 'cond': case 'ask': {
      const kids = gated(n.key)
      const commit = (t: string) => {
        const nk = editedGateKey(d, n.key, t, catalogTypes)
        update(x => editGate(x, n.key, t, catalogTypes))
        onSelect(nk)
      }
      return <>
        {n.kind === 'cond'
          ? block('when · the app decides', <>Written as the <code>when</code> on every outcome under it.{n.pending && <> Nothing is under it yet — drag a wire from it onto an outcome.</>}</>, 'var(--beige)')
          : block('ask · a human decides', <>Outcomes sharing one ask are a single checkbox. There is no “no” branch: unticked, they simply don’t resolve.{n.pending && <> Nothing is under it yet — drag a wire from it onto an outcome.</>}</>, 'var(--cyan-hot)')}
        <span className={styles.gateLab}>{n.kind === 'cond' ? 'when — formula' : 'ask — the checkbox text'}</span>
        <GateText key={n.key} value={n.kind === 'cond' ? n.when : n.ask} tone={n.kind === 'cond' ? 'var(--beige)' : 'var(--cyan)'}
          placeholder={n.kind === 'cond' ? 'hp < hpMax / 2' : 'Did it hit?'} onCommit={commit} />
        <div className={styles.conns}>{kids.map(k => (
          <button key={k.key} type="button" className={styles.conn} onClick={() => onSelect(k.key)}><b>{label(k)}</b></button>
        ))}</div>
      </>
    }
    case 'picks': {
      const offers = g.edges.filter(e => e.kind === 'offer').map(e => g.nodes.find(x => x.key === e.from)).filter(Boolean) as GNode[]
      return <>
        {block('Feature-level · picks', <>Every <code>once</code> rule carrying an <code>ask</code> is an offer; the player may take <b>{String(d.picks ?? '—')}</b> of them. Not wired — the dashed tethers show which.</>, 'var(--amber)')}
        <div className={styles.conns}>{offers.map(k => (
          <button key={k.key} type="button" className={styles.conn} onClick={() => onSelect(k.key)}><b>{label(k)}</b></button>
        ))}</div>
        {pressFields}
      </>
    }
    case 'ext': return block(`Declared elsewhere · ${n.decl}`, <><code>{n.ident}</code> — {EXT_NOTE[n.decl]}. Read-only here.</>, 'var(--good)')
    case 'ctx': return block('Roll context', <><code>{n.ident}</code> exists only while a roll is being made, so only a contribution’s formula may read it — never a variable.</>, 'var(--cyan-hot)')
    case 'dest': {
      const srcs = g.edges.filter(e => e.kind === 'target' && e.to === n.key).map(e => g.nodes.find(x => x.key === e.from)).filter(Boolean) as GNode[]
      const kind = destKind(n.sel)
      return <>
        {block(kind === 'tag' ? 'Tag' : kind === 'roll' ? 'Roll kind' : 'Reference', <>
          <code>{n.sel}</code> — {kind === 'roll' ? 'every roll of this kind' : kind === 'tag' ? `${matchCount(n.sel, nodes)} things carry it` : namesByGid.get(n.sel)?.name ?? 'no catalog row'}.
          It is an entry in each rule’s target list below.</>, 'var(--orange)')}
        <div className={styles.conns}>{srcs.map(k => (
          <button key={k.key} type="button" className={styles.conn} onClick={() => onSelect(k.key)}><b>{label(k)}</b></button>
        ))}</div>
        <span className={styles.gateLab}>Retarget · {srcs.length} rule{srcs.length === 1 ? '' : 's'}</span>
        <TargetChooser key={n.key} f={d} srcs={srcs.map(x => x.key)} cur={n.sel} nodes={nodes} namesByGid={namesByGid}
          catalogTypes={catalogTypes} onPick={t => { update(x => retarget(x, n.sel, t)); onSelect(`dest:${asKey(t)}`) }} />
        <button type="button" className={styles.noteBtn} onClick={() => { update(x => { const r = removeNode(x, n.key, catalogTypes); return r.ok ? r.f : x }); onSelect(null) }}>
          <Icon name="fa-link-slash" /> Remove from every rule
        </button>
      </>
    }
  }
  return null
}

/** Where an audit item lands on the canvas, if anywhere. */
export function auditNodeKey(a: AuditItem, d: CatalogFeatureData): string | null {
  if (!a.id) return null
  if ((d.graph ?? []).some(e => e.id === a.id)) return `eff:${a.id}`
  if ((d.vars ?? []).some(v => v.name === a.id)) return `var:${a.id}`
  return null
}

