/**
 * The ONLY writer of `resources.graph`.
 *
 * Every function here returns a PATCH rather than performing a write, for two
 * reasons: it composes with `updateSection`/`updateSections`, and it lets one
 * activation batch several changes into a single round trip. Using a feature
 * already writes `sheet` (rolling, spending a use); its variable writes join
 * that same write instead of racing it.
 *
 * WHICH BUCKET IS A PERMISSION. `vars` is player-writable; `dmVars` is not, and
 * migration 0015's `guard_dm_vars` trigger reverts any non-DM change to it. A
 * player-side write aimed at a DM variable is therefore refused HERE, loudly,
 * rather than sent and silently undone by the database — a write that appears to
 * work and doesn't is the worst shape available.
 */
import type {
  ActiveSource,
} from './effects.ts'
import { activeSources } from './effects.ts'
import type {
  ArmedMod, CharacterRow, GraphEffect, GraphState, Json, ShardTree, VarDef,
} from './database.types.ts'
import { evalExpr } from './expr.ts'
import type { GraphContext } from './graph.ts'
import { IS_ACTIVATION } from './opSchema.ts'

const state = (character: CharacterRow): GraphState =>
  ((character.resources as { graph?: GraphState } | undefined)?.graph ?? {})

const zero = (t: 'num' | 'bool' | undefined) => (t === 'bool' ? false : 0)

/** Merge variable writes into an ALREADY-BUILT `resources` object, leaving every
 *  other key (`activeEffects`, `exhaustion`, `deathSaves`) exactly as it was —
 *  they share one JSONB blob, and a patch that rebuilt it would drop them.
 *
 *  Takes the object rather than the character so a caller composing several
 *  changes (rest.ts clears effects AND resets variables) folds them into ONE
 *  patch instead of two writes that could land apart. */
export function withVars(
  resources: Record<string, Json> | undefined,
  next: Record<string, number | boolean>,
): Record<string, Json> {
  // Nothing to write: hand back exactly what came in, so a character with no
  // variables never grows an empty `graph` key just for having rested.
  if (!Object.keys(next).length) return resources ?? {}
  const g = ((resources as { graph?: GraphState } | undefined)?.graph ?? {})
  return {
    ...resources,
    graph: { ...g, vars: { ...g.vars, ...next } },
  } as Record<string, Json>
}

/** The common case: variable writes against a character's current resources. */
export const setVars = (character: CharacterRow, next: Record<string, number | boolean>) =>
  withVars(character.resources, next)

/** Every stored variable a player may write, with its current value. Reads the
 *  ACTIVE set, so an unequipped item's variables are absent exactly as its
 *  features are. */
export function playerVars(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
): { def: VarDef; from: ActiveSource; value: number | boolean }[] {
  const g = state(character)
  const out: { def: VarDef; from: ActiveSource; value: number | boolean }[] = []
  const seen = new Set<string>()
  for (const from of activeSources(character, shardTrees)) {
    const defs = 'vars' in from.obj ? from.obj.vars ?? [] : []
    for (const def of defs) {
      // First wins, matching collectVars — the collision itself is reported by
      // characterVars, not re-reported here.
      if (def.kind !== 'stored' || def.scope === 'dm' || seen.has(def.name)) continue
      seen.add(def.name)
      out.push({ def, from, value: g.vars?.[def.name] ?? def.initial ?? zero(def.type) })
    }
  }
  return out
}

/* ---------- activation ---------- */

/** One thing pressing Use will do, after `when` has been evaluated but before
 *  the player has answered anything.
 *
 *  TWO KINDS, ONE LIST. A variable write and an armed modifier are the same
 *  thing to everything that reads this — the confirm sheet renders `summary`,
 *  `ask` gates both identically (§32 does not care what is being resolved), and
 *  both land in one `resources` patch. Splitting them into two lists would mean
 *  two confirm sheets and two write paths for one press. */
export type Outcome = VarOutcome | ArmOutcome

type OutcomeBase = {
  eff: GraphEffect
  /** Present only when the author attached one — this is the checkbox label. */
  ask?: string
  /** Human-readable, for the confirm sheet and the toast. */
  summary: string
}

export type VarOutcome = OutcomeBase & {
  kind: 'var'
  /** The variable it writes, resolved against the node's declarations. */
  def: VarDef
  /** The value before this outcome runs. */
  current: number | boolean
  /** `setVar`: the value to store. Mutually exclusive with `delta`. */
  set?: number | boolean
  /** `addVar`: the signed change. Kept as a DELTA rather than a computed result
   *  so that two addVars on one variable stack correctly — a precomputed "next"
   *  would have to be un-applied to combine them. */
  delta?: number
}

/** §16: a `once` contribution does not apply, it ARMS — it waits in
 *  `resources.graph.armed` for the next matching roll. */
export type ArmOutcome = OutcomeBase & {
  kind: 'arm'
  mod: ArmedMod
}

/** The armed modifiers one `once` effect mints, given the node that owns it.
 *
 *  §16 keys the queue by ROLL KIND, so that is what an effect's selectors have to
 *  translate into:
 *
 *    roll:attack        -> { kind: 'attack' }            "your next attack"
 *    roll:save.dex      -> { kind: 'save', sub: 'dex' }
 *    (no target)        -> { kind: 'feature', subject }  this node's own roll
 *
 *  Anything else — a gid, a tag — cannot be expressed as a queue key and is an
 *  authoring error caught by auditNode, not silently dropped here.
 *
 *  One mod per roll selector, with the selector in the id: two selectors are two
 *  independent pending bonuses, and consuming one must not consume the other. */
export function armedFrom(eff: GraphEffect, source: string, at = Date.now()): ArmedMod[] {
  const base = { source, label: eff.label, op: eff.op, value: eff.value, dmgType: eff.dmgType, at }
  const targets = eff.target?.length ? eff.target : []
  if (!targets.length) {
    return [{ ...base, id: `${source}:${eff.id}`, kind: 'feature', subject: source }]
  }
  return targets.flatMap(t => {
    if (!t.startsWith('roll:')) return []
    const [kind, sub] = t.slice(5).split('.')
    return [{ ...base, id: `${source}:${eff.id}:${t}`, kind, ...(sub ? { sub } : {}) }]
  })
}

/** What pressing Use would do, given the character's current state.
 *
 *  `when` is evaluated here and false outcomes are DROPPED — §32 gates existence
 *  with `when` and resolution with `ask`, and the two are orthogonal, so a
 *  `when`-false outcome must not appear as an unticked box the player could
 *  wrongly enable. `ask` outcomes come back listed but undecided. */
export function planActivation(
  feature: { vars?: VarDef[]; graph?: GraphEffect[] },
  ctx: GraphContext,
  character: CharacterRow,
  /** The node's gid — what an armed modifier records as its source, and half of
   *  its identity. Absent means "cannot arm", which is what a caller with no gid
   *  honestly is. */
  source?: string,
): Outcome[] {
  const g = state(character)
  const out: Outcome[] = []

  for (const eff of feature.graph ?? []) {
    // §16: a `once` contribution is not an activation op, but pressing Use is
    // what arms it — so it is planned here, alongside the variable writes, and
    // an `ask` gates it exactly the same way.
    if (eff.once && source) {
      if (eff.when !== undefined) {
        const cond = evalExpr(eff.when, ctx.scope)
        if (cond === null || cond.t !== 'bool' || !cond.v) continue
      }
      for (const mod of armedFrom(eff, source)) {
        out.push({
          kind: 'arm', eff, ask: eff.ask, mod,
          summary: `${eff.label} armed${mod.value ? ` (${mod.value})` : ''} · next ${mod.sub ? `${mod.kind} ${mod.sub}` : mod.kind}`,
        })
      }
      continue
    }
    if (!IS_ACTIVATION(eff.op)) continue
    const def = (feature.vars ?? []).find(v => v.name === eff.variable)
    // auditNode blocks all three of these at author time; a granted snapshot
    // could still predate the rule, so skipping beats writing nonsense.
    if (!def || def.kind !== 'stored' || def.scope === 'dm') continue

    if (eff.when !== undefined) {
      const cond = evalExpr(eff.when, ctx.scope)
      if (cond === null || cond.t !== 'bool' || !cond.v) continue
    }

    const v = evalExpr(eff.value ?? '', ctx.scope)
    if (v === null || v.t === 'arr' || (v.t === 'num' && v.dice.length)) continue

    const current = g.vars?.[def.name] ?? def.initial ?? zero(def.type)
    const name = def.label ?? def.name

    if (eff.op === 'addVar') {
      if (v.t !== 'num' || typeof current !== 'number' || def.type !== 'num') continue
      out.push({
        kind: 'var', eff, def, ask: eff.ask, current, delta: v.flat,
        summary: `${name} ${v.flat < 0 ? '−' : '+'}${Math.abs(v.flat)} → ${current + v.flat}`,
      })
      continue
    }

    // §25's strings are prose, not state — an activation cannot store one.
    if (v.t === 'str') continue
    const set = v.t === 'bool' ? v.v : v.flat
    // A stored variable's declared type is load-bearing everywhere else; do not
    // let an activation be the one place it drifts.
    if (def.type === 'bool' && typeof set !== 'boolean') continue
    if (def.type === 'num' && typeof set !== 'number') continue
    out.push({ kind: 'var', eff, def, ask: eff.ask, current, set, summary: `${name} → ${set}` })
  }
  return out
}

/** Fold the outcomes the player accepted into one `resources` patch.
 *
 *  `answers` holds the ticked `ask` labels. An outcome with no `ask` is not
 *  optional — the author said it happens, so it is not in the player's gift. */
export function applyOutcomes(
  character: CharacterRow,
  outcomes: Outcome[],
  answers: Set<string>,
): { resources: Record<string, Json>; applied: Outcome[] } {
  const applied = outcomes.filter(o => !o.ask || answers.has(o.ask))
  const next: Record<string, number | boolean> = {}
  for (const o of applied) {
    if (o.kind !== 'var') continue
    // Each outcome builds on what the previous ones in this batch decided, so
    // two addVars on one variable stack instead of the second overwriting the
    // first.
    const base = next[o.def.name] ?? o.current
    next[o.def.name] = o.delta !== undefined
      ? (typeof base === 'number' ? base : 0) + o.delta
      : o.set as number | boolean
  }

  // ONE resources object, not two writes. The variable half and the armed half
  // of a single press must land together or not at all — §16's Lifetime note
  // makes the same argument about rests.
  const arms = applied.filter((o): o is ArmOutcome => o.kind === 'arm').map(o => o.mod)
  return { resources: withArmed(setVars(character, next), arms), applied }
}

/** Merge armed modifiers into an already-built `resources` object.
 *
 *  REFRESH, DON'T STACK: keyed by `mod.id`, which is `source:effect[:selector]`,
 *  so arming the same effect twice replaces the pending entry and updates its
 *  timestamp. A double-tap that silently doubled the next roll is precisely the
 *  failure the roll panel exists to prevent — and a player who genuinely wants
 *  two pending bonuses wants them from two different effects. */
export function withArmed(
  resources: Record<string, Json> | undefined,
  mods: ArmedMod[],
): Record<string, Json> {
  if (!mods.length) return resources ?? {}
  const g = ((resources as { graph?: GraphState } | undefined)?.graph ?? {})
  const byId = new Map((g.armed ?? []).map(m => [m.id, m]))
  for (const m of mods) byId.set(m.id, m)
  return { ...resources, graph: { ...g, armed: [...byId.values()] } } as Record<string, Json>
}

/** Empty the armed queue, as part of an already-built `resources` object.
 *
 *  Lives here because this module is the only writer of `resources.graph`, and
 *  takes the object rather than the character so a rest folds it into the SAME
 *  patch that clears `activeEffects` — §16's Lifetime note is explicit that a
 *  second write path is what lets the two drift.
 *
 *  A character with nothing armed comes back untouched, so resting never grows
 *  an empty `graph` key just for having happened. */
export function withArmedCleared(resources: Record<string, Json> | undefined): Record<string, Json> {
  const g = ((resources as { graph?: GraphState } | undefined)?.graph ?? {})
  if (!g.armed?.length) return resources ?? {}
  return { ...resources, graph: { ...g, armed: [] } } as Record<string, Json>
}

/** Drop one armed modifier — §8 #1's consumption tap. Only the player knows
 *  whether the attack resolved, so this is never called by a roll. */
export const consumeArmed = (character: CharacterRow, id: string): Record<string, Json> => {
  const g = state(character)
  return {
    ...(character.resources ?? {}),
    graph: { ...g, armed: (g.armed ?? []).filter(m => m.id !== id) },
  } as Record<string, Json>
}

/* ---------- rest ---------- */

/** Variables a rest returns to their initial value.
 *
 *  Reads `resetOn` off every VarDef on the ACTIVE set, so an unequipped item's
 *  variables are left alone — the same scoping rule §15 gives features, arriving
 *  here for free rather than being re-invented.
 *
 *  A long rest includes every short-rest benefit, matching how longRestPatch
 *  already treats pact slots. */
export function restVars(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
  kind: 'short' | 'long',
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const { def } of playerVars(character, shardTrees)) {
    if (!def.resetOn) continue
    if (def.resetOn === 'long' && kind === 'short') continue
    out[def.name] = def.initial ?? zero(def.type)
  }
  return out
}

/** Convenience for the two rest paths: the `resources` patch, or null when
 *  nothing resets — so a caller can skip the write and the toast line cleanly,
 *  the same shape pactShortRestPatch already uses. */
export function restVarPatch(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
  kind: 'short' | 'long',
): { vars: Record<string, number | boolean>; count: number } {
  const vars = restVars(character, shardTrees, kind)
  return { vars, count: Object.keys(vars).length }
}
