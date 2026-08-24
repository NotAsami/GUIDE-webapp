// Run: node --test src/lib/graphState.test.ts
//
// Everything here is pure: each function returns a PATCH rather than writing, so
// the whole write path is testable without a database or a renderer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, VarDef } from './database.types.ts'
import { buildContext, resolve, staleArmed } from './graph.ts'
import { longRestPatch, shortRestPatch } from './rest.ts'
import {
  answerArmed, applyOutcomes, armableFor, consumeArmed, planActivation, playerVars, restVars, scopedVars, setDmVars,
  setVars, turnGraphPatch, turnVars, withArmedCleared,
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
  assert.deepEqual(patch!.vars, ['reckless'])
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
