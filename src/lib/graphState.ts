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
  ArmedMod, CharacterRow, Feature, GraphEffect, GraphState, Json, ShardTree, VarDef,
} from './database.types.ts'
import { evalExpr } from './expr.ts'
import type { GraphContext, ResolveReq } from './graph.ts'
import { armedMatches, asKey, gid, reqKeys, staleArmed } from './graph.ts'
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
  scope: VarScope = 'player',
): Record<string, Json> {
  // Nothing to write: hand back exactly what came in, so a character with no
  // variables never grows an empty `graph` key just for having rested.
  if (!Object.keys(next).length) return resources ?? {}
  const g = ((resources as { graph?: GraphState } | undefined)?.graph ?? {})
  const key = bucket(scope)
  return {
    ...resources,
    graph: { ...g, [key]: { ...g[key], ...next } },
  } as Record<string, Json>
}

/** The common case: variable writes against a character's current resources. */
export const setVars = (character: CharacterRow, next: Record<string, number | boolean>) =>
  withVars(character.resources, next)

/** The DM's half. Only a `dm_users` session may land this — migration 0015's
 *  trigger reverts it otherwise — which is the point of §31: the bucket a value
 *  lives in IS the permission, because RLS is row-level and cannot guard a JSON
 *  path. Nothing wrote this bucket until the console got a panel. */
export const setDmVars = (character: CharacterRow, next: Record<string, number | boolean>) =>
  withVars(character.resources, next, 'dm')

/** Every stored variable a player may write, with its current value. Reads the
 *  ACTIVE set, so an unequipped item's variables are absent exactly as its
 *  features are. */
export type VarScope = 'player' | 'dm'
export type VarRow = { def: VarDef; from: ActiveSource; value: number | boolean }

const bucket = (scope: VarScope): 'vars' | 'dmVars' => (scope === 'dm' ? 'dmVars' : 'vars')

/** Every stored variable of one SCOPE, with its current value.
 *
 *  One walk, both buckets. The player's screen and the DM's console want the
 *  same list filtered the opposite way, and two copies of this would be two
 *  places for the §31 split to drift — the whole point being that which bucket a
 *  value lives in is who may write it. Reading the right bucket falls out of the
 *  same argument that decides the filter. */
export function scopedVars(
  character: CharacterRow,
  scope: VarScope,
  shardTrees: Record<string, ShardTree> = {},
): VarRow[] {
  const g = state(character)
  const store = g[bucket(scope)]
  const out: VarRow[] = []
  const seen = new Set<string>()
  for (const from of activeSources(character, shardTrees)) {
    const defs = 'vars' in from.obj ? from.obj.vars ?? [] : []
    for (const def of defs) {
      // First wins, matching collectVars — the collision itself is reported by
      // characterVars, not re-reported here. `seen` spans both scopes so a name
      // declared twice cannot appear once in each list.
      if (def.kind !== 'stored' || seen.has(def.name)) continue
      seen.add(def.name)
      if ((def.scope === 'dm') !== (scope === 'dm')) continue
      out.push({ def, from, value: store?.[def.name] ?? def.initial ?? zero(def.type) })
    }
  }
  return out
}

/** Every stored variable the PLAYER may write. */
export const playerVars = (character: CharacterRow, shardTrees: Record<string, ShardTree> = {}) =>
  scopedVars(character, 'player', shardTrees)

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
export function armedFrom(eff: GraphEffect, source: string, sourceName?: string, at = Date.now()): ArmedMod[] {
  const base = {
    source, sourceName, label: eff.label, op: eff.op, value: eff.value, dmgType: eff.dmgType, at,
    // An asked arm is OFFERED, not taken — the question rides along and the roll
    // panel is what asks it. See ArmedMod.ask.
    ...(eff.ask ? { ask: eff.ask, text: eff.text || eff.label } : {}),
  }
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
  /** `name` is display only, carried onto an armed modifier so the roll panel
   *  can say "Sacred Flame" rather than `spell:<uuid>`. */
  feature: { name?: string; vars?: VarDef[]; graph?: GraphEffect[] },
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
      for (const mod of armedFrom(eff, source, feature.name)) {
        /* NO `ask` ON THE OUTCOME, deliberately, when the effect carries one.
           The confirm sheet's checkboxes decide what this press WRITES; an asked
           arm's question is not about the press at all — it is about a roll that
           has not happened. Passing it here is what pre-ticked both of Brutal
           Strike's blows and armed them together. Offering it is unconditional;
           the choosing happens in the roll panel. */
        out.push({
          kind: 'arm', eff, ask: eff.ask ? undefined : eff.ask, mod,
          summary: eff.ask
            ? `${eff.label} offered · your call on the next ${mod.sub ? `${mod.kind} ${mod.sub}` : mod.kind}`
            : `${eff.label} armed${mod.value ? ` (${mod.value})` : ''} · next ${mod.sub ? `${mod.kind} ${mod.sub}` : mod.kind}`,
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

/** Drop armed modifiers — §8 #1's consumption tap. Only the player knows
 *  whether the attack resolved, so this is never called by a roll.
 *
 *  Takes a LIST because an exclusive choice spends as one: taking Forceful Blow
 *  does not leave Hamstring Blow armed for the next swing, and clearing them in
 *  two writes could land apart and leave half a choice in the queue. */
export const consumeArmed = (character: CharacterRow, ids: string | string[]): Record<string, Json> => {
  const g = state(character)
  const drop = new Set(Array.isArray(ids) ? ids : [ids])
  return {
    ...(character.resources ?? {}),
    graph: { ...g, armed: (g.armed ?? []).filter(m => !drop.has(m.id)) },
  } as Record<string, Json>
}

/* ---------- rest ---------- */

/** WOULD ACTIVATING THIS PUT A CONTRIBUTION ON THIS ROLL, by way of a variable?
 *
 *  The other half of an offer, and the half nothing could see. An ARM announces
 *  its target — `armedMatches` reads it straight off the mod. A STANCE does not:
 *  Reckless Attack writes `recklessAttack = true`, and it is a SECOND effect,
 *  gated `when: recklessAttack`, that grants the advantage. Nothing in the
 *  activation names the roll, so the weapon card could never offer it and the
 *  only way to hold a stance was the Features screen.
 *
 *  Answered exactly rather than by guessing at the text: apply the writes this
 *  press would make to a copy of the scope, then ask which of the feature's own
 *  gated contributions flip from false to true AND target this roll. No second
 *  resolve, no re-indexing — the feature's own effects are the whole search.
 *
 *  Scoped to the feature's OWN effects on purpose. A feature gated on someone
 *  else's variable (Brutal Strike reads Reckless Attack's) is not this feature's
 *  offer to make — it has its own activation, and offering both as one press
 *  would spend two uses on one tap.
 *  ponytail: same-feature scan; widen only if a real feature needs cross-node
 *  gating surfaced, which would mean re-resolving per candidate. */
function stanceReaches(
  feature: Feature, ctx: GraphContext, character: CharacterRow, req: ResolveReq, source: string,
): boolean {
  const writes = planActivation(feature, ctx, character, source).filter(o => o.kind === 'var')
  if (!writes.length) return false
  const after = { ...ctx.scope }
  for (const o of writes) {
    after[o.def.name] = o.delta !== undefined
      ? (typeof o.current === 'number' ? o.current : 0) + o.delta
      : o.set as number | boolean
  }
  const keys = new Set(reqKeys(req))
  for (const eff of feature.graph ?? []) {
    if (eff.when === undefined) continue
    // Already applying — activating changes nothing about this roll, and an
    // offer to turn on what is already on is the bug §16 warns about one level
    // up: a control that costs a use and buys nothing.
    const now = evalExpr(eff.when, ctx.scope)
    if (now !== null && now.t === 'bool' && now.v) continue
    const then = evalExpr(eff.when, after)
    if (then === null || then.t !== 'bool' || !then.v) continue
    // A targetless effect is this NODE's own roll, never the weapon's.
    const targets = eff.target ?? []
    if (targets.some(t => keys.has(asKey(t)))) return true
  }
  return false
}

/** Features worth offering before THIS roll, and what pressing one would do.
 *
 *  §16's visibility rule, one step earlier: a bonus you have armed and cannot see
 *  is worse than no bonus, and a bonus you COULD arm that the roll surface never
 *  mentions is one you will forget exists. Arming is a pre-roll decision, so
 *  making the player leave the weapon, find the feature, press Use and come back
 *  puts the decision on a different screen from the roll.
 *
 *  TWO KINDS, and they are not interchangeable. An `arm` mints a pending
 *  contribution and is spent when it lands; a `stance` flips a variable the
 *  player HOLDS until something clears it. Reported separately because the
 *  surface has to say which — "armed for your next attack" and "held until your
 *  next turn" are different promises.
 *
 *  Routed through planActivation rather than reading `once` directly, so `when`
 *  gating, DM-variable refusal and every other rule are honoured once. A feature
 *  already holding an armed entry is NOT offered: re-arming would refresh it and
 *  quietly spend a second use for nothing. */
export function armableFor(
  character: CharacterRow,
  ctx: GraphContext,
  req: ResolveReq,
  shardTrees: Record<string, ShardTree> = {},
): { feature: Feature; source: string; kind: 'arm' | 'stance' }[] {
  const out: { feature: Feature; source: string; kind: 'arm' | 'stance' }[] = []
  for (const s of activeSources(character, shardTrees)) {
    if (s.kind !== 'feature') continue
    const feature = s.obj
    if (feature.uses && feature.uses.current <= 0) continue
    const source = gid('feature', feature)
    if (ctx.armed.some(m => m.source === source)) continue
    const arms = planActivation(feature, ctx, character, source)
      .some(o => o.kind === 'arm' && armedMatches(o.mod, req))
    if (arms) { out.push({ feature, source, kind: 'arm' }); continue }
    if (stanceReaches(feature, ctx, character, req, source)) out.push({ feature, source, kind: 'stance' })
  }
  return out
}

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
    // 'turn' is Advance Turn's business, not a rest's. A var that clears every
    // turn has nothing left for a rest to clear, and folding it in here would
    // make the rest toast claim credit for state that was already gone.
    if (def.resetOn === 'turn') continue
    if (def.resetOn === 'long' && kind === 'short') continue
    out[def.name] = def.initial ?? zero(def.type)
  }
  return out
}

/* ---------- turn ---------- */

/**
 * Variables the START OF YOUR NEXT TURN returns to their initial value.
 *
 * The whole 5e family of "until the start of your next turn" — Reckless Attack
 * is the one that forced it. Deliberately the same shape as `restVars` above:
 * the same `resetOn` field, the same ACTIVE-set scoping, the same "initial, or
 * the type's zero". A second mechanism for the same idea is how a var would
 * come to reset on a rest and not on a turn.
 */
export function turnVars(
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const { def } of playerVars(character, shardTrees)) {
    if (def.resetOn !== 'turn') continue
    out[def.name] = def.initial ?? zero(def.type)
  }
  return out
}

/**
 * Everything the start of your next turn does to `resources.graph`, as ONE
 * patch: the variables that reset, and the arms those variables authorised.
 *
 * ORDER IS THE WHOLE POINT and it is why this is a function rather than two
 * calls at the caller. The variables reset FIRST, then the gates are tested
 * against the scope that reset produced — do it the other way round and
 * `reckless` is still true when `staleArmed` looks, so a Brutal Strike armed
 * under it survives the turn that ended it. Nothing about that failure is
 * visible: the arm simply fires next turn as if it were still owed.
 *
 * Returns null when nothing changed, so Advance Turn skips the write and the
 * report line rather than growing an empty `graph` key for having happened —
 * the same shape `restVarPatch` already uses.
 */
export function turnGraphPatch(
  character: CharacterRow,
  ctx: GraphContext,
  shardTrees: Record<string, ShardTree> = {},
): { resources: Record<string, Json>; vars: string[]; disarmed: string[] } | null {
  const vars = turnVars(character, shardTrees)
  const names = Object.keys(vars)

  const g = state(character)
  const nextScope = { ...ctx.scope, ...vars }
  const stale = new Set(staleArmed(ctx, nextScope))
  const keptArmed = (g.armed ?? []).filter(m => !stale.has(m.id))
  const disarmed = (g.armed ?? []).filter(m => stale.has(m.id)).map(m => m.label)

  if (!names.length && !disarmed.length) return null
  return {
    resources: {
      ...(character.resources ?? {}),
      graph: { ...g, vars: { ...(g.vars ?? {}), ...vars }, armed: keptArmed },
    } as Record<string, Json>,
    vars: names,
    disarmed,
  }
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
