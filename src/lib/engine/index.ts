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
import type { CharacterRow, EffectDef, EffectiveSheet, Feature, GraphEffect, ItemEffects, Mod, ShardTree } from '../database.types.ts'
import * as tsBurden from '../burden.ts'
import * as tsDice from '../dice.ts'
import * as tsFx from '../effects.ts'
import * as tsMods from '../modEditor.ts'
import * as tsShards from '../shards.ts'
import * as ts from '../expr.ts'
import { attempt, sameOutcome, type Outcome } from './compare.ts'
import { STRICT, engineMode } from './setting.ts'

export type { ExprScope, FormulaValue } from '../expr.ts'
export type { RolledDie } from '../dice.ts'
export type { ActiveSource } from '../effects.ts'

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

const sheet = dispatch('effectiveSheet', tsFx.effectiveSheet as (c: CharacterRow, t: Trees) => EffectiveSheet,
  (c, t) => wasm.effectiveSheet(c, t) as EffectiveSheet)
export const effectiveSheet = (character: CharacterRow, shardTrees: Trees = NO_TREES) => sheet(character, shardTrees)

const sources = dispatch('activeSources', tsFx.activeSources as (c: CharacterRow, t: Trees) => tsFx.ActiveSource[],
  (c, t) => wasm.activeSources(c, t) as tsFx.ActiveSource[])
export const activeSources = (character: CharacterRow, shardTrees: Trees = NO_TREES) => sources(character, shardTrees)

const carry = dispatch('carryMultiplier', tsFx.carryMultiplier as (c: CharacterRow, t: Trees) => number,
  (c, t) => wasm.carryMultiplier(c, t))
export const carryMultiplier = (character: CharacterRow, shardTrees: Trees = NO_TREES) => carry(character, shardTrees)

export const gearFeatures = dispatch('gearFeatures', tsFx.gearFeatures, c => wasm.gearFeatures(c) as Feature[])
export const shardFeatures = dispatch('shardFeatures', tsShards.shardFeatures, (c, t) => wasm.shardFeatures(c, t) as Feature[])
export const currentBurden = dispatch('currentBurden', tsBurden.currentBurden, c => wasm.currentBurden(c))

type Skills = Pick<EffectDef, 'skillProficiencies' | 'skillExpertise'>[]
const compile = dispatch('compileEffects', tsMods.compileEffects as (m: Mod[], s: Skills | undefined) => ItemEffects | undefined,
  (m, s) => wasm.compileEffects(m, s) as ItemEffects | undefined)
export const compileEffects = (mods: Mod[], skills?: Skills) => compile(mods, skills)

const fxOf = dispatch('sheetEffects', tsMods.sheetEffects as (g: GraphEffect[] | undefined, s: ts.ExprScope | undefined) => ItemEffects | undefined,
  (g, s) => wasm.sheetEffects(g, s) as ItemEffects | undefined)
export const sheetEffects = (graph?: GraphEffect[], scope?: ts.ExprScope | undefined) => fxOf(graph, scope)
