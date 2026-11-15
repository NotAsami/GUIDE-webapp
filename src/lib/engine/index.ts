/**
 * THE ENGINE, as the rest of the app sees it.
 *
 * Two implementations sit behind these names — the TypeScript original
 * (lib/expr.ts, and later dice and graph) and the Rust port compiled to
 * WebAssembly (packages/engine-wasm, built from engine/). lib/engine/setting.ts
 * says which one answers. Callers import from here and never learn which.
 *
 * This file holds no rules. It dispatches, and in shadow mode it compares.
 *
 * Every function stays SYNCHRONOUS: the engine runs inside render. The one
 * async step is `initEngine`, awaited once at boot before anything renders.
 */
import init, * as wasm from '../../../packages/engine-wasm/engine.js'
import type {
  ArmedMod, CharacterRow, EffectDef, EffectiveSheet, Feature, GraphEffect, ItemEffects, Mod, ShardTree, VarDef,
} from '../database.types.ts'
import * as tsBurden from '../burden.ts'
import * as tsDice from '../dice.ts'
import * as tsFx from '../effects.ts'
import * as tsGraph from '../graph.ts'
import * as tsMods from '../modEditor.ts'
import * as tsShards from '../shards.ts'
import * as ts from '../expr.ts'
import { attempt, sameOutcome, type Outcome } from './compare.ts'
import { STRICT, engineMode, setEngineMode, type EngineMode } from './setting.ts'

export type { ExprScope, FormulaValue } from '../expr.ts'
export type { RolledDie } from '../dice.ts'
export type { ActiveSource } from '../effects.ts'
export type {
  AuditItem, AuditSev, AuthoredNode, Gid, GidKind, GraphContext, Resolution, ResolveReq, Rider, RollKind, VarBinding,
} from '../graph.ts'

// The constant lists are read at module scope by several callers, before any
// async init could have run — so they stay static. engine.parity.test.ts holds
// them equal to the Rust copies.
export { BOOST_IDENTS, HAS_PREFIX, HIT_ASK, ROLL_IDENTS, ROLL_IDENT_PROBE, VAR_IDENTS } from '../expr.ts'

let ready = false

/** Load the WebAssembly engine. Awaited once, at boot. */
export async function initEngine(): Promise<void> {
  await init({ module_or_path: new URL('../../../packages/engine-wasm/engine_bg.wasm', import.meta.url) })
  ready = true
}

/** The same, from bytes already in hand — Node (tests), where there is no fetch of a file. */
export function initEngineSync(bytes: BufferSource): void {
  wasm.initSync({ module: bytes })
  ready = true
}

/** Why the WebAssembly engine is not answering, when it was asked for and is not. */
let loadFailure: unknown

/** What is answering right now — for the DM's setting, which has to be able to
 *  say "you asked for the Rust engine and it did not load". */
export const engineStatus = (): { mode: EngineMode; loaded: boolean; failed: boolean } =>
  ({ mode: engineMode(), loaded: ready, failed: loadFailure !== undefined })

/**
 * Choose the engine on this device. Loads the WebAssembly module first if the
 * choice needs it and boot did not — so the switch takes effect at once, with
 * no reload, and a module that will not load leaves the setting where it was.
 */
export async function selectEngine(mode: EngineMode): Promise<void> {
  if (mode !== 'ts' && !ready) {
    try { await initEngine() } catch (e) { loadFailure = e; throw e }
  }
  loadFailure = undefined
  setEngineMode(mode)
}

/**
 * Boot. Awaited before the first render when the setting asks for the Rust
 * engine, because the engine runs inside render and cannot be awaited there.
 * NEVER rejects: if the module will not load the app starts on the TypeScript
 * engine, which is still here, and the setting says what happened.
 */
export async function bootEngine(): Promise<void> {
  if (engineMode() === 'ts') return
  try { await initEngine() } catch (e) {
    loadFailure = e
    console.error('[engine] the WebAssembly engine failed to load; running the TypeScript engine', e)
  }
}

/** The Rust engine's own constants, for the test that pins the static copies to them. */
export const wasmConstants = () => wasm.engineConstants()

// --- shadow mode ---------------------------------------------------------------

export type EngineDiff = { fn: string; args: unknown[]; ts: Outcome<unknown>; wasm: Outcome<unknown> }

const DIFF_KEY = 'guide.engine.diffs'
const DIFF_CAP = 50

function report(diff: EngineDiff): void {
  if (STRICT) throw new Error(`engines disagree on ${diff.fn}: ${JSON.stringify(diff)}`)
  console.warn('[engine shadow] engines disagree', diff)
  try {
    const kept: unknown[] = JSON.parse(localStorage.getItem(DIFF_KEY) ?? '[]')
    localStorage.setItem(DIFF_KEY, JSON.stringify([...kept, diff].slice(-DIFF_CAP)))
  } catch { /* storage full or unavailable: the console line is the record */ }
}

export function clearEngineDiffs(): void {
  try { localStorage.removeItem(DIFF_KEY) } catch { /* nothing to clear */ }
}

/** The differences shadow mode has recorded on this device, oldest first. */
export function engineDiffs(): EngineDiff[] {
  try { return JSON.parse(localStorage.getItem(DIFF_KEY) ?? '[]') } catch { return [] }
}

let warned = false

/** One engine function, answered by whichever implementation the setting names. */
function dispatch<A extends unknown[], R>(fn: string, original: (...a: A) => R, port: (...a: A) => R): (...a: A) => R {
  return (...args) => {
    const mode = engineMode()
    if (mode === 'ts') return original(...args)
    if (!ready) {
      // Asked for before boot finished, or the module failed to load. The
      // original is still here, so the app keeps working and says so once.
      if (!warned) { warned = true; console.warn('[engine] WebAssembly engine not loaded; using the TypeScript engine') }
      return original(...args)
    }
    if (mode === 'wasm') return port(...args)

    const a = attempt(() => original(...args))
    const b = attempt(() => port(...args))
    if (!sameOutcome(a, b)) report({ fn, args, ts: a, wasm: b })
    if ('threw' in a) throw a.threw
    return a.ok
  }
}

// --- the expression evaluator (slice 1) ------------------------------------------

export const evalExpr = dispatch('evalExpr', ts.evalExpr, wasm.evalExpr)
export const freeIdents = dispatch('freeIdents', ts.freeIdents, wasm.freeIdents)
export const interpolate = dispatch('interpolate', ts.interpolate, wasm.interpolate)
export const interpolations = dispatch('interpolations', ts.interpolations, wasm.interpolations)
export const hasIdent = dispatch('hasIdent', ts.hasIdent, wasm.hasIdent)
export const isHasIdent = dispatch('isHasIdent', ts.isHasIdent, wasm.isHasIdent)

// --- dice (slice 2) --------------------------------------------------------------

/**
 * A function that ROLLS. The Rust engine is handed its randomness rather than
 * generating it, so the port takes one more argument than the original: the
 * source, `Math.random` here.
 *
 * Shadow mode needs both engines to see the SAME dice, or every roll would be
 * a difference. The original reads `Math.random` directly, so it is wrapped for
 * the length of the call to record what it drew, and the port replays that
 * tape. Drawing a different NUMBER of times is itself a difference.
 */
function rolling<A extends unknown[], R>(
  fn: string,
  original: (...a: A) => R,
  port: (...a: [...A, () => number]) => R,
): (...a: A) => R {
  return (...args) => {
    const mode = engineMode()
    if (mode === 'ts' || !ready) return original(...args)
    if (mode === 'wasm') return port(...args, Math.random)

    const tape: number[] = []
    const real = Math.random
    Math.random = () => { const r = real(); tape.push(r); return r }
    let a: Outcome<R>
    try { a = attempt(() => original(...args)) } finally { Math.random = real }
    let used = 0
    const b = attempt(() => port(...args, () => tape[used++] ?? NaN))
    if (!sameOutcome(a, b) || used !== tape.length) {
      report({ fn, args: [...args, { draws: tape.length, portDrew: used }], ts: a, wasm: b })
    }
    if ('threw' in a) throw a.threw
    return a.ok
  }
}

export const parseDice = dispatch('parseDice', tsDice.parseDice, wasm.parseDice)
export const rollDice = rolling('rollDice', tsDice.rollDice, wasm.rollDice)
export const rolledDice = rolling('rolledDice', tsDice.rolledDice, wasm.rolledDice)
export const rerollDie = rolling('rerollDie', tsDice.rerollDie, wasm.rerollDie)
export const rollHeal = rolling('rollHeal', tsDice.rollHeal, wasm.rollHeal)
const terms = rolling('rolledDiceTerms', tsDice.rolledDiceTerms as (exprs: string[], double: boolean) => tsDice.RolledDie[], wasm.rolledDiceTerms)
/** `double` is filled in HERE: the port's randomness is its last argument, so an
 *  omitted optional before it would shift the source into the wrong slot. */
export const rolledDiceTerms = (exprs: string[], double = false) => terms(exprs, double)

// --- the sheet layer (slice 3a) ----------------------------------------------------
//
// Character data crosses the boundary as plain values, so the port's functions
// are untyped at the edge; the casts below restore the types the originals declare.

type Trees = Record<string, ShardTree>
/** One shared default, so an omitted catalog is the SAME object on every call. */
const NO_TREES: Trees = {}

/**
 * ONE CHARACTER, HELD. Copying a character into the Rust engine costs about a
 * millisecond, and the app asks a dozen questions about one per render — so in
 * the non-`ts` modes each character object is converted ONCE, kept in
 * WebAssembly memory, and asked from there. Answers are remembered too: the
 * same character object always gives the same answer.
 *
 * Keyed on IDENTITY, weakly. A character row is immutable state — an edit makes
 * a new object, which is a new entry, and the old one is collected with its
 * row. Code that mutates a row in place and asks again would get the first
 * answer; nothing in the app does, and shadow mode is how one would be caught.
 */
type Held = { view: wasm.CharacterView; answers: Map<string, Map<unknown, Outcome<unknown>>> }
const held = new WeakMap<object, WeakMap<object, Held>>()

function holding(character: CharacterRow, trees: Trees): Held {
  let byTrees = held.get(character)
  if (!byTrees) held.set(character, byTrees = new WeakMap())
  let h = byTrees.get(trees)
  if (!h) byTrees.set(trees, h = { view: wasm.loadCharacter(character, trees), answers: new Map() })
  return h
}

/** An answer handed to more than one caller must not be changeable by any of them. */
function frozen<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v) && !(v instanceof Map) && !(v instanceof Set)) {
    Object.freeze(v)
    // Data properties only: a context's index maps are getters, built on first read.
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) if ('value' in d) frozen(d.value)
  }
  return v
}

/**
 * A question about one character. `extra` is the one further argument a few of
 * them take (the catalog's variable types), and is part of the memo key.
 *
 *   ts      the original, every call.
 *   wasm    the held character's answer, computed once and frozen.
 *   shadow  the original every call — callers get exactly what they get today —
 *           and the port ONCE per character, compared when it is first computed.
 */
function onCharacter<X, R>(
  fn: string,
  original: (c: CharacterRow, t: Trees, extra: X) => R,
  port: (view: wasm.CharacterView, extra: X) => R,
  after?: (fromOriginal: R, fromPort: Outcome<R>) => void,
): (c: CharacterRow, t: Trees, extra: X) => R {
  return (character, trees, extra) => {
    const mode = engineMode()
    if (mode === 'ts' || !ready || !character || typeof character !== 'object') return original(character, trees, extra)
    const h = holding(character, trees)
    let byExtra = h.answers.get(fn)
    if (!byExtra) h.answers.set(fn, byExtra = new Map())
    let b = byExtra.get(extra) as Outcome<R> | undefined
    const fresh = !b
    if (!b) byExtra.set(extra, b = attempt(() => port(h.view, extra)))
    if (mode === 'wasm') {
      if ('threw' in b) throw b.threw
      return frozen(b.ok)
    }
    const a = attempt(() => original(character, trees, extra))
    if (fresh && !sameOutcome(a, b)) report({ fn, args: [character, trees, extra], ts: a, wasm: b })
    if ('threw' in a) throw a.threw
    after?.(a.ok, b)
    return a.ok
  }
}

const sheet = onCharacter('effectiveSheet', (c, t) => tsFx.effectiveSheet(c, t), v => v.effectiveSheet() as EffectiveSheet)
export const effectiveSheet = (character: CharacterRow, shardTrees: Trees = NO_TREES) => sheet(character, shardTrees, undefined)

const sources = onCharacter('activeSources', (c, t) => tsFx.activeSources(c, t), v => v.activeSources() as tsFx.ActiveSource[])
export const activeSources = (character: CharacterRow, shardTrees: Trees = NO_TREES) => sources(character, shardTrees, undefined)

const carry = onCharacter('carryMultiplier', (c, t) => tsFx.carryMultiplier(c, t), v => v.carryMultiplier())
export const carryMultiplier = (character: CharacterRow, shardTrees: Trees = NO_TREES) => carry(character, shardTrees, undefined)

const gear = onCharacter('gearFeatures', c => tsFx.gearFeatures(c), v => v.gearFeatures() as Feature[])
export const gearFeatures = (character: CharacterRow) => gear(character, NO_TREES, undefined)

const fromShards = onCharacter('shardFeatures', (c, t) => tsShards.shardFeatures(c, t), v => v.shardFeatures() as Feature[])
export const shardFeatures = (character: CharacterRow, catalog: Trees) => fromShards(character, catalog, undefined)

const burdenOf = onCharacter('currentBurden', c => tsBurden.currentBurden(c), v => v.currentBurden())
export const currentBurden = (character: CharacterRow) => burdenOf(character, NO_TREES, undefined)

type Skills = Pick<EffectDef, 'skillProficiencies' | 'skillExpertise'>[]
const compile = dispatch('compileEffects', tsMods.compileEffects as (m: Mod[], s: Skills | undefined) => ItemEffects | undefined,
  (m, s) => wasm.compileEffects(m, s) as ItemEffects | undefined)
export const compileEffects = (mods: Mod[], skills?: Skills) => compile(mods, skills)

const fxOf = dispatch('sheetEffects', tsMods.sheetEffects as (g: GraphEffect[] | undefined, s: ts.ExprScope | undefined) => ItemEffects | undefined,
  (g, s) => wasm.sheetEffects(g, s) as ItemEffects | undefined)
export const sheetEffects = (graph?: GraphEffect[], scope?: ts.ExprScope | undefined) => fxOf(graph, scope)

// --- the feature graph (slice 3b) ----------------------------------------------------

type Types = Record<string, 'num' | 'bool'>
const NO_TYPES: Types = {}
type Audit = tsGraph.AuditItem[]
type Scoped = { scope: ts.ExprScope; audit: Audit }

const vars = onCharacter('characterVars', (c, t, k: Types) => tsGraph.characterVars(c, t, k) as Scoped, (v, k) => v.characterVars(k) as Scoped)
export const characterVars = (character: CharacterRow, shardTrees: Trees = NO_TREES, catalogTypes: Types = NO_TYPES) =>
  vars(character, shardTrees, catalogTypes)

const base = onCharacter('baseScope', (c, t) => tsGraph.baseScope(c, t), v => v.baseScope() as ts.ExprScope)
export const baseScope = (character: CharacterRow, shardTrees: Trees = NO_TREES) => base(character, shardTrees, undefined)

/** The original APPENDS what the walk reports to an array it is handed. Both
 *  engines are asked for `{ scope, audit }` and the appending happens here, once. */
const probed = dispatch('probeScope',
  (defs: VarDef[], types: Types): Scoped => { const audit: Audit = []; return { scope: tsGraph.probeScope(defs, audit, types), audit } },
  (defs, types) => wasm.probeScope(defs, types) as Scoped)
export function probeScope(defs: VarDef[] = [], audit?: Audit, catalogTypes: Types = NO_TYPES): ts.ExprScope {
  const out = probed(defs, catalogTypes)
  audit?.push(...out.audit)
  return out.scope
}

export const collectVars = dispatch('collectVars', tsGraph.collectVars,
  sources => new Map(wasm.collectVars(sources) as [string, tsGraph.VarBinding][]))
export const varCollisions = dispatch('varCollisions', tsGraph.varCollisions, (d, sev) => wasm.varCollisions(d, sev) as Audit)

const varsAudit = dispatch('auditVars', tsGraph.auditVars as (d: VarDef[], k: Types) => Audit, (d, k) => wasm.auditVars(d, k) as Audit)
export const auditVars = (defs: VarDef[], catalogTypes: Types = NO_TYPES) => varsAudit(defs, catalogTypes)

/**
 * THE CATALOG, HELD — the same idea as a held character. The editor audits on
 * every keystroke against every authored node; the node list is converted once
 * per list object and kept in the engine, so an audit sends only the node being edited.
 */
const catalogs = new WeakMap<object, WeakMap<object, wasm.Catalog>>()
function catalogOf(nodes: tsGraph.AuthoredNode[], types: Types): wasm.Catalog {
  let byTypes = catalogs.get(nodes)
  if (!byTypes) catalogs.set(nodes, byTypes = new WeakMap())
  let c = byTypes.get(types)
  if (!c) byTypes.set(types, c = wasm.loadCatalog(nodes, types))
  return c
}
const NO_NODES: tsGraph.AuthoredNode[] = []

type Node = Parameters<typeof tsGraph.auditNode>[0]
const nodeAudit = dispatch('auditNode', tsGraph.auditNode as (n: Node, a: tsGraph.AuthoredNode[], k: Types) => Audit,
  (n, a, k) => catalogOf(a, k).auditNode(n) as Audit)
export const auditNode = (node: Node, nodes: tsGraph.AuthoredNode[] = NO_NODES, catalogTypes: Types = NO_TYPES) =>
  nodeAudit(node, nodes, catalogTypes)

export const gid = dispatch('gid', tsGraph.gid, (kind, x) => wasm.gid(kind, x) as tsGraph.Gid)
export const nodeGid = dispatch('nodeGid', tsGraph.nodeGid, (a, b) => wasm.nodeGid(a, b) as tsGraph.Gid)
export const normalizeTag = dispatch('normalizeTag', tsGraph.normalizeTag, wasm.normalizeTag)
export const askKey = dispatch('askKey', tsGraph.askKey, wasm.askKey)
export const asKey = dispatch('asKey', tsGraph.asKey, wasm.asKey)
export const reqKeys = dispatch('reqKeys', tsGraph.reqKeys, wasm.reqKeys)
export const armedMatches = dispatch('armedMatches', tsGraph.armedMatches, wasm.armedMatches)
export const matchCount = dispatch('matchCount', tsGraph.matchCount, (selector, nodes) => catalogOf(nodes, NO_TYPES).matchCount(selector))
export const total = dispatch('total', tsGraph.total, r => wasm.total(r) as { flat: number; dice: string[] })
export const isD20 = tsGraph.isD20

type Rolled = ReturnType<typeof tsGraph.rollResolution>
const rolledRes = rolling('rollResolution',
  tsGraph.rollResolution as (r: tsGraph.Resolution, double: boolean, own: string | undefined) => Rolled,
  (r, double, own, random) => wasm.rollResolution(r, double, own, random) as Rolled)
export const rollResolution = (res: tsGraph.Resolution, double = false, ownType?: string) => rolledRes(res, double, ownType)

/**
 * THE CONTEXT. In the Rust engine it is a handle: the character's graph stays
 * in WebAssembly memory and a roll sends only its request across. Callers still
 * see the plain object the original returns — `scope`, `armed`, `problems`, and
 * the two index maps — with the handle riding along out of sight.
 *
 * Non-enumerable on purpose: a caller that spreads a context to change part of
 * it (`{ ...ctx, armed }`) gets an object WITHOUT the handle, and every function
 * below then answers from the TypeScript engine for it. A stale handle would
 * answer about a graph the caller no longer holds.
 */
const HANDLE = Symbol('engine.handle')
type Ctx = tsGraph.GraphContext & { [HANDLE]?: wasm.GraphContext }
const handleOf = (ctx: tsGraph.GraphContext) => (ready && engineMode() !== 'ts' ? (ctx as Ctx)[HANDLE] : undefined)

type Dump = [string, { eff: GraphEffect; from: tsFx.ActiveSource; owner: tsGraph.Gid }[]][]

/** A handle as the object callers expect. The index is large and two callers read it, so it is built on first touch. */
function fromHandle(handle: wasm.GraphContext): tsGraph.GraphContext {
  let dump: [Dump, Dump] | undefined
  const maps = () => (dump ??= handle.indexDump() as [Dump, Dump])
  const ctx = {
    scope: handle.scope as ts.ExprScope,
    problems: handle.problems as Audit,
    armed: handle.armed as ArmedMod[],
    get index() { return new Map(maps()[0]) },
    get byOwner() { return new Map(maps()[1]) as tsGraph.GraphContext['byOwner'] },
  }
  Object.defineProperty(ctx, HANDLE, { value: handle })
  return ctx
}

const plain = (c: tsGraph.GraphContext) => ({ scope: c.scope, problems: c.problems, armed: c.armed, index: c.index, byOwner: c.byOwner })

/** In shadow mode the caller gets the original's context, with the port's handle attached to it. */
const context = onCharacter<Types, tsGraph.GraphContext>('buildContext',
  (c, t, k) => tsGraph.buildContext(c, t, k),
  (v, k) => fromHandle(v.buildContext(k)),
  (mine, theirs) => { if ('ok' in theirs && !(HANDLE in mine)) Object.defineProperty(mine, HANDLE, { value: (theirs.ok as Ctx)[HANDLE] }) })
export const buildContext = (character: CharacterRow, shardTrees: Trees = NO_TREES, catalogTypes: Types = NO_TYPES) =>
  context(character, shardTrees, catalogTypes)

/** A function of a context: answered by the handle when the context carries one. */
function onContext<A extends unknown[], R>(
  fn: string,
  original: (ctx: tsGraph.GraphContext, ...a: A) => R,
  port: (handle: wasm.GraphContext, ...a: A) => R,
): (ctx: tsGraph.GraphContext, ...a: A) => R {
  return (ctx, ...args) => {
    const handle = handleOf(ctx)
    if (!handle) return original(ctx, ...args)
    if (engineMode() === 'wasm') return port(handle, ...args)
    const a = attempt(() => original(ctx, ...args))
    const b = attempt(() => port(handle, ...args))
    if (!sameOutcome(a, b)) report({ fn, args: [plain(ctx), ...args], ts: a, wasm: b })
    if ('threw' in a) throw a.threw
    return a.ok
  }
}

export const resolve = onContext('resolve', tsGraph.resolve, (h, req) => h.resolve(req) as tsGraph.Resolution)
export const damageFlags = onContext('damageFlags', tsGraph.damageFlags,
  (h, dmgType) => h.damageFlags(dmgType) as { resist: boolean; vuln: boolean; immune: boolean })
export const immuneTo = (ctx: tsGraph.GraphContext, name: string): boolean => damageFlags(ctx, name).immune
export const suppressedEffects = onContext('suppressedEffects', tsGraph.suppressedEffects,
  (h, character) => new Set(h.suppressedEffects(character) as string[]))

const stale = onContext('staleArmed', tsGraph.staleArmed as (c: tsGraph.GraphContext, s: ts.ExprScope | undefined) => string[],
  (h, scope) => h.staleArmed(scope) as string[])
export const staleArmed = (ctx: tsGraph.GraphContext, scope?: ts.ExprScope) => stale(ctx, scope)

type Affecting = ReturnType<typeof tsGraph.affectedBy>
const affecting = onContext('affectedBy', tsGraph.affectedBy as (c: tsGraph.GraphContext, t: tsGraph.Gid, tags: string[]) => Affecting,
  (h, target, tags) => h.affectedBy(target, tags) as Affecting)
export const affectedBy = (ctx: tsGraph.GraphContext, target: tsGraph.Gid, tags: string[] = []) => affecting(ctx, target, tags)
