// Run: node --test src/lib/graphState.test.ts
//
// Everything here is pure: each function returns a PATCH rather than writing, so
// the whole write path is testable without a database or a renderer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, VarDef } from './database.types.ts'
import { buildContext } from './graph.ts'
import { applyOutcomes, planActivation, playerVars, restVars, setVars } from './graphState.ts'

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
