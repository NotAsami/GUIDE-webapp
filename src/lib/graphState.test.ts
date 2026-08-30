// Run: node --test src/lib/graphState.test.ts
//
// Everything here is pure: each function returns a PATCH rather than writing, so
// the whole write path is testable without a database or a renderer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ArmedMod, CharacterRow, CharacterSpellbook, Feature, GraphEffect, GraphState, Json, VarDef } from './database.types.ts'
import { buildContext, resolve, staleArmed } from './graph.ts'
import { longRestPatch, shortRestPatch } from './rest.ts'
import {
  answerArmed, applyOutcomes, armableFor, attackRolled, consumeArmed, gateOf, planActivation, playerVars, restVars, scopedVars, setDmVars,
  armsSpentBy,
  setVars, slotLadder, slotPatch, turnGraphPatch, turnVars, withArmedCleared,
  armedFrom, armsSpent,
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

test('an armed contribution resolves its BY-LEVEL table, not slot one', () => {
  /* levelFormula() lived only inside resolve(), and a `once` contribution never
     reaches resolve() — it is snapshotted here. So a level table on an armed
     effect silently armed the level-1 value forever: Brutal Strike's 1d10 stayed
     1d10 at level 17, with no error anywhere. A silent wrong number. */
  const tiered: GraphEffect = {
    ...ONCE, value: '1d6',
    byLevel: ['', '', '', '', '', '', '', '', '', '1d10', '', '', '', '', '', '', '', '2d10', '', '', ''],
  }
  const armAt = (level: number) => {
    const c = character({ identity: { level } } as Partial<CharacterRow>, {})
    const [o] = planActivation(RAGE([tiered]), buildContext(c), c, 'feature:rage')
    return o.kind === 'arm' ? o.mod.value : null
  }
  assert.equal(armAt(5), '0', 'below the first filled slot the feature is not online yet')
  assert.equal(armAt(9), '1d10')
  assert.equal(armAt(16), '1d10', 'a sparse table STEPS — an empty slot walks down')
  assert.equal(armAt(17), '2d10')
  // No table = the authored value, untouched.
  const c = character({ identity: { level: 17 } } as Partial<CharacterRow>, {})
  const [plain] = planActivation(RAGE([ONCE]), buildContext(c), c, 'feature:rage')
  assert.equal(plain.kind === 'arm' && plain.mod.value, '1d6')
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

test('an `ask` on a `once` is OFFERED, not asked at activation', () => {
  /* It used to gate the arming, exactly as it gates a variable write — the
     confirm sheet pre-ticked it and Brutal Strike armed both of its blows. A
     blow lands at the end of the attack, so the question belongs to the roll:
     the arm is minted undecided and the panel asks. */
  const c = character({}, {})
  const outcomes = planActivation(RAGE([{ ...ONCE, ask: 'spend the charge?' }]), buildContext(c), c, 'feature:rage')
  assert.equal(outcomes[0].ask, undefined, 'the sheet must not offer it as a checkbox')
  // Declining nothing still arms it — there was nothing to decline here.
  const armed = applyOutcomes(c, outcomes, new Set())
  assert.equal(armed.applied.length, 1)
  const mods = (armed.resources.graph as { armed: { ask?: string; text?: string }[] }).armed
  assert.equal(mods.length, 1)
  assert.equal(mods[0].ask, 'spend the charge?', 'the question travels with the mod')
})

test('a variable write is still gated by its ask — only `once` moved', () => {
  const c = character({}, {})
  const outcomes = planActivation(
    { name: 'Rage', vars: [{ kind: 'stored', name: 'raging', type: 'bool', scope: 'player', initial: false }],
      graph: [{ id: 'v', op: 'setVar', variable: 'raging', value: 'true', label: 'Rage', ask: 'start raging?' }] },
    buildContext(c), c, 'feature:rage',
  )
  assert.equal(outcomes[0].ask, 'start raging?')
  assert.equal(applyOutcomes(c, outcomes, new Set()).applied.length, 0)
  assert.equal(applyOutcomes(c, outcomes, new Set(['start raging?'])).applied.length, 1)
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

// --- §31's split, one walk ---------------------------------------------------

test('scopedVars splits on the bucket, and reads FROM that bucket', () => {
  const c = character({}, { vars: { charges: 1 }, dmVars: { mercy: 12 } })
  assert.deepEqual(scopedVars(c, 'player').map(v => v.def.name).sort(), ['charges', 'isRaging', 'legacy'])
  assert.deepEqual(scopedVars(c, 'dm').map(v => v.def.name), ['mercy'])
  assert.equal(scopedVars(c, 'dm')[0].value, 12)
  assert.equal(scopedVars(c, 'player').find(v => v.def.name === 'charges')!.value, 1)
  // playerVars is the same walk, so it cannot drift from it.
  assert.deepEqual(playerVars(c).map(v => v.def.name), scopedVars(c, 'player').map(v => v.def.name))
})

test('a DM value is not visible in the player bucket, and vice versa', () => {
  // The buckets ARE the permission (§31). A value in the wrong one must read as
  // absent, not as the other one's number.
  const crossed = character({}, { vars: { mercy: 999 }, dmVars: { charges: 999 } })
  assert.equal(scopedVars(crossed, 'dm').find(v => v.def.name === 'mercy')!.value, 0)      // initial, not 999
  assert.equal(scopedVars(crossed, 'player').find(v => v.def.name === 'charges')!.value, 3) // initial, not 999
})

test('setDmVars writes the DM bucket and leaves the player bucket alone', () => {
  const c = character({}, { vars: { charges: 3 }, dmVars: { mercy: 1 } })
  const next = setDmVars(c, { mercy: 18 })
  assert.deepEqual(next.graph, { vars: { charges: 3 }, dmVars: { mercy: 18 } })
  // …and the reverse, which is what migration 0015 actually enforces.
  assert.deepEqual((setVars(c, { charges: 4 }).graph as { dmVars: unknown }).dmVars, { mercy: 1 })
  // The rest of the shared blob survives either way.
  assert.equal(next.exhaustion, 2)
  assert.deepEqual(next.activeEffects, [{ id: 'e1' }])
})

test('the DM\u2019s clear and the player\u2019s consume are the same operation', () => {
  // Card J removes an armed entry with consumeArmed — the function the panel's
  // Consume tap already calls. Two implementations of "drop this entry" is how
  // one of them ends up leaving the queue in a state the other cannot read.
  const c = character({}, { armed: [{ id: 'a1' }, { id: 'a2' }], dmVars: { mercy: 12 } })
  const g = consumeArmed(c, 'a2').graph as { armed: { id: string }[]; dmVars: Record<string, unknown> }
  assert.deepEqual(g.armed.map(m => m.id), ['a1'])
  assert.deepEqual(g.dmVars, { mercy: 12 })   // and the DM bucket is not disturbed
})

test('a spell arms its `once` contribution — planActivation is not feature-shaped', () => {
  // Casting is an activation. A `once` effect on a spell used to be silently
  // dead: resolve() skipped it (correct — it should arm) and nothing armed it,
  // because arming ran only from a feature's Use button.
  const spell = {
    id: 'i1', spell_id: 'cat-flame', name: 'Sacred Flame', level: 0,
    graph: [{ id: 'e1', op: 'add' as const, value: '2d6', dmgType: 'radiant',
              label: 'Sanctified', once: true, target: ['roll:damage.melee'] }],
  }
  const c = character({ spellbook: { spells: [spell] }, sheet: { features: [] } }, {})
  const [o] = planActivation(spell, buildContext(c), c, 'spell:cat-flame')
  assert.equal(o.kind, 'arm')
  assert.equal(o.kind === 'arm' && o.mod.source, 'spell:cat-flame')
  assert.equal(o.kind === 'arm' && o.mod.kind, 'damage')
  assert.equal(o.kind === 'arm' && o.mod.sub, 'melee')
  assert.equal(o.kind === 'arm' && o.mod.dmgType, 'radiant')

  const { resources } = applyOutcomes(c, [o], new Set())
  assert.equal((resources.graph as { armed: unknown[] }).armed.length, 1)
})

test('a spell\u2019s `when` still gates the arming', () => {
  // `prepared` matters now: an unready spell is not an active source, so its
  // VARIABLES leave scope with it and `when: 'ready'` cannot resolve at all.
  const spell = (when: string) => ({
    id: 'i1', spell_id: 'cat-x', name: 'X', level: 1, prepared: true,
    vars: [{ name: 'ready', kind: 'stored' as const, type: 'bool' as const, initial: false }],
    graph: [{ id: 'e1', op: 'add' as const, value: '1d6', label: 'Charged', once: true, when, target: ['roll:attack'] }],
  })
  const off = character({ spellbook: { spells: [spell('ready')] }, sheet: { features: [] } }, { vars: { ready: false } })
  assert.deepEqual(planActivation(spell('ready'), buildContext(off), off, 'spell:cat-x'), [])
  const on = character({ spellbook: { spells: [spell('ready')] }, sheet: { features: [] } }, { vars: { ready: true } })
  assert.equal(planActivation(spell('ready'), buildContext(on), on, 'spell:cat-x').length, 1)
})

test('an UNPREPARED spell arms nothing — it is not something you are carrying', () => {
  const spell = {
    id: 'i1', spell_id: 'cat-x', name: 'X', level: 1, prepared: false,
    graph: [{ id: 'e1', op: 'add' as const, value: '1d6', label: 'Charged', once: true, target: ['roll:attack'] }],
  }
  const c = character({ spellbook: { preparesSpells: true, spells: [spell] }, sheet: { features: [] } }, {})
  // planActivation reads the node it is handed, so the arm is still PLANNED —
  // the gate is upstream, at what counts as active. What matters is that its
  // contributions never reach a roll, which activeSources decides.
  assert.equal(buildContext(c).index.size, 0)
})

test('an armed modifier remembers its source\u2019s NAME, not just its gid', () => {
  // `source` is identity — the dedup key and what the cards match on — so it
  // stays a gid. But every other rider's `source` column is a human name, and a
  // player should never be shown `spell:afab43d3-…`.
  const c = character({}, {})
  const [o] = planActivation(RAGE([ONCE]), buildContext(c), c, 'feature:rage')
  assert.equal(o.kind === 'arm' && o.mod.source, 'feature:rage')
  assert.equal(o.kind === 'arm' && o.mod.sourceName, 'Rage')
})

// ── THE TURN BOUNDARY ───────────────────────────────────────────────────────
//
// "Until the start of your next turn" is the whole 5e family Reckless Attack
// belongs to. Two halves that must happen in one order: the variables reset,
// and THEN the arms those variables were gating are tested. Backwards, the
// condition is still true when the gates are checked and nothing is ever
// stale — a Brutal Strike armed last turn fires this turn as if still owed.

const RECKLESS: VarDef[] = [
  { name: 'reckless', kind: 'stored', type: 'bool', initial: false, resetOn: 'turn' },
  ...VARS,
]

/** Reckless Attack + Brutal Strike, cut down to what the turn boundary sees. */
const BARB = (): Feature => ({
  id: 'barb', name: 'Barbarian', vars: RECKLESS,
  graph: [
    { id: 'a1', op: 'dis', label: 'Brutal Strike', when: 'reckless', once: true, target: ['roll:attack.str'] },
    { id: 'a2', op: 'add', value: '1d6', label: 'Held Smite', once: true, target: ['roll:damage.melee'] },
  ],
} as unknown as Feature)

const barbChar = (graph: object) =>
  character({ sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features: [BARB()] } } as Partial<CharacterRow>, graph)

const ARMED = [
  { id: 'm-brutal', source: 'feature:barb', label: 'Brutal Strike', kind: 'attack', sub: 'str', op: 'dis', at: 0 },
  { id: 'm-smite', source: 'feature:barb', label: 'Held Smite', kind: 'damage', sub: 'melee', op: 'add', value: '1d6', at: 0 },
]

test('turnVars picks ONLY resetOn: turn, and restVars leaves those alone', () => {
  const c = barbChar({ vars: { reckless: true, charges: 1, isRaging: true } })
  assert.deepEqual(turnVars(c), { reckless: false })
  // A rest resets its own two and must not claim credit for the turn variable.
  const rest = restVars(c, {}, 'long')
  assert.equal('reckless' in rest, false)
  assert.equal(rest.isRaging, false)
  assert.equal(rest.charges, 3)
})

test('AN ARM LAPSES WITH THE CONDITION THAT AUTHORISED IT', () => {
  const c = barbChar({ vars: { reckless: true }, armed: ARMED })
  const patch = turnGraphPatch(c, buildContext(c))
  assert.ok(patch)
  const g = (patch!.resources as { graph: { vars: Record<string, unknown>; armed: { id: string }[] } }).graph
  assert.equal(g.vars.reckless, false, 'the variable reset')
  assert.deepEqual(g.armed.map(m => m.id), ['m-smite'], 'the gated arm went, the held one stayed')
  assert.deepEqual(patch!.disarmed, ['Brutal Strike'])
  // The FEATURE that ended, not the identifier that reset — the report is read
  // by a player, who has never heard of `reckless`.
  assert.deepEqual(patch!.ended, ['Barbarian'])
})

test('two turn variables on one feature report it ending ONCE', () => {
  const f = { ...BARB(), vars: [
    { name: 'reckless', kind: 'stored', type: 'bool', initial: false, resetOn: 'turn' },
    { name: 'braced', kind: 'stored', type: 'bool', initial: false, resetOn: 'turn' },
  ] } as unknown as Feature
  const c = character(
    { sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features: [f] } } as Partial<CharacterRow>,
    { vars: { reckless: true, braced: true } },
  )
  assert.deepEqual(turnGraphPatch(c, buildContext(c))!.ended, ['Barbarian'])
})

test('AN UNGATED ARM IS NEVER TOUCHED — a held smite is a decision, not a leftover', () => {
  const c = barbChar({ vars: { reckless: false }, armed: [ARMED[1]] })
  const patch = turnGraphPatch(c, buildContext(c))
  const g = (patch?.resources as { graph: { armed: { id: string }[] } } | undefined)?.graph
  assert.deepEqual(g?.armed.map(m => m.id) ?? ['m-smite'], ['m-smite'])
  assert.deepEqual(patch?.disarmed ?? [], [])
})

test('an arm whose SOURCE has gone is left alone rather than silently confiscated', () => {
  // Feature unequipped, item dropped: the player can still see the chip and
  // dismiss it. Vanishing without a line saying why is the worse failure.
  const c = barbChar({ vars: { reckless: false }, armed: [{ ...ARMED[0], source: 'feature:ghost' }] })
  const patch = turnGraphPatch(c, buildContext(c))
  const g = (patch?.resources as { graph: { armed: { id: string }[] } } | undefined)?.graph
  assert.deepEqual(g?.armed.map(m => m.id) ?? ['m-brutal'], ['m-brutal'])
})

test('nothing to do returns null, so Advance Turn skips the write and the line', () => {
  assert.equal(turnGraphPatch(character(), buildContext(character())), null)
})

test('the reset lands BEFORE the gates are read — the ordering the whole thing turns on', () => {
  // Same input as the lapse test. If turnGraphPatch tested the gates against the
  // pre-reset scope, `reckless` would still be true and the arm would survive.
  const c = barbChar({ vars: { reckless: true }, armed: ARMED })
  assert.deepEqual(turnGraphPatch(c, buildContext(c))!.disarmed, ['Brutal Strike'])
})

test('staleArmed on its own reports ids, and an unresolvable condition stays live', () => {
  const c = barbChar({ vars: { reckless: true }, armed: ARMED })
  const ctx = buildContext(c)
  assert.deepEqual(staleArmed(ctx, { ...ctx.scope, reckless: false }), ['m-brutal'])
  // A condition the engine cannot answer is an authoring problem to see in the
  // audit, never a reason to confiscate something the player armed.
  assert.deepEqual(staleArmed(ctx, {}), [])
})

/* ---------- offers: arms AND stances ----------
   Reckless Attack is the case nothing could see. It writes a variable; a
   SECOND effect, gated on that variable, is what grants the advantage — so the
   activation names no roll and `armedMatches` had nothing to match. */

const STANCE = {
  id: 'reckless', name: 'Reckless Attack',
  vars: [{ kind: 'stored', name: 'recklessly', type: 'bool', scope: 'player', initial: false, resetOn: 'turn' }],
  graph: [
    { id: 'v', op: 'setVar', variable: 'recklessly', value: 'true', label: 'Attack recklessly', target: [] },
    { id: 'a', op: 'adv', when: 'recklessly', label: 'Advantage on Strength attacks', target: ['roll:attack.str'] },
  ],
} as unknown as Feature

/** A character carrying only the stance feature, with `graph` state to taste. */
const stanceHost = (graph: object = {}) =>
  character({ sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, features: [STANCE] } } as never, graph)

test('a STANCE is offered on the roll its variable would reach', () => {
  const c = stanceHost()
  const offers = armableFor(c, buildContext(c), { kind: 'attack', sub: 'melee', ability: 'str' })
  assert.deepEqual(offers.map(o => [o.feature.name, o.kind]), [['Reckless Attack', 'stance']])
})

test('a stance is NOT offered on a roll it could not change', () => {
  const c = stanceHost()
  // A Dexterity attack never matches `roll:attack.str`, so there is nothing to buy.
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'attack', ability: 'dex' }), [])
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'damage' }), [])
})

test('a stance ALREADY HELD is not offered again — the use would buy nothing', () => {
  const c = stanceHost({ vars: { recklessly: true } })
  assert.deepEqual(armableFor(c, buildContext(c), { kind: 'attack', ability: 'str' }), [])
})

/* ---------- HELD: answering releases, undo puts it back ---------- */

const ASKED: GraphEffect = {
  id: 'e1', op: 'note', once: true, label: 'Forceful Blow', target: ['roll:damage.melee'],
  ask: 'Forceful Blow: pushed 15 feet.', text: '**Forceful Blow**',
} as GraphEffect

test('answering marks the hold spent, and undo clears it', () => {
  const c = character({}, {})
  const armed = applyOutcomes(c, planActivation(RAGE([ASKED]), buildContext(c), c, 'feature:rage'), new Set())
  const host = { ...c, resources: armed.resources } as CharacterRow
  const id = (armed.resources.graph as { armed: { id: string }[] }).armed[0].id

  const after = answerArmed(host, [id], 'roll-7')
  assert.equal((after.graph as { armed: { spent?: string }[] }).armed[0].spent, 'roll-7')

  const undone = answerArmed({ ...host, resources: after } as CharacterRow, [id], null)
  assert.equal('spent' in (undone.graph as { armed: object[] }).armed[0], false, 'undo removes the mark, not the hold')
  assert.equal((undone.graph as { armed: unknown[] }).armed.length, 1, 'the hold itself survives')
})

test('AN ANSWERED HOLD IS NOT OFFERED AGAIN', () => {
  // The point of answering-as-release: the next roll must not re-ask.
  const c = character({}, {})
  const armed = applyOutcomes(c, planActivation(RAGE([ASKED]), buildContext(c), c, 'feature:rage'), new Set())
  const host = { ...c, resources: armed.resources } as CharacterRow
  const req = { kind: 'damage', sub: 'melee' } as const

  assert.equal(resolve(buildContext(host), req).riders.length, 1, 'offered while unanswered')

  const id = (armed.resources.graph as { armed: { id: string }[] }).armed[0].id
  const spent = { ...host, resources: answerArmed(host, [id], 'roll-7') } as CharacterRow
  assert.equal(resolve(buildContext(spent), req).riders.length, 0, 'gone once answered')

  const undone = { ...host, resources: answerArmed(spent, [id], null) } as CharacterRow
  assert.equal(resolve(buildContext(undone), req).riders.length, 1, 'and back if undone')
})


// --- gated shut --------------------------------------------------------------

/* Brutal Strike gates every one of its arms on Reckless Attack. With the gate
   false, planActivation drops all four and the press wrote nothing, spent
   nothing, and still logged an empty roll entry — which is what "I can use
   Brutal Strike without Reckless Attack" looks like from the player's side. */
const GATED: GraphEffect[] = [
  { id: 'g1', op: 'dis', once: true, when: 'isRaging', label: 'Remove Advantage', target: ['roll:attack.str'] },
  { id: 'g2', op: 'add', once: true, when: 'isRaging', value: '1d10', label: 'Add 1d10', target: ['roll:damage.melee'] },
]

const gateWith = (graph: GraphEffect[], stored: Record<string, number | boolean> = {}) => {
  const c = character({}, { vars: stored })
  return gateOf(RAGE(graph), buildContext(c), c, 'feature:rage')
}

test('a feature whose every activation is gated false cannot be pressed', () => {
  assert.deepEqual(gateWith(GATED), ['isRaging'])
})

test('the same feature is pressable the moment its gate is true', () => {
  assert.equal(gateWith(GATED, { isRaging: true }), null)
})

test('one live activation is enough — a partly gated feature still presses', () => {
  const mixed = [...GATED, { id: 'g3', op: 'setVar', variable: 'charges', value: '1', label: 'Spend' } as GraphEffect]
  assert.equal(gateWith(mixed), null)
})

test('a passive with no activations is not "shut", it simply has no press', () => {
  assert.equal(gateWith([{ id: 'p1', op: 'add', value: '2', label: 'Rage Damage', target: ['roll:damage.melee'] }]), null)
})


// --- the press owns what the press writes ------------------------------------

/* A hand switch beside a `setVar` was a second door into the same room with no
   use counter on it: Reckless Attack costs a use and sets `recklessAttack`, so
   flipping the switch bought the advantage and left the use in the bank. */
const STANCE_F = (graph: GraphEffect[]): Feature => ({
  id: 'rk', name: 'Reckless Attack',
  vars: [{ name: 'reckless', kind: 'stored', type: 'bool', initial: false, resetOn: 'turn' }],
  graph,
} as unknown as Feature)

const lockOf = (graph: GraphEffect[], extra: Feature[] = []) => {
  const c = character({ sheet: {
    abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    features: [STANCE_F(graph), ...extra],
  } } as Partial<CharacterRow>, {})
  return playerVars(c).find(v => v.def.name === 'reckless')?.locked
}

test('a variable an activation writes is locked out of the hand switch', () => {
  assert.equal(lockOf([{ id: 's1', op: 'setVar', variable: 'reckless', value: 'true', label: 'Go' }]), true)
})

test('a variable nothing writes keeps its switch — the hood has no other control', () => {
  assert.equal(lockOf([{ id: 's1', op: 'adv', label: 'Adv', when: 'reckless', target: ['roll:attack.str'] }]), false)
})

test('the writer may live on ANOTHER feature and still lock it', () => {
  const other = { id: 'o', name: 'Other', graph: [
    { id: 's2', op: 'setVar', variable: 'reckless', value: 'true', label: 'Go' },
  ] } as unknown as Feature
  assert.equal(lockOf([], [other]), true)
})


// --- attacksThisTurn ---------------------------------------------------------

/* "On your FIRST attack roll on your turn" is a real decision point in 5e, and
   nothing could express it: the count was never kept, so a stance stayed
   offerable after three swings. */
const attacksIn = (r: Record<string, Json>) =>
  (r.graph as { attacks?: number }).attacks

test('an attack roll counts, and counts again', () => {
  const c = character({}, {})
  const once = attackRolled(c, [], 'r1')
  assert.equal(attacksIn(once), 1)
  assert.equal(attacksIn(attackRolled({ ...c, resources: once } as CharacterRow, [], 'r2')), 2)
})

test('counting an attack disturbs nothing else in the graph state', () => {
  const c = character({}, { vars: { isRaging: true }, armed: ARMED })
  const g = attackRolled(c, [], 'r1').graph as { vars: unknown; armed: unknown[] }
  assert.deepEqual(g.vars, { isRaging: true })
  assert.equal(g.armed.length, 2)
})

/* DECLINING IS AN ANSWER THE PANEL CANNOT MAKE. Brutal Strike arms under
   Reckless Attack; the player takes neither blow, so nothing was ever answered
   and the taken half stayed queued. A `when` gate is read when the arm is
   minted and never again, so on the next swing its disadvantage and its 1d10
   applied under a condition that had long gone false. */
const armsOf = (r: Record<string, Json>) =>
  (r.graph as { armed: { id: string; spent?: string }[] }).armed

test('the roll spends the arms it just used, answered or not', () => {
  const c = character({}, { armed: ARMED })
  const armed = armsOf(attackRolled(c, ['m-brutal'], 'roll-7'))
  assert.equal(armed.find(m => m.id === 'm-brutal')?.spent, 'roll-7')
  assert.equal(armed.find(m => m.id === 'm-smite')?.spent, undefined, 'an untouched hold is not spent')
})

/* THE OFFERED BLOWS GO TOO. Left queued they were offered again on the next
   swing — a choice of blows with no feature behind it. The entry keeps the
   question; the queue does not need to. */
test('armsSpentBy takes the offered arms as well as the taken ones', () => {
  const ids = armsSpentBy(
    [{ label: 'Dis', source: 'BS', op: 'dis', formula: '', flat: 0, dice: [], when: 'always', on: true, armedId: 'a-dis' }],
    [
      { label: 'Add', source: 'BS', op: 'add', formula: '', flat: 0, dice: [], when: 'always', on: true, armedId: 'a-add' },
      { label: 'Forceful', source: 'BS', op: 'note', formula: '', flat: 0, dice: [], when: 'manual', on: false, armedId: 'a-blow' },
      // Not from the queue at all — a live graph contribution, nothing to spend.
      { label: 'Rage', source: 'Rage', op: 'add', formula: '', flat: 2, dice: [], when: 'always', on: true },
    ],
  )
  assert.deepEqual(ids.sort(), ['a-add', 'a-blow', 'a-dis'])
})

test('the turn boundary zeroes the swing count', () => {
  const c = barbChar({ vars: { reckless: true }, attacks: 3 })
  assert.equal(attacksIn(turnGraphPatch(c, buildContext(c))!.resources), 0)
})

test('a turn with nothing but swings on it still resets them', () => {
  // No turn variables, no gated arms — but three swings, so the count must not
  // ride into next turn and hold a first-attack decision shut.
  const c = character({}, { attacks: 3 })
  assert.equal(attacksIn(turnGraphPatch(c, buildContext(c))!.resources), 0)
})

test('attacksThisTurn reaches an expression through the base scope', () => {
  const c = character({}, { attacks: 2 })
  assert.equal(buildContext(c).scope.attacksThisTurn, 2)
  assert.equal(buildContext(character({}, {})).scope.attacksThisTurn, 0)
})

/* ---------- addUses: one feature writes another's counter ---------- */

/** A Barbarian carrying Rage (a scaling counter) and Persistent Rage (which
 *  refills it). The two-feature shape is the point — every other activation op
 *  writes state on the node that declares it. */
const RAGE_F: Feature = {
  id: 'cls:b:rage', feature_id: 'rage', name: 'Rage',
  uses: { current: 1, max: 'rages' }, recharge: 'long',
} as Feature
const PERSISTENT = (value = 'rages'): Feature => ({
  id: 'cls:b:persistent', feature_id: 'persistent', name: 'Persistent Rage',
  uses: { current: 1, max: 1 }, recharge: 'long',
  graph: [{ id: 'p1', op: 'addUses', label: 'Regain all Rages', value, target: ['feature:rage'] }],
} as Feature)
const BARBARIAN = (over: Partial<Feature>[] = [], vars: object = {}) => character({
  identity: { level: 12 },
  sheet: {
    abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    features: [
      { id: 'cls:b', name: 'Barbarian', vars: [{ name: 'rages', kind: 'derived', formula: '[0,2,2,3,3,3,4,4,4,4,4,4,5][level]' }] },
      { ...RAGE_F, ...(over[0] ?? {}) },
      { ...PERSISTENT(), ...(over[1] ?? {}) },
    ],
  },
} as Partial<CharacterRow>, vars)

const planPersistent = (c: CharacterRow) => planActivation(
  (c.sheet!.features ?? []).find(f => f.name === 'Persistent Rage')!,
  buildContext(c), c, 'feature:persistent')

test('addUses moves the counter of ANOTHER feature, resolved and clamped', () => {
  const c = BARBARIAN()
  const [o] = planPersistent(c)
  assert.equal(o.kind, 'uses')
  assert.equal(o.kind === 'uses' && o.target.name, 'Rage')
  // Level 12 -> 5 Rages. Restoring "all" is authored as the max itself and the
  // clamp is what makes that mean all: 1 + 5 = 6, held at 5.
  assert.equal(o.kind === 'uses' && o.next, 5)
  assert.equal(o.summary, 'Rage +4 → 5 / 5')
})

test('the patch is keyed by feature id, so it composes with a spend', () => {
  /* Returned as id -> count rather than a rebuilt feature list, because the
     caller has ALREADY spent Persistent Rage's own charge by the time this runs.
     A snapshot rebuilt from the original row would silently put that back. */
  const c = BARBARIAN()
  const { usesPatch } = applyOutcomes(c, planPersistent(c), new Set())
  assert.deepEqual(usesPatch, { 'cls:b:rage': 5 })
})

test('a negative addUses SPENDS — "expend a use of your Rage"', () => {
  const c = BARBARIAN([{ uses: { current: 3, max: 'rages' } }])
  const f = (c.sheet!.features ?? []).find(x => x.name === 'Persistent Rage')!
  const spend = { ...f, graph: [{ ...f.graph![0], value: '-1', label: 'Expend a Rage' }] } as Feature
  const [o] = planActivation(spend, buildContext(c), c, 'feature:persistent')
  assert.equal(o.kind === 'uses' && o.next, 2)
  // …and it cannot go below zero.
  const empty = BARBARIAN([{ uses: { current: 0, max: 'rages' } }])
  assert.equal(planActivation(spend, buildContext(empty), empty, 'feature:persistent').length, 0,
    'nothing to spend is no outcome, not a negative count')
})

test('a cost that cannot be paid refuses the WHOLE press, benefit included', () => {
  /* "Expend a use of your Rage to restore this" is one transaction. Clamping the
     negative at zero would hand out the benefit for free to exactly the player
     who cannot afford it — the silent wrong number this engine keeps re-learning. */
  // Both spent: no Rage to pay with, AND a charge genuinely waiting to be
  // restored — so a rule that only clamped the cost would still hand it over.
  const broke = BARBARIAN([{ uses: { current: 0, max: 'rages' } }, { uses: { current: 0, max: 1 } }])
  const f = (broke.sheet!.features ?? []).find(x => x.name === 'Persistent Rage')!
  const trade = { ...f, graph: [
    { id: 'cost', op: 'addUses', label: 'Expend a Rage', value: '-1', target: ['feature:rage'] },
    { id: 'gain', op: 'addUses', label: 'Restore this', value: '1', target: [] },
  ] } as Feature
  // Nothing at all is planned, so gateOf reports it shut rather than the press
  // spending nothing and quietly succeeding.
  assert.deepEqual(planActivation(trade, buildContext(broke), broke, 'feature:persistent'), [])
  assert.ok(gateOf(trade, buildContext(broke), broke, 'feature:persistent'))

  // With a Rage in hand, both halves land — and the benefit is real, so this
  // feature's own charge has to be spent for there to be something to restore.
  const rich = BARBARIAN([{ uses: { current: 2, max: 'rages' } }, { uses: { current: 0, max: 1 } }])
  const both = planActivation(trade, buildContext(rich), rich, 'feature:persistent')
  assert.deepEqual(both.map(o => o.kind === 'uses' ? [o.target.name, o.next] : null),
    [['Rage', 1], ['Persistent Rage', 1]])
})

test('an empty target means THIS feature — the same "no target = me" rule', () => {
  const c = BARBARIAN()
  const f = (c.sheet!.features ?? []).find(x => x.name === 'Persistent Rage')!
  const self = { ...f, graph: [{ ...f.graph![0], target: [], value: '-1' }] } as Feature
  const [o] = planActivation(self, buildContext(c), c, 'feature:persistent')
  assert.equal(o.kind === 'uses' && o.target.name, 'Persistent Rage')
  assert.equal(o.kind === 'uses' && o.next, 0)
})

test('a target that is not on the sheet is silent, not an error', () => {
  // "Restore Rage" on a character who has not been granted Rage yet is a level
  // gate doing its job, not a broken feature.
  const c = character({ sheet: { features: [PERSISTENT()] } } as Partial<CharacterRow>)
  assert.equal(planPersistent(c).length, 0)
})

test('a press that changes nothing plans nothing', () => {
  const full = BARBARIAN([{ uses: { current: 5, max: 'rages' } }])
  assert.equal(planPersistent(full).length, 0, 'already at max — no outcome, no empty log line')
})

test('the authored max survives the write', () => {
  const c = BARBARIAN()
  const { usesPatch } = applyOutcomes(c, planPersistent(c), new Set())
  // The patch carries only the COUNT. `max` is a formula and resolving it into
  // the row would freeze this character's ceiling at level 12 forever.
  assert.deepEqual(Object.values(usesPatch!), [5])
  assert.equal(RAGE_F.uses!.max, 'rages')
})

/* ---------- partial short-rest recovery ---------- */

const usesFeat = (over: Partial<Feature>): Feature =>
  ({ id: 'f-rage', feature_id: 'rage', name: 'Rage', ...over }) as Feature

const restedShort = (f: Feature) => {
  const c = character({ sheet: {
    abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    hp: { current: 20, max: 40 }, features: [f],
  } } as Partial<CharacterRow>)
  const out = (shortRestPatch(c, { spend: 0, rolls: [], conMod: 0 }).patch.sheet as { features: Feature[] })
  return out.features[0].uses
}

test('a SHORT rest gives back only what shortRecharge says', () => {
  /* Rage is 5e's third combination: all of them on a long rest, exactly one on a
     short. `recharge: 'short'` would hand back the lot after an hour sitting
     down, and 'long' alone would lose the short-rest use entirely. */
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 1, max: 5 }, recharge: 'long', shortRecharge: 1 })),
    { current: 2, max: 5 })
  // Clamped: it can never bank past the ceiling.
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 4, max: 5 }, recharge: 'long', shortRecharge: 3 })),
    { current: 5, max: 5 })
  // And a full short-rest refill is untouched by all of this.
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 0, max: 5 }, recharge: 'short' })),
    { current: 5, max: 5 })
  // No shortRecharge on a long-rest feature: a short rest still does nothing.
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 1, max: 5 }, recharge: 'long' })),
    { current: 1, max: 5 })
})

test('shortRecharge is a FORMULA and resolves against the character', () => {
  // Same rule `uses.max` follows, for the same reason: "half your level" is the
  // shape this meets next, and a number could not say it.
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 0, max: 9 }, recharge: 'long', shortRecharge: 'level / 2' })),
    { current: 2, max: 9 }, 'level 5 -> 2')
  // A max that is itself a formula still resolves — the two compose.
  assert.deepEqual(restedShort(usesFeat({ uses: { current: 0, max: 'level' }, recharge: 'long', shortRecharge: 2 })),
    { current: 2, max: 'level' }, 'the authored max survives the write')
})

/* ---------- picks: widening a pick-one ---------- */

const OFFER = (id: string, ask: string): GraphEffect =>
  ({ id, op: 'note', label: ask, text: ask, ask, once: true, target: ['roll:damage.melee'] })

const offerer = (picks?: number | string): Feature =>
  ({ id: 'brutal', name: 'Brutal Strike', picks, graph: [OFFER('b1', 'Forceful'), OFFER('b2', 'Hamstring')] } as Feature)

const pickArms = (f: Feature, level = 9) => {
  const c = character({ identity: { level } } as Partial<CharacterRow>, {})
  return planActivation(f, buildContext(c), c, 'feature:brutal')
    .map(o => (o.kind === 'arm' ? o.mod : null))
}

test('picks is snapshotted onto every arm, and absent when it changes nothing', () => {
  /* A property of the GROUP, so one number on all of them: resolving it per
     effect would be two answers to "how many may I take". Absent at 1 because
     one is what a pick has always been, and an explicit 1 in the store is noise. */
  assert.deepEqual(pickArms(offerer()).map(m => m?.picks), [undefined, undefined])
  assert.deepEqual(pickArms(offerer(2)).map(m => m?.picks), [2, 2])
  assert.deepEqual(pickArms(offerer(1)).map(m => m?.picks), [undefined, undefined])
})

test('picks is a FORMULA, because the count is a level thing', () => {
  // Improved Brutal Strike (Enhanced): two effects from level 17, one before.
  const f = offerer('level >= 17 ? 2 : 1')
  assert.deepEqual(pickArms(f, 16).map(m => m?.picks), [undefined, undefined])
  assert.deepEqual(pickArms(f, 17).map(m => m?.picks), [2, 2])
  // Unreadable is one — the behaviour every pick-one had before this existed.
  assert.deepEqual(pickArms(offerer('nonsense')).map(m => m?.picks), [undefined, undefined])
})

/* ---------- `grant`: the one outcome that leaves this sheet ---------- */

const BARDIC: GraphEffect = {
  id: 'bi_grant', op: 'grant', label: 'Bardic Inspiration',
  target: ['roll:d20'], value: '1d6',
  byLevel: ['', '1d6', '', '', '', '1d8', '', '', '', '', '1d10', '', '', '', '', '1d12', '', '', '', '', ''],
}

const bard = (level: number) => character({
  identity: { level },
  sheet: { abilities: { str: 8, dex: 14, con: 12, int: 12, wis: 10, cha: 20 }, features: [{ id: 'bi', name: 'Bardic Inspiration', graph: [BARDIC] } as Feature] },
} as Partial<CharacterRow>)

test('a grant plans a mod for someone else and writes NOTHING here', () => {
  const c = bard(14)
  const f = c.sheet!.features![0]
  const out = planActivation(f, buildContext(c), c, 'feature:bi')
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'grant')

  // The local patch is untouched: no arm of our own, no variable, no counter.
  const applied = applyOutcomes(c, out, new Set())
  assert.equal(applied.usesPatch, undefined)
  assert.deepEqual((applied.resources.graph as { armed?: unknown[] }).armed ?? [], [])
  // …but it comes back in `applied`, because the caller is what sends it.
  assert.equal(applied.applied.length, 1)
})

test("a granted die is snapshotted at the GRANTER's level, not the recipient's", () => {
  // The recipient's session never re-evaluates it — and could not: `bardicDie`
  // is not declared on a fighter's sheet.
  const at = (level: number) => {
    const c = bard(level)
    const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:bi')
    return (out[0] as { mod: { value?: string } }).mod.value
  }
  assert.equal(at(1), '1d6')
  assert.equal(at(4), '1d6')   // the table walks DOWN to the last filled slot
  assert.equal(at(5), '1d8')
  assert.equal(at(14), '1d10')
  assert.equal(at(20), '1d12')
})

test('a granted mod carries no id and no timestamp — the server stamps both', () => {
  // A client-chosen id on someone else's row is a client-chosen collision, and
  // `source`/`sourceName` name the GRANTER, which only the server can vouch for.
  const c = bard(5)
  const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:bi')
  const mod = (out[0] as { mod: Record<string, unknown> }).mod
  assert.equal('id' in mod, false)
  assert.equal('at' in mod, false)
  assert.equal(mod.kind, 'd20')
  assert.equal(mod.op, 'add')
})

test('ONE grant per press, because roll:d20 is one selector', () => {
  // The bug this kind exists to prevent: three selectors would place three
  // separate dice on the recipient, all usable, for one expended use.
  const c = bard(5)
  const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:bi')
  assert.equal(out.filter(o => o.kind === 'grant').length, 1)

  const wide = character({
    identity: { level: 5 },
    sheet: { features: [{ id: 'bi', name: 'BI', graph: [{ ...BARDIC, target: ['roll:check', 'roll:save', 'roll:attack'] }] } as Feature] },
  } as Partial<CharacterRow>)
  assert.equal(planActivation(wide.sheet!.features![0], buildContext(wide), wide, 'feature:bi').length, 3)
})

test('a grant honours `when` like every other activation', () => {
  const c = character({
    identity: { level: 5 },
    sheet: { features: [{ id: 'bi', name: 'BI', vars: VARS, graph: [{ ...BARDIC, when: 'isRaging' }] } as Feature] },
  } as Partial<CharacterRow>, { vars: { isRaging: false } })
  assert.deepEqual(planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:bi'), [])
})

test('THE END TO END: a planned grant, stamped and placed, rides the recipient\'s roll', () => {
  /* The half no unit boundary covers on its own — the granter plans it, the
     server stamps it, and it is the RECIPIENT's resolve() that has to make a
     number of it. The mod left here carrying `op: 'grant'` once, and every
     assertion above still passed while the die landed worth zero. */
  const giver = bard(14)
  const out = planActivation(giver.sheet!.features![0], buildContext(giver), giver, 'feature:bi')
  const planned = (out[0] as { mod: Record<string, unknown> }).mod

  // What migration 0022 adds, and nothing the client sent.
  const stamped = { ...planned, id: 'srv-1', at: 1, source: 'party:giver', sourceName: 'The Bard' }

  // A recipient who has never heard of a bard: no bardicDie, no features.
  const ally = character({
    identity: { level: 3 },
    sheet: { abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 8 }, features: [] },
  } as Partial<CharacterRow>, { armed: [stamped] })

  const ctx = buildContext(ally)
  for (const kind of ['check', 'save', 'attack'] as const) {
    const r = resolve(ctx, { kind })
    assert.deepEqual(r.riders.map(x => x.dice).flat(), ['1d10'], kind)
    assert.equal(r.riders[0].source, 'The Bard')
    assert.deepEqual(r.problems, [])
  }
  // Not on a damage roll — a D20 Test is the three above and nothing else.
  assert.deepEqual(resolve(ctx, { kind: 'damage' }).riders, [])
})

/* ---------- `addSlot`: the third column ---------- */

const caster = (slots: { level: number; total: number; expended: number }[], graph: GraphEffect[], over: object = {}) =>
  character({
    identity: { level: 9 },
    sheet: { abilities: { str: 8, dex: 14, con: 12, int: 12, wis: 10, cha: 18 }, features: [{ id: 'f', name: 'Font', graph } as Feature] },
    spellbook: { spellcasting: true, slots },
    ...over,
  } as Partial<CharacterRow>)

const SPEND: GraphEffect = { id: 's1', op: 'addSlot', label: 'Expend a spell slot', value: '-1' }
const LADDER = [
  { level: 1, total: 4, expended: 4 },   // empty
  { level: 2, total: 3, expended: 1 },
  { level: 3, total: 2, expended: 0 },
]

test('slotLadder reads both storage schemes as one shape', () => {
  assert.deepEqual(slotLadder(caster(LADDER, [])), [
    { level: 1, total: 4, avail: 0 },
    { level: 2, total: 3, avail: 2 },
    { level: 3, total: 2, avail: 2 },
  ])
  // A Pact caster stores only `pactExpended`; total and level are derived.
  const pact = caster([], [], { spellbook: { spellcasting: true, pactMagic: true, pactExpended: 1 } })
  assert.deepEqual(slotLadder(pact), [{ level: 5, total: 2, avail: 1 }])
  // A non-caster has no slots, which reads as "cannot pay" and never as an error.
  assert.deepEqual(slotLadder(character()), [])
})

test('an unnamed slot level stays the PLAYER\'s question', () => {
  const c = caster(LADDER, [SPEND])
  const [o] = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:f')
  assert.equal(o.kind, 'slot')
  assert.equal((o as { level?: number }).level, undefined, '"a spell slot" names no level')

  // …unless the rule names one, or there is only one to name.
  const named = caster(LADDER, [{ ...SPEND, level: '2' }])
  assert.equal((planActivation(named.sheet!.features![0], buildContext(named), named, 'feature:f')[0] as { level?: number }).level, 2)
  const only = caster([{ level: 3, total: 2, expended: 0 }], [SPEND])
  assert.equal((planActivation(only.sheet!.features![0], buildContext(only), only, 'feature:f')[0] as { level?: number }).level, 3)
})

test('a slot cost that cannot be paid refuses the whole press', () => {
  // Nothing left anywhere.
  const dry = caster([{ level: 1, total: 4, expended: 4 }], [SPEND])
  assert.deepEqual(planActivation(dry.sheet!.features![0], buildContext(dry), dry, 'feature:f'), [])
  assert.deepEqual(gateOf(dry.sheet!.features![0], buildContext(dry), dry, 'feature:f'), [])

  // A NAMED level that is empty, while other levels are full: still refused —
  // the rule said which slot, and a different one is not a substitute.
  const wrong = caster(LADDER, [{ ...SPEND, level: '1' }])
  assert.deepEqual(planActivation(wrong.sheet!.features![0], buildContext(wrong), wrong, 'feature:f'), [])

  // A non-caster granted this by mistake cannot press it either.
  const barb = character({ sheet: { features: [{ id: 'f', name: 'Font', graph: [SPEND] } as Feature] } } as Partial<CharacterRow>)
  assert.deepEqual(planActivation(barb.sheet!.features![0], buildContext(barb), barb, 'feature:f'), [])
})

test('applyOutcomes moves the slot the player picked, and clamps both ends', () => {
  const c = caster(LADDER, [SPEND])
  const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:f')

  const spent = applyOutcomes(c, out, new Set(), { slotLevel: 2 }).spellbook
  assert.deepEqual(spent?.slots?.find(s => s.level === 2), { level: 2, total: 3, expended: 2 })
  // Only that level moved.
  assert.deepEqual(spent?.slots?.find(s => s.level === 3), { level: 3, total: 2, expended: 0 })

  // No level chosen and none implied: nothing moves, rather than a guess.
  assert.equal(applyOutcomes(c, out, new Set()).spellbook, undefined)

  /* THE OTHER END OF THE CLAMP, exercised directly: planActivation refuses an
     unpayable cost before applyOutcomes ever sees it, so nothing above can reach
     this branch — and an invariant no test can reach is one that quietly stops
     holding. Spending five from a level with two left banks two, never seven. */
  assert.deepEqual(
    slotPatch(c, 3, -5)?.slots?.find(s => s.level === 3),
    { level: 3, total: 2, expended: 2 },
  )

  // "Regain all your expended slots" is a big positive number plus the clamp.
  const all = caster(LADDER, [{ id: 's2', op: 'addSlot', label: 'Refill', value: '99', level: '1' }])
  const back = applyOutcomes(all, planActivation(all.sheet!.features![0], buildContext(all), all, 'feature:f'), new Set()).spellbook
  assert.deepEqual(back?.slots?.find(s => s.level === 1), { level: 1, total: 4, expended: 0 })
})

test('a Pact caster spends the one slot level they have, never a ladder', () => {
  const pact = caster([], [SPEND], { spellbook: { spellcasting: true, pactMagic: true, pactExpended: 0 } })
  const out = planActivation(pact.sheet!.features![0], buildContext(pact), pact, 'feature:f')
  assert.equal((out[0] as { pact: boolean }).pact, true)
  assert.equal(applyOutcomes(pact, out, new Set()).spellbook?.pactExpended, 1)
})

test('FONT OF INSPIRATION: one press spends a slot AND refills a counter', () => {
  /* The transaction the op exists for, and the reason applyOutcomes returns a
     patch per column: the slot lives in `spellbook`, the use counter on `sheet`,
     and landing one without the other is a free die or a lost slot. */
  const bi: Feature = { id: 'bi', name: 'Bardic Inspiration', uses: { max: 4, current: 1 } } as Feature
  const font: Feature = { id: 'font', name: 'Font of Inspiration', graph: [
    SPEND,
    { id: 'g1', op: 'addUses', label: 'Regain a die', value: '1', target: ['feature:bi'] },
  ] } as Feature
  const c = character({
    identity: { level: 9 },
    sheet: { abilities: { str: 8, dex: 14, con: 12, int: 12, wis: 10, cha: 18 }, features: [bi, font] },
    spellbook: { spellcasting: true, slots: LADDER },
  } as Partial<CharacterRow>)

  const out = planActivation(font, buildContext(c), c, 'feature:font')
  const res = applyOutcomes(c, out, new Set(), { slotLevel: 3 })
  assert.deepEqual(res.spellbook?.slots?.find(s => s.level === 3), { level: 3, total: 2, expended: 1 })
  assert.deepEqual(res.usesPatch, { bi: 2 })

  // And with no slots left, neither half happens.
  const dry = character({ ...c, spellbook: { spellcasting: true, slots: [{ level: 1, total: 4, expended: 4 }] } } as Partial<CharacterRow>)
  assert.deepEqual(planActivation(font, buildContext(dry), dry, 'feature:font'), [])
})

/* ---------- an arm is for the NEXT roll, whichever kind ---------- */

const armOf = (over: Partial<ArmedMod> = {}): ArmedMod =>
  ({ id: 'a1', source: 'feature:ps', sourceName: 'Peerless Skill', label: 'Peerless Skill', kind: 'check', op: 'add', value: '1d10', at: 1, ...over })

const armedIn = (armed: ArmedMod[]) => character({}, { armed })
const armedAfter = (r: Record<string, Json>) => (r.graph as GraphState).armed ?? []

test('A CHECK SPENDS ITS ARMS TOO — not only an attack', () => {
  /* The bug: attackRolled was the only thing that ever wrote `spent`, and only
     the weapon card called it. A `once` add aimed at roll:check applied to that
     check and to every check afterwards, paying out one expended Bardic
     Inspiration die over and over until a long rest emptied the queue. */
  const c = armedIn([armOf()])
  const after = armedAfter(armsSpent(c, ['a1'], 'roll-7'))
  assert.equal(after[0].spent, 'roll-7')
  // …and it does NOT count as an attack, which is attackRolled's other half.
  assert.equal((armsSpent(c, ['a1'], 'roll-7').graph as GraphState).attacks, undefined)
  assert.equal((attackRolled(c, ['a1'], 'roll-7').graph as GraphState).attacks, 1)
})

test('a `oneOf` group is spent together — one die, two queues', () => {
  const group = [
    armOf({ id: 'a:check', kind: 'check', group: 'feature:ps:e1' }),
    armOf({ id: 'a:attack', kind: 'attack', group: 'feature:ps:e1' }),
    armOf({ id: 'other', kind: 'check' }),   // ungrouped: untouched
  ]
  const c = armedIn(group)

  // Taking it on the check spends the attack offer with it.
  const spentByCheck = armedAfter(armsSpent(c, ['a:check'], 'roll-7'))
  assert.equal(spentByCheck.find(m => m.id === 'a:attack')?.spent, 'roll-7')
  assert.equal(spentByCheck.find(m => m.id === 'other')?.spent, undefined)

  // Answering works the same way, and undo releases the whole group.
  const answered = armedAfter(answerArmed(c, ['a:attack'], 'roll-9'))
  assert.equal(answered.find(m => m.id === 'a:check')?.spent, 'roll-9')
  const undone = armedAfter(answerArmed({ ...c, resources: answerArmed(c, ['a:attack'], 'roll-9') } as CharacterRow, ['a:attack'], null))
  assert.equal(undone.find(m => m.id === 'a:check')?.spent, undefined)
})

test('armedFrom stamps a group only when oneOf names more than one queue', () => {
  const one = { id: 'e1', op: 'add' as const, label: 'X', value: '1d6', once: true, oneOf: true, target: ['roll:check'] }
  assert.equal(armedFrom(one, 'feature:f')[0].group, undefined, 'a lone arm has no siblings')

  const two = { ...one, target: ['roll:check', 'roll:attack'] }
  const mods = armedFrom(two, 'feature:f')
  assert.equal(mods.length, 2)
  assert.equal(mods[0].group, mods[1].group)
  assert.ok(mods[0].group)

  // Without oneOf they stay independent — "+2 to your attack AND its damage".
  const both = armedFrom({ ...two, oneOf: undefined }, 'feature:f')
  assert.deepEqual(both.map(m => m.group), [undefined, undefined])
})

/* ---------- a slot budget: levels, not a count of slots ---------- */

const BUDGET: GraphEffect = { id: 'nr', op: 'addSlot', label: 'Natural Recovery', value: '1', budget: '3', maxLevel: '5' }

test('a budget offers a plan, not a level — and refuses when nothing is expended', () => {
  const full = caster([{ level: 1, total: 4, expended: 0 }], [BUDGET])
  assert.deepEqual(planActivation(full.sheet!.features![0], buildContext(full), full, 'feature:f'), [],
    'nothing spent, nothing to bring back')

  const c = caster(LADDER, [BUDGET])
  const [o] = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:f')
  assert.equal(o.kind, 'slot')
  assert.equal((o as { budget?: number }).budget, 3)
  assert.equal((o as { maxLevel?: number }).maxLevel, 5)
  assert.equal((o as { level?: number }).level, undefined, 'the level is not the question')
})

test('the budget buys slots at their LEVEL, and the write clamps it', () => {
  const c = caster(LADDER, [BUDGET])   // L1 4/4 spent, L2 1 spent, L3 0 spent
  const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:f')
  const at = (lv: number, sb?: CharacterSpellbook) => sb?.slots?.find(s => s.level === lv)

  // Three level-1 slots: 1 + 1 + 1 = 3.
  let sb = applyOutcomes(c, out, new Set(), { slots: { 1: 3 } }).spellbook
  assert.deepEqual(at(1, sb), { level: 1, total: 4, expended: 1 })

  // A level-2 and a level-1: 2 + 1 = 3.
  sb = applyOutcomes(c, out, new Set(), { slots: { 1: 1, 2: 1 } }).spellbook
  assert.deepEqual(at(1, sb), { level: 1, total: 4, expended: 3 })
  assert.deepEqual(at(2, sb), { level: 2, total: 3, expended: 0 })

  /* OVERSPENDING IS CLAMPED IN THE WRITE, not only in the picker. Asking for
     four level-1 slots against a budget of three buys three — the sheet is a UI
     and this is the thing that actually moves the numbers. */
  sb = applyOutcomes(c, out, new Set(), { slots: { 1: 4 } }).spellbook
  assert.deepEqual(at(1, sb), { level: 1, total: 4, expended: 1 }, 'three, not four')

  /* A SLOT COSTS ITS LEVEL, not one. Two level-2 slots is four levels against a
     budget of three, so only one of them comes back — and `left -= 1` passes
     every assertion above while getting this exactly wrong. */
  const deep = caster([{ level: 2, total: 3, expended: 3 }], [BUDGET])
  const dout = planActivation(deep.sheet!.features![0], buildContext(deep), deep, 'feature:f')
  const dsb = applyOutcomes(deep, dout, new Set(), { slots: { 2: 2 } }).spellbook
  assert.deepEqual(at(2, dsb), { level: 2, total: 3, expended: 2 }, 'three levels buys ONE level-2 slot')

  // A level above the cap buys nothing, however much budget is left.
  const capped = caster(LADDER, [{ ...BUDGET, budget: '9', maxLevel: '1' }])
  const cout = planActivation(capped.sheet!.features![0], buildContext(capped), capped, 'feature:f')
  const csb = applyOutcomes(capped, cout, new Set(), { slots: { 2: 1, 1: 1 } }).spellbook
  assert.deepEqual(at(2, csb), { level: 2, total: 3, expended: 1 }, 'level 2 is over the cap — untouched')
  assert.deepEqual(at(1, csb), { level: 1, total: 4, expended: 3 })
})

test('a budget never banks past what was expended', () => {
  const c = caster([{ level: 1, total: 2, expended: 1 }], [{ ...BUDGET, budget: '9' }])
  const out = planActivation(c.sheet!.features![0], buildContext(c), c, 'feature:f')
  const sb = applyOutcomes(c, out, new Set(), { slots: { 1: 5 } }).spellbook
  assert.deepEqual(sb?.slots?.[0], { level: 1, total: 2, expended: 0 })
})
