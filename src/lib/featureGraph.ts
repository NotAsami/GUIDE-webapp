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
  | { key: string; kind: 'ask'; ask: string }
  | { key: string; kind: 'cond'; when: string }
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

const COL_W = 320
const ROW_H = 150

/** Where every node goes. Saved positions win; the rest fall into columns in
 *  reading order — what is read, what derives from it, the press, its gates,
 *  what the feature does, the choice, and what it applies to.
 *  ponytail: fixed pitch, blind to node height and to saved neighbours. A real
 *  layered layout when a feature outgrows it. */
export function autoLayout(g: FeatureGraph, saved: FeatureLayout['pos'] = {}): Record<string, [number, number]> {
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
    let row = 0
    for (const key of cols.get(c)!) out[key] = saved[key] ?? [60 + i * COL_W, 60 + row++ * ROW_H]
  })
  return out
}
