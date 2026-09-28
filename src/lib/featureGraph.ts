/**
 * The Feature Editor's Graph view model: ONE feature, projected into nodes and
 * wires. Nothing here is stored — every node and every wire is re-derived from
 * the same `CatalogFeatureData` the form edits, so the two views cannot drift.
 * The only thing the graph owns is `layout`, which the engine never reads.
 *
 * The mockup (guide-hud/project/feature-graph.js) draws conditions and asks as
 * nodes on the press's flow. The schema has neither: an activation outcome
 * carries its own `when` and `ask`. So a gate node IS the set of outcomes that
 * share that string, and there is no such thing as an outcome the press does
 * not reach — every activation op runs on the press.
 *
 * NODE KEYS ARE THE CONTRACT. Saved positions and groups hang off them, so a key
 * must survive every edit that does not delete its node.
 */
import type { CatalogFeatureData, FeatureLayout, GraphEffect, VarDef } from './database.types.ts'
import { ROLL_IDENTS, VAR_IDENTS, freeIdents, interpolations, isHasIdent } from './expr.ts'
import { askKey, asKey, probeScope } from './graph.ts'
import { HAS_TARGET, OPS } from './opSchema.ts'
import { isUsable } from './featureView.ts'

/** The VAR_IDENTS the canvas draws. Everything else in that list is a sheet stat
 *  — `level`, `prof`, the mods — which nearly every formula reads, and a node for
 *  it would wire to everything and say nothing. This one is a fact about the
 *  TURN, and a gate that reads it (`attacksThisTurn == 0`) is the whole point of
 *  the feature, so it is drawn. A new turn-tracker counter belongs here too. */
export const ENGINE_IDENTS: readonly string[] = ['attacksThisTurn']

export type WireType = 'n' | 'b' | 'x'
export type ExtDecl = 'has_*' | 'catalog' | 'engine'

export type GNode =
  | { key: 'press'; kind: 'press' }
  | { key: 'picks'; kind: 'picks' }
  /** `pending`: a layout.pending id — placed, not yet written onto any outcome. */
  | { key: string; kind: 'ask'; ask: string; pending?: string }
  | { key: string; kind: 'cond'; when: string; pending?: string }
  | { key: string; kind: 'outcome' | 'contrib' | 'sheet'; eff: GraphEffect; own: boolean }
  | { key: string; kind: 'var'; def: VarDef }
  | { key: string; kind: 'ext'; ident: string; decl: ExtDecl }
  | { key: string; kind: 'ctx'; ident: string }
  | { key: string; kind: 'dest'; sel: string }

export type GEdge =
  /** The press reaching an outcome, through its gates. */
  | { kind: 'flow'; from: string; to: string }
  /** The press arming a `once` contribution. */
  | { kind: 'arm'; from: string; to: string }
  /** An armed offer counting toward the feature's picks. */
  | { kind: 'offer'; from: string; to: string }
  /** A formula reading an identifier. Show-only: the formula text is the one
   *  place this is authored. */
  | { kind: 'data'; from: string; to: string; ident: string; field: string; type: WireType }
  /** Applies-to. `and` = every target must hold of the same roll (a junction). */
  | { kind: 'target'; from: string; to: string; and: boolean }

export type FeatureGraph = { nodes: GNode[]; edges: GEdge[] }

const SHEET_STATS = new Set<string>(VAR_IDENTS.filter(i => !ENGINE_IDENTS.includes(i)))
const ROLL = new Set<string>(ROLL_IDENTS)

export function project(f: CatalogFeatureData, catalogTypes: Record<string, 'num' | 'bool'> = {}): FeatureGraph {
  const nodes = new Map<string, GNode>()
  const edges: GEdge[] = []
  const seenEdge = new Set<string>()
  const node = <N extends GNode>(n: N): string => { if (!nodes.has(n.key)) nodes.set(n.key, n); return n.key }
  const link = (e: GEdge) => {
    const id = `${e.kind}|${e.from}|${e.to}|${e.kind === 'data' ? e.ident + '|' + e.field : ''}`
    if (!seenEdge.has(id)) { seenEdge.add(id); edges.push(e) }
  }

  const vars = f.vars ?? []
  const graph = f.graph ?? []
  const press = isUsable(f) ? node({ key: 'press', kind: 'press' }) : null
  for (const d of vars) node({ key: `var:${d.name}`, kind: 'var', def: d })

  /* Ids are random and unchecked (GraphEffects newId), so a duplicate is possible;
     it still gets its own node rather than silently merging with its twin. */
  const count = new Map<string, number>()
  const effKey = (e: GraphEffect) => {
    const n = (count.get(e.id) ?? 0) + 1
    count.set(e.id, n)
    return n === 1 ? `eff:${e.id}` : `eff:${e.id}~${n}`
  }

  /** Who reads what — resolved after every node exists. */
  const reads: { to: string; field: string; src: string }[] = []
  const offers: string[] = []

  for (const e of graph) {
    const def = OPS[e.op]
    if (!def) continue // an op this build does not know — the audit's job, not the canvas's
    const key = effKey(e)
    const kind = def.group === 'activation' ? 'outcome' : def.group === 'sheet' ? 'sheet' : 'contrib'
    const targets = HAS_TARGET(e.op) ? e.target ?? [] : []
    node({ key, kind, eff: e, own: HAS_TARGET(e.op) && !targets.length })

    if (kind === 'outcome' && press) {
      let at: string = press
      const ask = e.ask?.trim()
      if (ask) {
        const k = node({ key: `ask:${askKey(ask)}`, kind: 'ask', ask })
        link({ kind: 'flow', from: at, to: k })
        at = k
      }
      const when = e.when?.trim()
      if (when) {
        const k = node({ key: `when:${at}|${when}`, kind: 'cond', when })
        link({ kind: 'flow', from: at, to: k })
        at = k
      }
      link({ kind: 'flow', from: at, to: key })
    }
    if (kind === 'contrib' && e.once) {
      if (press) link({ kind: 'arm', from: press, to: key })
      if (e.ask?.trim()) offers.push(key)
    }

    const and = e.match === 'and' && targets.length > 1
    for (const sel of targets) {
      const k = node({ key: `dest:${asKey(sel)}`, kind: 'dest', sel: asKey(sel) })
      link({ kind: 'target', from: key, to: k, and })
    }

    for (const fd of def.fields) {
      const v = (e as unknown as Record<string, unknown>)[fd.key]
      if (fd.type === 'formula' && typeof v === 'string') reads.push({ to: key, field: fd.key, src: v })
      if (fd.type === 'array' && Array.isArray(v)) v.forEach((c, i) => typeof c === 'string' && c && reads.push({ to: key, field: `${fd.key}[${i}]`, src: c }))
      if (fd.type === 'text' && typeof v === 'string') for (const s of interpolations(v)) reads.push({ to: key, field: fd.key, src: s })
    }
    if (e.when) reads.push({ to: key, field: 'when', src: e.when })
    for (const s of interpolations(e.label ?? '')) reads.push({ to: key, field: 'label', src: s })
  }

  /* Gates placed on the canvas and not yet wired. In array order, so one may
     hang from another placed before it; a lost parent falls back to the press. */
  for (const p of f.layout?.pending ?? []) {
    const k = `pend:${p.id}`
    node(p.kind === 'ask' ? { key: k, kind: 'ask', ask: p.text, pending: p.id } : { key: k, kind: 'cond', when: p.text, pending: p.id })
    const parent = nodes.has(p.parent) ? p.parent : press
    if (parent) link({ kind: 'flow', from: parent, to: k })
  }

  const hasPicks = (f.picks != null && String(f.picks).trim() !== '') || offers.length >= 2
  if (hasPicks) {
    node({ key: 'picks', kind: 'picks' })
    for (const o of offers) link({ kind: 'offer', from: o, to: 'picks' })
    if (typeof f.picks === 'string') reads.push({ to: 'picks', field: 'picks', src: f.picks })
  }
  for (const d of vars) if (d.kind === 'derived' && d.formula) reads.push({ to: `var:${d.name}`, field: 'formula', src: d.formula })
  if (press && typeof f.uses?.max === 'string') reads.push({ to: press, field: 'uses', src: f.uses.max })

  /* Data wires. A local declaration shadows the catalog, the same order
     probeScope binds them in. */
  const local = new Set(vars.map(d => d.name))
  const scope = probeScope(vars, undefined, catalogTypes)
  const source = (id: string): string | null => {
    if (local.has(id)) return `var:${id}`
    if (ROLL.has(id)) return node({ key: `ctx:${id}`, kind: 'ctx', ident: id })
    if (ENGINE_IDENTS.includes(id)) return node({ key: `ext:${id}`, kind: 'ext', ident: id, decl: 'engine' })
    if (SHEET_STATS.has(id)) return null
    if (isHasIdent(id)) return node({ key: `ext:${id}`, kind: 'ext', ident: id, decl: 'has_*' })
    if (id in catalogTypes) return node({ key: `ext:${id}`, kind: 'ext', ident: id, decl: 'catalog' })
    return null // unknown — auditNode reports it
  }
  const typeOf = (id: string): WireType =>
    ROLL.has(id) && !local.has(id) ? 'x'
      : isHasIdent(id) || typeof scope[id] === 'boolean' ? 'b' : 'n'
  for (const r of reads) {
    for (const id of freeIdents(r.src)) {
      const from = source(id)
      if (from && from !== r.to) link({ kind: 'data', from, to: r.to, ident: id, field: r.field, type: typeOf(id) })
    }
  }

  return { nodes: [...nodes.values()], edges }
}

/* ==========================================================================
 * EDITS. Every one is `(f, …) => f'`: pure, no mutation, and it writes the
 * SCHEMA's own fields — a gate edit is a `when`/`ask` edit on outcomes, a target
 * edit is a `target` entry. Nothing here invents storage the form cannot see,
 * except `layout`, which only the canvas reads.
 * ========================================================================== */

export type Edit = { ok: true; f: CatalogFeatureData } | { ok: false; why: string }

const uid = () => Math.random().toString(36).slice(2, 8)

/** Effect keys in graph order — the same numbering project() gives duplicates. */
function effKeys(f: CatalogFeatureData): string[] {
  const seen = new Map<string, number>()
  return (f.graph ?? []).map(e => {
    const n = (seen.get(e.id) ?? 0) + 1
    seen.set(e.id, n)
    return n === 1 ? `eff:${e.id}` : `eff:${e.id}~${n}`
  })
}

const withLayout = (f: CatalogFeatureData, l: FeatureLayout): CatalogFeatureData => ({ ...f, layout: l })

export function setPos(f: CatalogFeatureData, key: string, xy: [number, number]): CatalogFeatureData {
  return withLayout(f, { ...f.layout, pos: { ...f.layout?.pos, [key]: [Math.round(xy[0]), Math.round(xy[1])] } })
}

/** Drop saved positions and group members whose node no longer exists. */
export function prune(f: CatalogFeatureData, catalogTypes: Record<string, 'num' | 'bool'> = {}): CatalogFeatureData {
  if (!f.layout) return f
  const live = new Set(project(f, catalogTypes).nodes.map(n => n.key))
  const pos = Object.fromEntries(Object.entries(f.layout.pos ?? {}).filter(([k]) => live.has(k)))
  const groups = f.layout.groups?.map(g => ({ ...g, m: g.m.filter(k => live.has(k)) })).filter(g => g.m.length)
  return withLayout(f, { ...f.layout, pos, ...(groups ? { groups } : {}) })
}

/** The gates between the press and `key`, top first — `key` included if it is one. */
function gatesTo(g: FeatureGraph, key: string): GNode[] {
  const byKey = new Map(g.nodes.map(n => [n.key, n]))
  const out: GNode[] = []
  let cur = key
  for (let guard = 0; guard < 32 && cur !== 'press'; guard++) {
    const n = byKey.get(cur)
    if (n && (n.kind === 'ask' || n.kind === 'cond')) out.unshift(n)
    const up = g.edges.find(e => e.kind === 'flow' && e.to === cur)
    if (!up) break
    cur = up.from
  }
  return out
}

/** Outcomes reachable from `key` along the flow (the key itself if it is one). */
function outcomesUnder(g: FeatureGraph, key: string): string[] {
  const kids = (k: string) => g.edges.filter(e => e.kind === 'flow' && e.from === k).map(e => e.to)
  const out: string[] = [], seen = new Set<string>(), stack = [key]
  while (stack.length) {
    const k = stack.pop()!
    if (seen.has(k)) continue
    seen.add(k)
    if (k.startsWith('eff:')) out.push(k)
    stack.push(...kids(k))
  }
  return out
}

/** Collapse a chain of gates into the one `ask` + one `when` an outcome can hold.
 *  Two conditions become `(a) && (b)`: the only composition the schema has. Two
 *  different asks cannot — an outcome answers exactly one question. */
function collapse(gates: GNode[]): { ask?: string; when?: string } | { why: string } {
  const asks = gates.filter((n): n is Extract<GNode, { kind: 'ask' }> => n.kind === 'ask')
  if (new Set(asks.map(a => askKey(a.ask))).size > 1) return { why: 'An outcome answers one ask. It is already behind a different question.' }
  const whens = gates.filter((n): n is Extract<GNode, { kind: 'cond' }> => n.kind === 'cond').map(n => n.when.trim()).filter(Boolean)
  const uniq = [...new Set(whens)]
  return {
    ask: asks[0]?.ask,
    when: uniq.length === 0 ? undefined : uniq.length === 1 ? uniq[0] : uniq.map(w => `(${w})`).join(' && '),
  }
}

function writeGates(f: CatalogFeatureData, key: string, gates: { ask?: string; when?: string }): CatalogFeatureData {
  const i = effKeys(f).indexOf(key)
  if (i < 0) return f
  const graph = (f.graph ?? []).map((e, j) => {
    if (j !== i) return e
    const { ask: _a, when: _w, ...rest } = e
    return { ...rest, ...(gates.ask ? { ask: gates.ask } : {}), ...(gates.when ? { when: gates.when } : {}) }
  })
  return { ...f, graph }
}

/** Where a gate that became real now lives, so its position can follow it. */
function realKeyOf(parent: string, n: { kind: 'ask' | 'cond'; text: string }): string {
  return n.kind === 'ask' ? `ask:${askKey(n.text)}` : `when:${parent}|${n.text.trim()}`
}

/** THE flow edit: hang `child` (an outcome, or a gate with everything under it)
 *  from `parent` (the press or a gate). Every outcome affected is re-pathed —
 *  its `ask`/`when` become the gates now above it. A pending gate on the new
 *  path turns real and leaves `layout.pending`, its position carried across. */
export function regate(f: CatalogFeatureData, childKey: string, parentKey: string, catalogTypes: Record<string, 'num' | 'bool'> = {}): Edit {
  const g = project(f, catalogTypes)
  const kind = (k: string) => g.nodes.find(n => n.key === k)?.kind
  const pk = kind(parentKey), ck = kind(childKey)
  if (pk !== 'press' && pk !== 'ask' && pk !== 'cond') return { ok: false, why: 'Flow leaves the press, an Ask or a Condition — nothing else fires.' }
  if (ck !== 'outcome' && ck !== 'ask' && ck !== 'cond') {
    return { ok: false, why: ck === 'contrib' ? 'A contribution is armed by the press, not wired — tick Arms once on it.' : 'Only an activation outcome, an Ask or a Condition takes the flow.' }
  }
  if (childKey === parentKey || gatesTo(g, parentKey).some(n => n.key === childKey)) {
    return { ok: false, why: 'That would hang a gate from itself.' }
  }

  const above = gatesTo(g, parentKey)
  const targets = ck === 'outcome' ? [childKey] : outcomesUnder(g, childKey)
  let next = f
  const consumed = new Set<string>()
  for (const t of targets) {
    const mine = gatesTo(g, t)
    const tail = ck === 'outcome' ? [] : mine.slice(Math.max(0, mine.findIndex(n => n.key === childKey)))
    const path = [...above, ...tail]
    const c = collapse(path)
    if ('why' in c) return { ok: false, why: c.why }
    next = writeGates(next, t, c)
    for (const n of path) if ((n.kind === 'ask' || n.kind === 'cond') && n.pending) consumed.add(n.pending)
  }
  // A pending gate moved with nothing under it just changes its parent.
  if (ck !== 'outcome' && targets.length === 0) {
    const id = (g.nodes.find(n => n.key === childKey) as { pending?: string } | undefined)?.pending
    if (!id) return { ok: true, f: next }
    return { ok: true, f: withLayout(next, { ...next.layout, pending: (next.layout?.pending ?? []).map(p => (p.id === id ? { ...p, parent: parentKey } : p)) }) }
  }
  if (consumed.size) {
    const pos = { ...next.layout?.pos }
    for (const p of next.layout?.pending ?? []) {
      if (!consumed.has(p.id)) continue
      const was = pos[`pend:${p.id}`]
      const real = realKeyOf(p.parent === `pend:${p.id}` ? 'press' : p.parent, p)
      if (was && !pos[real]) pos[real] = was
      delete pos[`pend:${p.id}`]
    }
    const pending = (next.layout?.pending ?? []).filter(p => !consumed.has(p.id))
      .map(p => (consumed.has(p.parent.replace(/^pend:/, '')) ? { ...p, parent: 'press' } : p))
    next = withLayout(next, { ...next.layout, pos, pending })
  }
  return { ok: true, f: prune(next, catalogTypes) }
}

/** The key a gate will have once `editGate` gives it `text` — a real gate's key
 *  is derived from its text, so a selection has to follow it. */
export function editedGateKey(f: CatalogFeatureData, key: string, text: string, catalogTypes: Record<string, 'num' | 'bool'> = {}): string {
  const g = project(f, catalogTypes)
  const n = g.nodes.find(x => x.key === key)
  if (!n || (n.kind !== 'ask' && n.kind !== 'cond') || n.pending) return key
  return realKeyOf(g.edges.find(e => e.kind === 'flow' && e.to === key)?.from ?? 'press', { kind: n.kind, text })
}

/** Rewrite a gate's text on exactly the outcomes under it; its position follows. */
export function editGate(f: CatalogFeatureData, key: string, text: string, catalogTypes: Record<string, 'num' | 'bool'> = {}): CatalogFeatureData {
  const g = project(f, catalogTypes)
  const n = g.nodes.find(x => x.key === key)
  if (!n || (n.kind !== 'ask' && n.kind !== 'cond')) return f
  if (n.pending) {
    return withLayout(f, { ...f.layout, pending: (f.layout?.pending ?? []).map(p => (p.id === n.pending ? { ...p, text } : p)) })
  }
  let next = f
  for (const t of outcomesUnder(g, key)) {
    const i = effKeys(f).indexOf(t)
    const e = f.graph![i]
    next = writeGates(next, t, n.kind === 'ask' ? { ask: text, when: e.when } : { ask: e.ask, when: text })
  }
  // Keep the canvas where the author left it: the key is derived from the text.
  const parent = g.edges.find(e => e.kind === 'flow' && e.to === key)?.from ?? 'press'
  const nk = realKeyOf(parent, { kind: n.kind, text })
  const pos: Record<string, [number, number]> = {}
  for (const [k, v] of Object.entries(next.layout?.pos ?? {})) {
    pos[k === key ? nk : n.kind === 'ask' && k.startsWith(`when:${key}|`) ? `when:${nk}|${k.slice(key.length + 6)}` : k] = v
  }
  return next.layout ? withLayout(next, { ...next.layout, pos }) : next
}

/** Delete a node. What that means depends on what it is a view of. */
export function removeNode(f: CatalogFeatureData, key: string, catalogTypes: Record<string, 'num' | 'bool'> = {}): Edit {
  const g = project(f, catalogTypes)
  const n = g.nodes.find(x => x.key === key)
  if (!n) return { ok: false, why: 'Nothing to delete.' }
  let next: CatalogFeatureData
  switch (n.kind) {
    case 'outcome': case 'contrib': case 'sheet': {
      const i = effKeys(f).indexOf(key)
      next = { ...f, graph: (f.graph ?? []).filter((_, j) => j !== i) }
      break
    }
    case 'var': next = { ...f, vars: (f.vars ?? []).filter(v => v !== n.def) }; break
    case 'picks': { const { picks: _p, ...rest } = f; next = rest as CatalogFeatureData; break }
    case 'dest': next = { ...f, graph: (f.graph ?? []).map(e => (e.target?.length ? { ...e, target: e.target.filter(t => asKey(t) !== n.sel) } : e)) }; break
    case 'ask': case 'cond': {
      if (n.pending) {
        const parent = f.layout?.pending?.find(p => p.id === n.pending)?.parent ?? 'press'
        next = withLayout(f, { ...f.layout, pending: (f.layout?.pending ?? []).filter(p => p.id !== n.pending).map(p => (p.parent === key ? { ...p, parent } : p)) })
        break
      }
      next = f
      for (const t of outcomesUnder(g, key)) {
        const c = collapse(gatesTo(g, t).filter(x => x.key !== key))
        if ('why' in c) return { ok: false, why: c.why }
        next = writeGates(next, t, c)
      }
      break
    }
    case 'press': return { ok: false, why: 'The press is the feature’s Activation. Set it to None in the form to remove it.' }
    case 'ext': return { ok: false, why: 'Declared by another node. Remove the formulas that read it instead.' }
    case 'ctx': return { ok: false, why: 'Roll context is the engine’s. Remove the formulas that read it instead.' }
  }
  return { ok: true, f: prune(next, catalogTypes) }
}

export type AddKind = 'contrib' | 'sheet' | 'outcome' | 'var' | 'cond' | 'ask' | 'picks' | 'press'

/** A new node at `at`. Effects start from `blankOf(op)` — the form's own defaults
 *  (opSchema.blankEffect), passed in so this file stays free of id minting. */
export function addNode(f: CatalogFeatureData, kind: AddKind, at: [number, number], blankOf: (op: GraphEffect['op']) => GraphEffect): Edit & { key?: string } {
  let next: CatalogFeatureData, key: string
  if (kind === 'contrib' || kind === 'sheet' || kind === 'outcome') {
    const eff = blankOf(kind === 'contrib' ? 'add' : kind === 'sheet' ? 'boost' : 'setVar')
    next = { ...f, graph: [...(f.graph ?? []), eff] }
    key = effKeys(next).at(-1)!
  } else if (kind === 'var') {
    const names = new Set((f.vars ?? []).map(v => v.name))
    let name = 'newVariable', i = 2
    while (names.has(name)) name = `newVariable${i++}`
    next = { ...f, vars: [...(f.vars ?? []), { name, kind: 'derived', formula: '0' }] }
    key = `var:${name}`
  } else if (kind === 'picks') {
    if (f.picks != null && String(f.picks).trim()) return { ok: false, why: 'A feature has one Picks.' }
    next = { ...f, picks: 1 }
    key = 'picks'
  } else if (kind === 'press') {
    if (isUsable(f)) return { ok: false, why: 'A feature has one press — it is its Activation.' }
    next = { ...f, activation: 'action' }
    key = 'press'
  } else {
    const id = uid()
    next = withLayout(f, { ...f.layout, pending: [...(f.layout?.pending ?? []), { id, kind, text: kind === 'ask' ? 'Did it happen?' : 'true', parent: 'press' }] })
    key = `pend:${id}`
  }
  return { ok: true, f: setPos(next, key, at), key }
}

const COL_W = 380
const GAP = 36

/** Where every node goes. Saved positions win; the rest fall into columns in
 *  reading order — what is read, what derives from it, the press, its gates,
 *  what the feature does, the choice, and what it applies to. A target sits
 *  level with the average of the rules pointing at it (the mockup's rule),
 *  pushed down until it clears its neighbours.
 *  ponytail: column stacking, blind to saved neighbours. A real layered layout
 *  when a feature outgrows it. */
export function autoLayout(
  g: FeatureGraph,
  saved: FeatureLayout['pos'] = {},
  /** Rendered height of a node, so a column stacks without overlap. */
  heightOf: (key: string) => number = () => 110,
): Record<string, [number, number]> {
  const byKey = new Map(g.nodes.map(n => [n.key, n]))
  /* A derived variable sits one column right of the deepest variable it reads. */
  const depth = new Map<string, number>()
  const varDepth = (key: string, seen = new Set<string>()): number => {
    const known = depth.get(key)
    if (known != null) return known
    const n = byKey.get(key)
    if (!n || n.kind !== 'var' || n.def.kind !== 'derived' || seen.has(key)) return 0
    seen.add(key)
    const ins = g.edges.filter(e => e.kind === 'data' && e.to === key && byKey.get(e.from)?.kind === 'var')
    const d = 1 + Math.max(0, ...ins.map(e => varDepth(e.from, seen)))
    depth.set(key, d)
    return d
  }
  const maxVar = Math.max(0, ...g.nodes.map(n => varDepth(n.key)))
  const colOf = (n: GNode): number => {
    let c = 1 + maxVar
    switch (n.kind) {
      case 'ext': case 'ctx': return 0
      case 'var': return varDepth(n.key)
      case 'press': return c
      case 'ask': return c + 1
      case 'cond': return c + 2
      case 'outcome': case 'contrib': case 'sheet': return c + 3
      case 'picks': return c + 4
      case 'dest': return c + 5
    }
  }
  const cols = new Map<number, string[]>()
  for (const n of g.nodes) {
    const c = colOf(n)
    cols.set(c, [...(cols.get(c) ?? []), n.key])
  }
  const out: Record<string, [number, number]> = {}
  ;[...cols.keys()].sort((a, b) => a - b).forEach((c, i) => {
    let y = 60
    const taken: [number, number][] = []
    for (const key of cols.get(c)!) {
      if (saved[key]) { out[key] = saved[key]; continue }
      const h = heightOf(key)
      if (byKey.get(key)?.kind === 'dest') {
        const ys = g.edges.filter(e => e.kind === 'target' && e.to === key).map(e => out[e.from]?.[1]).filter((v): v is number => v != null)
        let dy = ys.length ? Math.round(ys.reduce((a, b) => a + b, 0) / ys.length) : y
        while (taken.some(([t, th]) => dy < t + th + GAP && dy + h + GAP > t)) dy += 30
        out[key] = [60 + i * COL_W, dy]
        taken.push([dy, h])
        continue
      }
      out[key] = [60 + i * COL_W, y]
      y += h + GAP
    }
  })
  return out
}
