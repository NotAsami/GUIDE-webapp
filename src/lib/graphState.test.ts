// Run: node --test src/lib/graphState.test.ts
//
// Everything here is pure: each function returns a PATCH rather than writing, so
// the whole write path is testable without a database or a renderer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, VarDef } from './database.types.ts'
import { buildContext } from './graph.ts'
import { longRestPatch, shortRestPatch } from './rest.ts'
import {
  applyOutcomes, armableFor, consumeArmed, planActivation, playerVars, restVars, setVars, withArmedCleared,
} from './graphState.ts'

const VARS: VarDef[] = [
  { name: 'isRaging', kind: 'stored', type: 'bool', initial: false, resetOn: 'long' },
  { name: 'charges', kind: 'stored', type: 'num', initial: 3, resetOn: 'short' },
  { name: 'legacy', kind: 'stored', type: 'num', initial: 9 },
  { name: 'mercy', kind: 'stored', type: 'num', scope: 'dm' },
  { name: 'doubled', kind: 'derived', formula: 'charges * 2' },
]

const RAGE = (graph: GraphEffect[] = []): Feature =>
  ({ id: 'rage', name: 'Rage', vars: VARS, graph })

function character(over: Partial<CharacterRow> = {}, graph: object = {}): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'T', identity: { level: 5 },
    sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features: [RAGE()] },
    resources: { exhaustion: 2, activeEffects: [{ id: 'e1' }], graph },
    inventory: [], equipped: {}, shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
    ...over,
  } as unknown as CharacterRow
}

test('setVars merges into resources without disturbing the rest of the blob', () => {
  // resources is ONE jsonb column shared with death saves, exhaustion and
  // effects. A patch that rebuilt it would silently drop them.
  const next = setVars(character({}, { vars: { charges: 3 }, dmVars: { mercy: 12 } }), { isRaging: true })
  assert.equal(next.exhaustion, 2)
  assert.deepEqual(next.activeEffects, [{ id: 'e1' }])
  assert.deepEqual(next.graph, { vars: { charges: 3, isRaging: true }, dmVars: { mercy: 12 } })
})

test('setVars never touches dmVars', () => {
  // The database would revert it anyway (migration 0015), but a client that
  // sends a doomed write is a client that looks like it worked.
  const next = setVars(character({}, { dmVars: { mercy: 12 } }), { isRaging: true }) as
    { graph: { vars: Record<string, unknown>; dmVars: Record<string, unknown> } }
  assert.deepEqual(next.graph.dmVars, { mercy: 12 })
  assert.equal('mercy' in next.graph.vars, false)
})

test('playerVars lists stored player variables only, with current values', () => {
  const list = playerVars(character({}, { vars: { charges: 1 } }))
  const names = list.map(v => v.def.name)
  assert.deepEqual(names, ['isRaging', 'charges', 'legacy'])   // no dm, no derived
  assert.equal(list.find(v => v.def.name === 'charges')!.value, 1)      // stored wins
  assert.equal(list.find(v => v.def.name === 'legacy')!.value, 9)       // else initial
  assert.equal(list.find(v => v.def.name === 'isRaging')!.value, false) // else the type's zero
})

test('a variable on an UNEQUIPPED item is not listed and does not reset', () => {
  // §15's scoping rule, arriving through a new code path. An item in the pack
  // must not be resettable, or a rest would silently edit gear you are not using.
  const item = { id: 'i1', name: 'Wand', slot: 'cloak', vars: [{ name: 'stowed', kind: 'stored', type: 'num', initial: 4, resetOn: 'short' }] }
  const carried = character({ inventory: [item], sheet: { features: [] } } as Partial<CharacterRow>)
  const worn = character({ equipped: { cloak: item }, sheet: { features: [] } } as Partial<CharacterRow>)
  assert.equal(playerVars(carried).some(v => v.def.name === 'stowed'), false)
  assert.equal(playerVars(worn).some(v => v.def.name === 'stowed'), true)
  assert.deepEqual(restVars(carried, {}, 'short'), {})
  assert.deepEqual(restVars(worn, {}, 'short'), { stowed: 4 })
})

test('restVars honours resetOn, and a long rest includes the short-rest ones', () => {
  const c = character({}, { vars: { isRaging: true, charges: 0, legacy: 1 } })
  // 'short' resets only short-rest variables.
  assert.deepEqual(restVars(c, {}, 'short'), { charges: 3 })
  // 'long' includes them, because a long rest grants every short-rest benefit —
  // the same rule longRestPatch already applies to pact slots.
  assert.deepEqual(restVars(c, {}, 'long'), { isRaging: false, charges: 3 })
  // `legacy` has no resetOn and is never touched by either.
})

// --- activation --------------------------------------------------------------

const plan = (graph: GraphEffect[], stored: Record<string, number | boolean> = {}) => {
  const c = character({ sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features: [RAGE(graph)] } } as Partial<CharacterRow>, { vars: stored })
  return { c, outcomes: planActivation(RAGE(graph), buildContext(c), c) }
}

test('setVar plans a write, and applying it produces one patch', () => {
  const { c, outcomes } = plan([{ id: 'a1', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Enter rage' }])
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].set, true)
  const { resources } = applyOutcomes(c, outcomes, new Set())
  assert.deepEqual((resources as { graph: { vars: unknown } }).graph.vars, { isRaging: true })
})

test('addVar is planned as a DELTA, so two of them stack', () => {
  // A precomputed "next" would have to be un-applied to combine them; keeping the
  // delta means the second outcome builds on the first.
  const { c, outcomes } = plan([
    { id: 'a1', op: 'addVar', variable: 'charges', value: '-1', label: 'Spend' },
    { id: 'a2', op: 'addVar', variable: 'charges', value: '-1', label: 'Spend again' },
  ], { charges: 3 })
  assert.deepEqual(outcomes.map(o => o.delta), [-1, -1])
  const { resources } = applyOutcomes(c, outcomes, new Set())
  assert.deepEqual((resources as { graph: { vars: unknown } }).graph.vars, { charges: 1 })
})

test('a when-false outcome never appears — it is not an unticked box', () => {
  // §32: `when` gates EXISTENCE, `ask` gates RESOLUTION. Surfacing a when-false
  // outcome as an unticked checkbox would let the player enable something the
  // author said does not apply.
  const gate = (when: string) => plan([{ id: 'a1', op: 'setVar', variable: 'isRaging', value: 'true', when, label: 'Rage' }]).outcomes
  assert.equal(gate('charges > 0').length, 1)
  assert.equal(gate('charges > 99').length, 0)
})

test('an ask outcome is listed but applies only when answered', () => {
  const { c, outcomes } = plan([
    { id: 'a1', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Enter rage' },
    { id: 'a2', op: 'addVar', variable: 'charges', value: '-1', ask: 'Spend a charge?', label: 'Spend' },
  ], { charges: 3 })
  assert.deepEqual(outcomes.map(o => o.ask), [undefined, 'Spend a charge?'])

  // Unanswered: the un-asked outcome still fires. The author said it happens, so
  // it is not in the player's gift. `charges` stays 3 — untouched, not reset,
  // which also proves the patch carries the whole map rather than only the delta.
  const no = applyOutcomes(c, outcomes, new Set())
  assert.deepEqual((no.resources as { graph: { vars: unknown } }).graph.vars, { charges: 3, isRaging: true })
  assert.equal(no.applied.length, 1)

  const yes = applyOutcomes(c, outcomes, new Set(['Spend a charge?']))
  assert.deepEqual((yes.resources as { graph: { vars: unknown } }).graph.vars, { isRaging: true, charges: 2 })
})

test('an activation refuses to write a DM variable or a derived one', () => {
  // auditNode blocks both at author time; this is the runtime half, because a
  // granted snapshot can predate the rule. Migration 0015 would revert the dm
  // write anyway — silently, which is exactly what must not reach a table.
  assert.equal(plan([{ id: 'a1', op: 'setVar', variable: 'mercy', value: '5', label: 'X' }]).outcomes.length, 0)
  assert.equal(plan([{ id: 'a1', op: 'setVar', variable: 'doubled', value: '5', label: 'X' }]).outcomes.length, 0)
  assert.equal(plan([{ id: 'a1', op: 'setVar', variable: 'nope', value: '5', label: 'X' }]).outcomes.length, 0)
})

test('a type mismatch is refused rather than stored', () => {
  // The declared type is load-bearing everywhere else — the audit's probe scope,
  // the runtime zero. An activation must not be the one place it drifts.
  assert.equal(plan([{ id: 'a1', op: 'setVar', variable: 'isRaging', value: '3', label: 'X' }]).outcomes.length, 0)
  assert.equal(plan([{ id: 'a1', op: 'setVar', variable: 'charges', value: 'true', label: 'X' }]).outcomes.length, 0)
})

// --- §16 arming --------------------------------------------------------------

const ONCE: GraphEffect = {
  id: 'e1', op: 'add', value: '1d6', once: true, label: 'Boosted Cut', target: ['roll:attack'],
}

test('pressing Use arms a `once` contribution instead of applying it', () => {
  const c = character({}, {})
  const [o] = planActivation(RAGE([ONCE]), buildContext(c), c, 'feature:rage')
  assert.equal(o.kind, 'arm')
  assert.equal(o.kind === 'arm' && o.mod.kind, 'attack')
  assert.equal(o.kind === 'arm' && o.mod.value, '1d6')
  const { resources } = applyOutcomes(c, [o], new Set())
  const g = resources.graph as { armed: { id: string; kind: string }[] }
  assert.equal(g.armed.length, 1)
  assert.equal(g.armed[0].kind, 'attack')
})

test('arming twice yields ONE entry, refreshed — never two', () => {
  // A double-tap that silently doubled the next roll is the failure the roll
  // panel exists to prevent.
  const c = character({}, {})
  const first = applyOutcomes(c, planActivation(RAGE([ONCE]), buildContext(c), c, 'feature:rage'), new Set())
  const c2 = character({}, first.resources.graph as object)
  const second = applyOutcomes(c2, planActivation(RAGE([ONCE]), buildContext(c2), c2, 'feature:rage'), new Set())
  const g = second.resources.graph as { armed: { id: string; at: number }[] }
  assert.equal(g.armed.length, 1)
  assert.ok(g.armed[0].at >= (first.resources.graph as { armed: { at: number }[] }).armed[0].at)
})

test('an `ask` gates the arming, exactly as it gates a variable write', () => {
  const c = character({}, {})
  const outcomes = planActivation(RAGE([{ ...ONCE, ask: 'spend the charge?' }]), buildContext(c), c, 'feature:rage')
  assert.equal(outcomes[0].ask, 'spend the charge?')
  const declined = applyOutcomes(c, outcomes, new Set())
  assert.equal(declined.applied.length, 0)
  assert.equal((declined.resources.graph as { armed?: unknown[] } | undefined)?.armed, undefined)
  const accepted = applyOutcomes(c, outcomes, new Set(['spend the charge?']))
  assert.equal((accepted.resources.graph as { armed: unknown[] }).armed.length, 1)
})

test('a targetless `once` arms this node\u2019s own roll', () => {
  const c = character({}, {})
  const [o] = planActivation(RAGE([{ ...ONCE, target: undefined }]), buildContext(c), c, 'feature:rage')
  assert.equal(o.kind === 'arm' && o.mod.kind, 'feature')
  assert.equal(o.kind === 'arm' && o.mod.subject, 'feature:rage')
})

test('a caller with no gid cannot arm — it does not guess one', () => {
  const c = character({}, {})
  assert.deepEqual(planActivation(RAGE([ONCE]), buildContext(c), c), [])
})

test('one press writes variables and arms in ONE resources object', () => {
  const c = character({}, {})
  const feature = RAGE([ONCE, { id: 'e2', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Rage' }])
  const { resources } = applyOutcomes(c, planActivation(feature, buildContext(c), c, 'feature:rage'), new Set())
  const g = resources.graph as { vars: Record<string, unknown>; armed: unknown[] }
  assert.equal(g.vars.isRaging, true)
  assert.equal(g.armed.length, 1)
  assert.equal(resources.exhaustion, 2)          // and the rest of the blob survives
})

test('consuming drops exactly one armed modifier', () => {
  const c = character({}, { armed: [{ id: 'a1' }, { id: 'a2' }], vars: { charges: 3 } })
  const next = consumeArmed(c, 'a1')
  const g = next.graph as { armed: { id: string }[]; vars: Record<string, unknown> }
  assert.deepEqual(g.armed.map(m => m.id), ['a2'])
  assert.deepEqual(g.vars, { charges: 3 })
})

test('withArmedCleared leaves a character who armed nothing untouched', () => {
  // Resting must not grow an empty `graph` key just for having happened.
  assert.deepEqual(withArmedCleared({ exhaustion: 1 }), { exhaustion: 1 })
  assert.deepEqual(withArmedCleared(undefined), {})
})

// Rest lives in rest.ts, but what it does to the graph blob is this module's
// contract — and §16 is explicit that a second write path is what lets the
// armed queue and the effects clear drift apart.
test('both rests clear the armed queue, in the same write as the effects', () => {
  const armed = [{ id: 'a1', source: 's', label: 'l', kind: 'attack', op: 'add', at: 1 }]
  const c = character({}, { armed, vars: { charges: 1, isRaging: true } })

  const long = longRestPatch(c).patch.resources as { graph: { armed: unknown[]; vars: Record<string, unknown> }; activeEffects: unknown[] }
  assert.deepEqual(long.graph.armed, [])
  assert.deepEqual(long.activeEffects, [])
  assert.equal(long.graph.vars.isRaging, false)   // and the long-rest variable reset still lands

  const short = shortRestPatch(c, { spend: 0, rolls: [], conMod: 0 }).patch.resources as { graph: { armed: unknown[]; vars: Record<string, unknown> } }
  assert.deepEqual(short.graph.armed, [])
  assert.equal(short.graph.vars.charges, 3)       // resetOn: 'short'
  assert.equal(short.graph.vars.isRaging, true)   // …and a long-rest variable is untouched
})

test('a damage type survives arming — an armed 2d6 radiant is still radiant', () => {
  const c = character({}, {})
  const [o] = planActivation(
    RAGE([{ ...ONCE, dmgType: 'radiant', target: ['roll:damage'] }]), buildContext(c), c, 'feature:rage')
  assert.equal(o.kind === 'arm' && o.mod.dmgType, 'radiant')
})

// --- the pre-roll offer ------------------------------------------------------

/** A character whose feature list is exactly what the test cares about. */
const withF = (features: Feature[], graph: object = {}) =>
  character({ sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features } }, graph)

test('a feature is offered for the roll its `once` effect would arm — and only that one', () => {
  const f: Feature = { id: 'boost', name: 'Boost', graph: [ONCE] }   // targets roll:attack
  const c = withF([f])
  const ctx = buildContext(c)
  assert.deepEqual(armableFor(c, ctx, { kind: 'attack' }).map(a => a.feature.name), ['Boost'])
  assert.deepEqual(armableFor(c, ctx, { kind: 'damage' }), [])
  assert.deepEqual(armableFor(c, ctx, { kind: 'save', sub: 'dex' }), [])
})

test('a spent feature is not offered', () => {
  const f: Feature = { id: 'boost', name: 'Boost', uses: { current: 0, max: 1 }, graph: [ONCE] }
  const c = withF([f])
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'attack' }), [])
})

test('a feature already holding an armed entry is not offered again', () => {
  // Re-arming refreshes, so offering it would quietly spend a second use for
  // nothing — the player would be paying to replace a bonus they already have.
  const f: Feature = { id: 'boost', name: 'Boost', graph: [ONCE] }
  const c = withF([f], { armed: [{ id: 'feature:boost:e1:roll:attack', source: 'feature:boost', label: 'l', kind: 'attack', op: 'add', at: 1 }] })
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'attack' }), [])
})

test('a `when` that is false is not offered — the offer routes through planActivation', () => {
  const f: Feature = {
    id: 'boost', name: 'Boost',
    vars: [{ name: 'ready', kind: 'stored', type: 'bool', initial: false }],
    graph: [{ ...ONCE, when: 'ready' }],
  }
  const off = withF([f], { vars: { ready: false } })
  assert.deepEqual(armableFor(off, buildContext(off), { kind: 'attack' }), [])
  const on = withF([f], { vars: { ready: true } })
  assert.deepEqual(armableFor(on, buildContext(on), { kind: 'attack' }).map(a => a.feature.name), ['Boost'])
})

test('a feature with no `once` effect is never offered', () => {
  const f: Feature = { id: 'plain', name: 'Plain', graph: [{ id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] }] }
  const c = withF([f])
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'attack' }), [])
})
