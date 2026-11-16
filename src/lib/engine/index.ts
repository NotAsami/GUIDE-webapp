/**
 * THE ENGINE, as the rest of the app sees it.
 *
 * The rules engine is Rust (`engine/`), compiled to WebAssembly
 * (packages/engine-wasm). This file holds no rules: it loads the module, gives
 * its functions the types the app uses, hands it randomness, and keeps one
 * converted copy of each character and catalog so they cross the boundary once.
 *
 * Every function is SYNCHRONOUS: the engine runs inside render. The one async
 * step is `initEngine`, awaited once at boot before anything renders.
 */
import init, * as wasm from '../../../packages/engine-wasm/engine.js'
import type {
  ArmedMod, CharacterRow, EffectDef, EffectiveSheet, Feature, GraphEffect, ItemEffects, Mod, ShardTree, VarDef,
} from '../database.types.ts'
import type {
  ActiveSource, Affecting, AuditItem, AuditedNode, AuthoredNode, ExprScope, FormulaValue, Gid, GidKind, GidSource,
  GraphContext, IndexedEffect, Resolution, ResolveReq, RolledDie, RolledResolution, VarBinding,
} from './types.ts'

export * from './types.ts'

/** Load the engine. Awaited once, at boot. */
export async function initEngine(): Promise<void> {
  await init({ module_or_path: new URL('../../../packages/engine-wasm/engine_bg.wasm', import.meta.url) })
}

/** The same, from bytes already in hand — Node (tests, scripts), where there is no fetch of a file. */
export function initEngineSync(bytes: BufferSource): void {
  wasm.initSync({ module: bytes })
}

/** The engine's own constants, for the test that pins the static copies in types.ts to them. */
export const engineConstants = () => wasm.engineConstants()

// --- the expression evaluator ------------------------------------------------------

export const evalExpr: (src: string, scope: ExprScope) => FormulaValue | null = wasm.evalExpr
export const freeIdents: (src: string) => string[] = wasm.freeIdents
export const interpolate: (text: string, scope: ExprScope) => { text: string; bad: string[] } = wasm.interpolate
export const interpolations: (text: string) => string[] = wasm.interpolations
export const hasIdent: (featureName: string) => string = wasm.hasIdent
export const isHasIdent: (id: string) => boolean = wasm.isHasIdent

// --- dice ----------------------------------------------------------------------------
//
// The engine is handed its randomness rather than generating it: `Math.random`,
// read at call time so a test that replaces it is still obeyed.

const random = () => Math.random()

export const parseDice: (expr: string) => { count: number; sides: number; mod: number } | null = wasm.parseDice
export const rollDice = (count: number, sides: number): number[] => wasm.rollDice(count, sides, random)
export const rolledDice = (count: number, sides: number): RolledDie[] => wasm.rolledDice(count, sides, random)
export const rerollDie = (d: RolledDie): RolledDie => wasm.rerollDie(d, random)
export const rollHeal = (amount: number | string): { total: number; breakdown: string } => wasm.rollHeal(amount, random)
export const rolledDiceTerms = (exprs: string[], double = false): RolledDie[] => wasm.rolledDiceTerms(exprs, double, random)

// --- the sheet layer -------------------------------------------------------------------
//
// Character data crosses the boundary as plain values, so the engine's functions
// are untyped at the edge; the casts below give them the app's types.

type Trees = Record<string, ShardTree>
/** One shared default, so an omitted catalog is the SAME object on every call. */
const NO_TREES: Trees = {}

/**
 * ONE CHARACTER, HELD. Copying a character into the engine costs about a
 * millisecond, and the app asks a dozen questions about one per render — so each
 * character object is converted ONCE, kept in WebAssembly memory, and asked
 * from there. Answers are remembered too: the same character object always
 * gives the same answer.
 *
 * Keyed on IDENTITY, weakly. A character row is immutable state — an edit makes
 * a new object, which is a new entry, and the old one is collected with its
 * row. Code that mutates a row in place and asks again gets the first answer.
 */
type Held = { view: wasm.CharacterView; answers: Map<string, Map<unknown, unknown>> }
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

/** A question about one character, answered once per character object and frozen.
 *  `extra` is the one further argument a few of them take, and is part of the memo key. */
function ask<X, R>(fn: string, character: CharacterRow, trees: Trees, extra: X, answer: (view: wasm.CharacterView, extra: X) => R): R {
  const h = holding(character, trees)
  let byExtra = h.answers.get(fn)
  if (!byExtra) h.answers.set(fn, byExtra = new Map())
  if (!byExtra.has(extra)) byExtra.set(extra, frozen(answer(h.view, extra)))
  return byExtra.get(extra) as R
}

export const effectiveSheet = (character: CharacterRow, shardTrees: Trees = NO_TREES) =>
  ask('effectiveSheet', character, shardTrees, undefined, v => v.effectiveSheet() as EffectiveSheet)
export const activeSources = (character: CharacterRow, shardTrees: Trees = NO_TREES) =>
  ask('activeSources', character, shardTrees, undefined, v => v.activeSources() as ActiveSource[])
export const carryMultiplier = (character: CharacterRow, shardTrees: Trees = NO_TREES) =>
  ask('carryMultiplier', character, shardTrees, undefined, v => v.carryMultiplier())
export const gearFeatures = (character: CharacterRow) =>
  ask('gearFeatures', character, NO_TREES, undefined, v => v.gearFeatures() as Feature[])
export const shardFeatures = (character: CharacterRow, catalog: Trees) =>
  ask('shardFeatures', character, catalog, undefined, v => v.shardFeatures() as Feature[])
export const currentBurden = (character: CharacterRow) =>
  ask('currentBurden', character, NO_TREES, undefined, v => v.currentBurden())

export const compileEffects = (mods: Mod[], skills?: Pick<EffectDef, 'skillProficiencies' | 'skillExpertise'>[]) =>
  wasm.compileEffects(mods, skills) as ItemEffects | undefined
export const sheetEffects = (graph?: GraphEffect[], scope?: ExprScope) =>
  wasm.sheetEffects(graph, scope) as ItemEffects | undefined

// --- the feature graph -------------------------------------------------------------------

type Types = Record<string, 'num' | 'bool'>
const NO_TYPES: Types = {}
type Scoped = { scope: ExprScope; audit: AuditItem[] }

export const characterVars = (character: CharacterRow, shardTrees: Trees = NO_TREES, catalogTypes: Types = NO_TYPES) =>
  ask('characterVars', character, shardTrees, catalogTypes, (v, k) => v.characterVars(k) as Scoped)
export const baseScope = (character: CharacterRow, shardTrees: Trees = NO_TREES) =>
  ask('baseScope', character, shardTrees, undefined, v => v.baseScope() as ExprScope)

/** What the walk reports is APPENDED to `audit`, when one is handed in. */
export function probeScope(defs: VarDef[] = [], audit?: AuditItem[], catalogTypes: Types = NO_TYPES): ExprScope {
  const out = wasm.probeScope(defs, catalogTypes) as Scoped
  audit?.push(...out.audit)
  return out.scope
}

export const collectVars = (sources: ActiveSource[]) => new Map(wasm.collectVars(sources) as [string, VarBinding][])
export const varCollisions = (decls: { name: string; from: string }[], sev: 'warn' | 'err') =>
  wasm.varCollisions(decls, sev) as AuditItem[]
export const auditVars = (defs: VarDef[], catalogTypes: Types = NO_TYPES) => wasm.auditVars(defs, catalogTypes) as AuditItem[]

/**
 * THE CATALOG, HELD — the same idea as a held character. The editor audits on
 * every keystroke against every authored node; the node list is converted once
 * per list object and kept in the engine, so an audit sends only the node being edited.
 */
const catalogs = new WeakMap<object, WeakMap<object, wasm.Catalog>>()
function catalogOf(nodes: AuthoredNode[], types: Types): wasm.Catalog {
  let byTypes = catalogs.get(nodes)
  if (!byTypes) catalogs.set(nodes, byTypes = new WeakMap())
  let c = byTypes.get(types)
  if (!c) byTypes.set(types, c = wasm.loadCatalog(nodes, types))
  return c
}
const NO_NODES: AuthoredNode[] = []

export const auditNode = (node: AuditedNode, nodes: AuthoredNode[] = NO_NODES, catalogTypes: Types = NO_TYPES) =>
  catalogOf(nodes, catalogTypes).auditNode(node) as AuditItem[]
export const matchCount = (selector: string, nodes: AuthoredNode[]) => catalogOf(nodes, NO_TYPES).matchCount(selector)

export const gid = (kind: GidKind, x: GidSource) => wasm.gid(kind, x) as Gid
export const nodeGid = (shardId: string, nodeId: string) => wasm.nodeGid(shardId, nodeId) as Gid
export const normalizeTag: (raw: string) => string = wasm.normalizeTag
export const askKey: (raw: string) => string = wasm.askKey
export const asKey: (target: string) => string = wasm.asKey
export const reqKeys = (req: ResolveReq): string[] => wasm.reqKeys(req)
export const armedMatches = (m: ArmedMod, req: ResolveReq): boolean => wasm.armedMatches(m, req)
export const total = (res: Resolution) => wasm.total(res) as { flat: number; dice: string[] }
export const rollResolution = (res: Resolution, double = false, ownType?: string) =>
  wasm.rollResolution(res, double, ownType, random) as RolledResolution

/**
 * THE CONTEXT. In the engine it is a handle: the character's graph stays in
 * WebAssembly memory and a roll sends only its request across. Callers see a
 * plain object — `scope`, `armed`, `problems`, and the two index maps — with the
 * handle riding along out of sight.
 *
 * Non-enumerable on purpose: a caller that spreads a context to change part of
 * it (`{ ...ctx, armed }`) gets an object WITHOUT the handle, and the functions
 * below refuse it. A stale handle would answer about a graph the caller no
 * longer holds.
 */
const HANDLE = Symbol('engine.handle')
type Dump = [string, IndexedEffect[]][]

function handleOf(ctx: GraphContext): wasm.GraphContext {
  const handle = (ctx as GraphContext & { [HANDLE]?: wasm.GraphContext })[HANDLE]
  if (!handle) throw new Error('This graph context did not come from buildContext(); build a new one instead of copying.')
  return handle
}

export const buildContext = (character: CharacterRow, shardTrees: Trees = NO_TREES, catalogTypes: Types = NO_TYPES) =>
  ask('buildContext', character, shardTrees, catalogTypes, (v, k): GraphContext => {
    const handle = v.buildContext(k)
    // The index is large and two callers read it, so it is built on first touch.
    let dump: [Dump, Dump] | undefined
    const maps = () => (dump ??= handle.indexDump() as [Dump, Dump])
    const ctx = {
      scope: handle.scope as ExprScope,
      problems: handle.problems as AuditItem[],
      armed: handle.armed as ArmedMod[],
      get index() { return new Map(maps()[0]) },
      get byOwner() { return new Map(maps()[1]) as GraphContext['byOwner'] },
    }
    Object.defineProperty(ctx, HANDLE, { value: handle })
    return ctx
  })

export const resolve = (ctx: GraphContext, req: ResolveReq) => handleOf(ctx).resolve(req) as Resolution
export const damageFlags = (ctx: GraphContext, dmgType: string) =>
  handleOf(ctx).damageFlags(dmgType) as { resist: boolean; vuln: boolean; immune: boolean }
export const immuneTo = (ctx: GraphContext, name: string): boolean => damageFlags(ctx, name).immune
export const suppressedEffects = (ctx: GraphContext, character: CharacterRow) =>
  new Set(handleOf(ctx).suppressedEffects(character) as string[])
export const staleArmed = (ctx: GraphContext, scope?: ExprScope) => handleOf(ctx).staleArmed(scope) as string[]
export const affectedBy = (ctx: GraphContext, target: Gid, tags: string[] = []) =>
  handleOf(ctx).affectedBy(target, tags) as Affecting
