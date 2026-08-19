// Run: node --test src/lib/graph.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, VarDef } from './database.types.ts'
import { VAR_IDENTS, evalExpr } from './expr.ts'
import { parseDice, rerollDie, rollDice } from './dice.ts'
import {
  armedMatches, auditNode, auditVars, baseScope, buildContext, characterVars, collectVars, gid, rollResolution,
  damageFlags, matchCount, nodeGid, normalizeTag, resolve, total, varCollisions, type ResolveReq,
} from './graph.ts'
import { activeSources } from './effects.ts'
import { OPS, OP_ORDER, OP_TITLE, ROLL_SELECTORS } from './opSchema.ts'
import type { GraphOp } from './database.types.ts'

function character(over: Partial<CharacterRow>): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'Test',
    identity: { level: 7 }, sheet: {}, resources: {}, inventory: [], equipped: {},
    shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
    ...over,
  } as CharacterRow
}

const SHEET = {
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 18, cha: 8 },
  hp: { current: 41, max: 52 },
  proficiencyBonus: 3,
}

/** A feature carrying variable declarations — the only shape that matters here. */
const feat = (name: string, vars: VarDef[]): Feature => ({ id: name, name, vars })

/** §21's Arbiter path: nine variables, seven derived, four levels deep. This is
 *  the content that forced derived variables to exist. */
const ARBITER: VarDef[] = [
  { name: 'judgementBias', kind: 'derived', formula: '(mercy >= 20 || condemnation >= 20) ? 10 : 5' },
  { name: 'mercy', kind: 'stored', type: 'num', scope: 'dm' },
  { name: 'condemnation', kind: 'stored', type: 'num', scope: 'dm' },
  { name: 'judgementState', kind: 'stored', type: 'num' },
  { name: 'judgementDelta', kind: 'derived', formula: 'mercy - condemnation' },
  { name: 'canSwitchToMercy', kind: 'derived', formula: 'judgementDelta >= judgementBias' },
  { name: 'canSwitchToCondemnation', kind: 'derived', formula: 'judgementDelta <= -judgementBias' },
  { name: 'canSwitchToBalance', kind: 'derived', formula: 'mercy == condemnation' },
  { name: 'nextJudgementState', kind: 'derived', formula: 'canSwitchToBalance ? 0 : canSwitchToMercy ? 1 : canSwitchToCondemnation ? -1 : judgementState' },
  { name: 'isMercy', kind: 'derived', formula: 'judgementState == 1' },
  { name: 'isCondemnation', kind: 'derived', formula: 'judgementState == -1' },
  { name: 'isBalance', kind: 'derived', formula: 'judgementState == 0' },
]

const arbiter = (graph: object) => character({
  sheet: { ...SHEET, features: [feat('Arbiter', ARBITER)] },
  resources: { graph },
})

// --- the whole slice, on the content that forced it ------------------------

test('the Arbiter path resolves four levels deep (§21)', () => {
  // mercy 18 / condemnation 3 → delta 15, bias 5 → can switch to Mercy.
  const { scope, audit } = characterVars(arbiter({ dmVars: { mercy: 18, condemnation: 3 }, vars: { judgementState: 0 } }))
  assert.deepEqual(audit, [])
  assert.equal(scope.judgementDelta, 15)
  assert.equal(scope.judgementBias, 5)
  assert.equal(scope.canSwitchToMercy, true)
  assert.equal(scope.canSwitchToCondemnation, false)
  assert.equal(scope.canSwitchToBalance, false)
  assert.equal(scope.nextJudgementState, 1) // reads three vars, each reading judgementDelta
  assert.equal(scope.isBalance, true) // judgementState is still 0 until Recalculate commits
})

test('a locked path (20+ points) lifts the bias and everything downstream follows', () => {
  const { scope } = characterVars(arbiter({ dmVars: { mercy: 22, condemnation: 15 }, vars: { judgementState: 1 } }))
  assert.equal(scope.judgementBias, 10) // 20+ unlocks
  assert.equal(scope.judgementDelta, 7)
  assert.equal(scope.canSwitchToMercy, false) // 7 >= 10 is false; would have been true at bias 5
  assert.equal(scope.isMercy, true)
})

test('derived values are never stored — a stale stored copy is ignored', () => {
  const { scope } = characterVars(arbiter({
    dmVars: { mercy: 18, condemnation: 3 },
    vars: { judgementState: 0, judgementDelta: 999 },
  }))
  assert.equal(scope.judgementDelta, 15)
})

// --- cycles ----------------------------------------------------------------

test('a variable cycle is an error and drops the variable, never a hang', () => {
  const c = character({
    sheet: { ...SHEET, features: [feat('Loop', [
      { name: 'a', kind: 'derived', formula: 'b + 1' },
      { name: 'b', kind: 'derived', formula: 'a + 1' },
    ])] },
  })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.a, undefined)
  assert.equal(scope.b, undefined)
  assert.ok(audit.some(x => x.sev === 'err' && x.t === 'Variable cycle'))
})

test('a self-referencing variable is caught the same way', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Self', [{ name: 'a', kind: 'derived', formula: 'a + 1' }])] } })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.a, undefined)
  assert.equal(audit.filter(x => x.t === 'Variable cycle').length, 1)
})

// --- collisions, in two phases (§30) ---------------------------------------

test('two CATALOG declarations of one name warn; two ACTIVE ones are an error', () => {
  const decls = [{ name: 'charges', from: 'Wand' }, { name: 'charges', from: 'Staff' }]
  assert.equal(varCollisions(decls, 'warn')[0].sev, 'warn')
  assert.equal(varCollisions(decls, 'err')[0].sev, 'err')
  assert.equal(varCollisions([{ name: 'charges', from: 'Wand' }], 'err').length, 0)
})

test('an active collision resolves first-wins in activeSources order, and says so', () => {
  const c = character({
    sheet: { ...SHEET, features: [feat('Sheet', [{ name: 'charges', kind: 'stored', type: 'num', initial: 3 }])] },
    equipped: { cloak: { id: 'i1', name: 'Wand', slot: 'cloak', vars: [{ name: 'charges', kind: 'stored', type: 'num', initial: 9 }] } },
  })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.charges, 3) // sheet features come before gear
  assert.ok(audit.some(x => x.sev === 'err' && x.t === 'Duplicate variable'))
})

// --- the two whitelists (§33) ----------------------------------------------

test('a variable formula cannot read roll context, and the same string can', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Bad', [{ name: 'x', kind: 'derived', formula: 'cast * 2' }])] } })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.x, undefined)
  assert.ok(audit.some(x => x.t === 'Variable did not resolve'))
  // Identical formula, a contribution scope: legal.
  assert.deepEqual(evalExpr('cast * 2', { cast: 3 }), { t: 'num', flat: 6, dice: [] })
})

test('auditVars rejects a roll-context identifier at author time, before any character', () => {
  const out = auditVars([{ name: 'x', kind: 'derived', formula: 'cast * 2' }])
  assert.ok(out.some(a => a.sev === 'err' && a.t === 'Unknown identifier'))
  assert.equal(auditVars([{ name: 'x', kind: 'derived', formula: 'level * 2' }]).length, 0)
})

// --- §30's missing-variable table, one row at a time -----------------------

test('row 1 — a name declared nowhere is an author-time error', () => {
  const out = auditVars([{ name: 'x', kind: 'derived', formula: 'mercy + 1' }])
  assert.ok(out.some(a => a.sev === 'err' && a.t === 'Unknown identifier'))
})

test('row 2 — declared in the catalog but not active reads the type\'s zero', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Reader', [{ name: 'x', kind: 'derived', formula: 'mercy + 1' }])] } })
  // No catalog types: the name is simply unknown, so the formula fails.
  assert.equal(characterVars(c, {}, {}).scope.x, undefined)
  // With them: a character who was never granted the path isn't broken.
  assert.equal(characterVars(c, {}, { mercy: 'num' }).scope.x, 1)
})

test('row 2 — which zero is not a guess: bool reads false, not 0', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Reader', [{ name: 'x', kind: 'derived', formula: 'isMercy && true' }])] } })
  // A num zero substituted here would make `isMercy && true` a type error.
  assert.equal(characterVars(c, {}, { isMercy: 'bool' }).scope.x, false)
  assert.equal(characterVars(c, {}, { isMercy: 'num' }).scope.x, undefined)
})

test('row 3 — declared and active but never written reads initial, else the zero', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Res', [
    { name: 'karmicReserve', kind: 'stored', type: 'num', initial: 4 },
    { name: 'riftMarks', kind: 'stored', type: 'num' },
    { name: 'perfectJudgment', kind: 'stored', type: 'bool' },
  ])] } })
  const { scope } = characterVars(c)
  assert.equal(scope.karmicReserve, 4)
  assert.equal(scope.riftMarks, 0)
  assert.equal(scope.perfectJudgment, false)
})

test('a written value beats initial, out of the bucket its scope names', () => {
  const c = character({
    sheet: { ...SHEET, features: [feat('Res', [
      { name: 'karmicReserve', kind: 'stored', type: 'num', initial: 4 },
      { name: 'mercy', kind: 'stored', type: 'num', scope: 'dm' },
    ])] },
    resources: { graph: { vars: { karmicReserve: 1 }, dmVars: { mercy: 12 } } },
  })
  const { scope } = characterVars(c)
  assert.equal(scope.karmicReserve, 1)
  assert.equal(scope.mercy, 12)
})

test('a dm-scoped variable is not read out of the player bucket', () => {
  // The bucket IS the permission: a player writing `vars.mercy` must not move it.
  const c = character({
    sheet: { ...SHEET, features: [feat('Res', [{ name: 'mercy', kind: 'stored', type: 'num', scope: 'dm', initial: 0 }])] },
    resources: { graph: { vars: { mercy: 999 } } },
  })
  assert.equal(characterVars(c).scope.mercy, 0)
})

// --- base scope -------------------------------------------------------------

test('baseScope keys are exactly VAR_IDENTS, so the whitelist cannot drift', () => {
  const keys = Object.keys(baseScope(character({ sheet: SHEET }))).sort()
  assert.deepEqual(keys, [...VAR_IDENTS].sort())
})

test('base scope carries ability MODIFIERS off the effective sheet, not scores', () => {
  const c = character({
    sheet: SHEET,
    equipped: { neck: { id: 'i1', name: 'Belt', slot: 'neck', effects: { abilitySet: { str: 21 } } } },
  })
  const s = baseScope(c)
  assert.equal(s.str, 5) // set to 21 by gear → mod +5, not the base 14 → +2
  assert.equal(s.wis, 4)
  assert.equal(s.level, 7)
  assert.equal(s.prof, 3)
  assert.equal(s.hp, 41) // current, base
  assert.equal(s.hpMax, 52)
})

test('hpMax is effective while hp stays base', () => {
  const c = character({
    sheet: SHEET,
    shards: { slot1: { shardId: 'sh1', earned: 1, attuned: [] } },
  })
  const trees = { sh1: { id: 'sh1', name: 'S', rarity: 'c', module: 'm', icon: 'i', capacity: 5, published: true, baseMods: { maxHp: 8 }, branches: {}, nodes: [] } }
  const s = baseScope(c, trees)
  assert.equal(s.hpMax, 60)
  assert.equal(s.hp, 41)
})

// --- scoping ----------------------------------------------------------------

test('an unequipped item\'s variables do not exist', () => {
  const item = { id: 'i1', name: 'Wand', slot: 'cloak', vars: [{ name: 'charges', kind: 'stored', type: 'num', initial: 7 }] }
  const carried = character({ sheet: SHEET, inventory: [item], equipped: {} })
  const worn = character({ sheet: SHEET, equipped: { cloak: item } })

  assert.equal(characterVars(carried).scope.charges, undefined)
  assert.equal(characterVars(worn).scope.charges, 7)
})

test('collectVars keeps the first declaration and its source', () => {
  const c = character({
    sheet: { ...SHEET, features: [feat('First', [{ name: 'x', kind: 'stored', type: 'num', initial: 1 }])] },
    equipped: { cloak: { id: 'i1', name: 'Second', slot: 'cloak', vars: [{ name: 'x', kind: 'stored', type: 'num', initial: 2 }] } },
  })
  const got = collectVars(activeSources(c))
  assert.equal(got.get('x')!.def.initial, 1)
  assert.equal(got.get('x')!.from.obj.name, 'First')
})

// --- runtime failure --------------------------------------------------------

test('a formula that fails at these values is dropped and reported, not guessed', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Div', [
    { name: 'denom', kind: 'stored', type: 'num', initial: 0 },
    { name: 'x', kind: 'derived', formula: 'level / denom' },
  ])] } })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.x, undefined)
  assert.ok(audit.some(a => a.sev === 'err' && a.t === 'Variable did not resolve'))
})

test('a variable cannot hold dice or an array — those are contribution values', () => {
  const c = character({ sheet: { ...SHEET, features: [feat('Bad', [
    { name: 'd', kind: 'derived', formula: '2d6' },
    { name: 'a', kind: 'derived', formula: '[1,2,3]' },
  ])] } })
  const { scope, audit } = characterVars(c)
  assert.equal(scope.d, undefined)
  assert.equal(scope.a, undefined)
  assert.equal(audit.filter(x => x.t === 'Variable did not resolve').length, 2)
})

// --- declaration audit ------------------------------------------------------

test('auditVars enforces §30\'s declaration rules', () => {
  assert.ok(auditVars([{ name: 'Mercy', kind: 'stored', type: 'num' }]).some(a => a.t === 'Bad variable name'))
  assert.ok(auditVars([{ name: 'mercy', kind: 'stored' }]).some(a => a.t === 'Missing type'))
  assert.ok(auditVars([{ name: 'mercy', kind: 'stored', type: 'num', initial: true }]).some(a => a.t === 'Initial disagrees with type'))
  assert.ok(auditVars([{ name: 'mercy', kind: 'derived' }]).some(a => a.t === 'Missing formula'))
  assert.ok(auditVars([{ name: 'mercy', kind: 'stored', type: 'num', formula: 'level' }]).some(a => a.t === 'Stored variable has a formula'))
})

test('auditVars accepts the whole Arbiter path unchanged', () => {
  assert.deepEqual(auditVars(ARBITER), [])
})

/* ========================= the contribution graph ========================= */

const gfeat = (name: string, graph: GraphEffect[], extra: Partial<Feature> = {}): Feature =>
  ({ id: name, feature_id: name, name, graph, ...extra })

/** A character carrying features that contribute to rolls. */
const withFeatures = (features: Feature[], graph: object = {}) =>
  character({ sheet: { ...SHEET, features }, resources: { graph } })

const ATTACK: ResolveReq = { kind: 'attack' }

/* THE SHEET LAYER.
   `boost` moves a number on the sheet, not on a roll. lib/effects.ts has already
   layered it in before any roll is built, so resolving it here as well would
   count a racial +2 DEX twice — once inside the ability the roll comes from, and
   again as a contribution on top. */

test('a boost never surfaces as a roll contribution', () => {
  // The request names the feature as its SUBJECT, so a targetless effect on it
  // does apply — which is exactly the case that would double-count. Resolving a
  // generic attack instead would pass whether or not resolve() skips boosts.
  const c = withFeatures([gfeat('F', [
    { id: 'b1', op: 'boost', label: 'Elven Grace', stat: 'DEX', value: '2' },
    { id: 'e1', op: 'add', value: '2', label: 'Real' },
  ])])
  const res = resolve(buildContext(c), { kind: 'attack', subject: 'feature:F' })
  assert.ok(res.riders.some(r => r.label === 'Real'), 'a targetless add still applies to its own roll')
  assert.ok(!res.riders.some(r => r.label === 'Elven Grace'), 'the boost must not')
})

test('auditNode holds a boost to its own shape', () => {
  const ok = auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'Grace', stat: 'DEX', value: '2' }] })
  assert.deepEqual(ok.filter(a => a.sev === 'err'), [])

  // It applies to whoever carries it, so a target is a claim nothing honours.
  assert.ok(auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'G', stat: 'DEX', value: '2', target: ['roll:attack'] }] })
    .some(a => a.t === 'Boost cannot target'))

  // effectiveSheet has no expression scope, so a `when` would never fire.
  assert.ok(auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'G', stat: 'DEX', value: '2', when: 'level >= 3' }] })
    .some(a => a.t === 'Boost cannot be conditional'))

  assert.ok(auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'G', stat: 'Charisma?', value: '2' }] })
    .some(a => a.t === 'Unknown stat'))

  // A BLANK stat is one mistake, so it is one error: the schema's required-field
  // check owns it, and "unknown stat: ''" alongside is noise.
  const blank = auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'G', stat: '', value: '2' }] })
  assert.ok(blank.some(a => a.t === 'Missing stat'))
  assert.ok(!blank.some(a => a.t === 'Unknown stat'))

  // No roll to compute against, so dice cannot apply.
  assert.ok(auditNode({ graph: [{ id: 'b1', op: 'boost', label: 'G', stat: 'DEX', value: '1d6' }] })
    .some(a => a.t === 'Boost needs a plain number'))
})

// --- target matching, all three namespaces (§11) ----------------------------

test('roll: selectors match by kind and by sub-kind', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'All saves', target: ['roll:save'] },
    { id: 'e2', op: 'add', value: '3', label: 'Dex saves', target: ['roll:save.dex'] },
  ])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'save' })).flat, 2)
  assert.equal(total(resolve(ctx, { kind: 'save', sub: 'dex' })).flat, 5) // both match
  assert.equal(total(resolve(ctx, { kind: 'save', sub: 'con' })).flat, 2)
  assert.equal(total(resolve(ctx, ATTACK)).flat, 0)
})

test('tag: selectors match the subject\'s tags, through one normalisation', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '4', label: 'Radiant', target: ['tag:Fire Damage'] }])])
  const ctx = buildContext(c)
  // Authored "Fire Damage", requested "fire_damage" — same tag or targeting is
  // silently broken, which is the whole reason normalizeTag is shared.
  assert.equal(total(resolve(ctx, { kind: 'damage', tags: ['fire_damage'] })).flat, 4)
  assert.equal(total(resolve(ctx, { kind: 'damage', tags: ['FIRE DAMAGE'] })).flat, 4)
  assert.equal(total(resolve(ctx, { kind: 'damage', tags: ['cold'] })).flat, 0)
})

test('an id selector matches exactly one thing', () => {
  const c = withFeatures([gfeat('Buff', [{ id: 'e1', op: 'add', value: '5', label: 'Blessed blade', target: ['weapon:sword'] }])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'attack', subject: 'weapon:sword' })).flat, 5)
  assert.equal(total(resolve(ctx, { kind: 'attack', subject: 'weapon:axe' })).flat, 0)
})

test('a target array is an OR, and a doubly-matching effect applies once', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Either', target: ['roll:attack', 'tag:fire'] },
  ])])
  assert.equal(total(resolve(buildContext(c), { kind: 'attack', tags: ['fire'] })).flat, 2)
})

test('an effect with no target applies to its own node\'s roll', () => {
  const c = withFeatures([gfeat('SelfBuff', [{ id: 'e1', op: 'add', value: '3', label: 'Self' }])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'feature', subject: 'feature:SelfBuff' })).flat, 3)
  assert.equal(total(resolve(ctx, { kind: 'feature', subject: 'feature:Other' })).flat, 0)
})

// --- chaining (§13 step 3) --------------------------------------------------

test('a two-level chain: B boosts A\'s contribution, A contributes to the roll', () => {
  const c = withFeatures([
    gfeat('A', [{ id: 'a1', op: 'add', value: '1d6', label: 'Judgment', target: ['roll:damage'] }]),
    gfeat('B', [{ id: 'b1', op: 'add', value: '2', label: 'Empower', target: ['feature:A'] }]),
  ])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(total(r).flat, 2)
  assert.deepEqual(total(r).dice, ['1d6'])
  assert.deepEqual(r.problems, [])
})

test('a contribution cycle is dropped and reported, never a hang', () => {
  const c = withFeatures([
    gfeat('A', [
      { id: 'a1', op: 'add', value: '1', label: 'A', target: ['roll:attack'] },
      { id: 'a2', op: 'add', value: '1', label: 'A→B', target: ['feature:B'] },
    ]),
    gfeat('B', [{ id: 'b1', op: 'add', value: '1', label: 'B→A', target: ['feature:A'] }]),
  ])
  const r = resolve(buildContext(c), ATTACK)
  assert.ok(r.problems.some(p => p.sev === 'err' && p.t === 'Contribution cycle'))
  assert.ok(Number.isFinite(total(r).flat))
})

// --- §32's when/ask table, all six rows -------------------------------------

test('§32 row 1 — no when, no ask: applies, and names itself', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 2)
  // The rider is the record. It is what total() sums AND what lets the panel say
  // the +2 was "Always, from F" rather than showing an unattributed number —
  // one fact serving both, which is the point of §49.
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'always')
  assert.equal(r.riders[0].on, true)
  assert.equal(r.riders[0].label, 'Always')
  assert.equal(r.riders[0].source, 'F')
})

test('total() does not count an `always` rider twice', () => {
  // The dangerous line. `always` riders are already inside flat/dice; adding
  // them again doubles every unconditional contribution, silently.
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Flat', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '1d6', label: 'Dice', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(total(r).flat, 2)
  assert.deepEqual(total(r).dice, ['1d6'])
  assert.equal(r.riders.length, 2)
  const t = total(r)
  assert.equal(t.flat, 2)              // not 4
  assert.deepEqual(t.dice, ['1d6'])    // not ['1d6','1d6']
})

test('§32 row 2 — when true, no ask: a resolved rider, counted once', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Raging', when: 'isRaging', target: ['roll:attack'] },
  ], { vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }] })], { vars: { isRaging: true } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'active')
  assert.equal(r.riders[0].on, true)
  // This used to assert the contribution was NOT in `flat` and separately that
  // total() added it back — the two-record split. There is one record now, so
  // the property worth pinning is the one that split was protecting: it is
  // counted, and counted once.
  assert.equal(total(r).flat, 2)
  assert.equal(r.riders[0].flat, 2)
})

test('§32 row 3 — when false, no ask: does not surface at all', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Raging', when: 'isRaging', target: ['roll:attack'] },
  ], { vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }] })], { vars: { isRaging: false } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 0)
  assert.equal(r.riders.length, 0)
})

test('§32 row 4 — ask, no when: an unresolved toggle', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '1d6', label: 'Smite', ask: 'at least one failed the save', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'manual')
  assert.equal(r.riders[0].on, false)
  // The NAME is the effect's label; the ask sentence is the question it asks.
  // Crushing a sentence into the uppercased, letter-spaced name slot is how the
  // player ends up reading the condition and never seeing whose it is.
  assert.equal(r.riders[0].label, 'Smite')
  assert.equal(r.riders[0].text, 'at least one failed the save')
  assert.equal(r.riders[0].formula, '1d6') // shows the formula, rolls on tap
  assert.deepEqual(total(r).dice, []) // off, so it contributes nothing yet
})

test('§32 row 5 — when true AND ask: still an unresolved toggle', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'S', when: 'isMercy', ask: 'did it fail?', target: ['roll:damage'] },
  ], { vars: [{ name: 'isMercy', kind: 'stored', type: 'bool' }] })], { vars: { isMercy: true } })
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'manual')
  assert.equal(r.riders[0].on, false)
})

test('§32 row 6 — when false AND ask: dropped, not an unsatisfiable toggle', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'S', when: 'isMercy', ask: 'did it fail?', target: ['roll:damage'] },
  ], { vars: [{ name: 'isMercy', kind: 'stored', type: 'bool' }] })], { vars: { isMercy: false } })
  // A toggle nobody can satisfy reads as a decision the player is getting wrong.
  assert.equal(resolve(buildContext(c), { kind: 'damage' }).riders.length, 0)
})

test('effects sharing an ask label are ONE toggle driving both', () => {
  const c = withFeatures([gfeat('Judgement', [
    { id: 'e1', op: 'add', value: '2', label: 'Temp HP', ask: 'at least one failed', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '1d4', label: 'Karmic', ask: 'at least one failed', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 1) // one fact, one checkbox
  assert.equal(r.riders[0].flat, 2)
  assert.deepEqual(r.riders[0].dice, ['1d4'])
})

// --- flags and notes --------------------------------------------------------

test('adv/dis/crit are flags, and a resolved rider still sets its flag', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'adv', label: 'Pack tactics', target: ['roll:attack'] },
    { id: 'e2', op: 'crit', label: 'Sure strike', when: 'true', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.adv, true)
  assert.equal(r.crit, true)
  // Both surface now: `adv` unconditional is an `always` rider, `crit` with a
  // true `when` is an `active` one. The panel is told WHAT each grants.
  assert.deepEqual(r.riders.map(x => [x.op, x.when]), [['adv', 'always'], ['crit', 'active']])
})

test('an asked flag does not apply until the player says so', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'adv', label: 'Flanking', ask: 'flanking?', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.adv, false)
  assert.equal(r.riders[0].op, 'adv')
  assert.equal(r.riders[0].on, false)
})

test('note ops are prose, gated by when only', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'note', label: 'Half damage on a successful save.', target: ['roll:damage'] },
    { id: 'e2', op: 'note', label: 'Never shown.', when: 'false', target: ['roll:damage'] },
  ])])
  assert.deepEqual(resolve(buildContext(c), { kind: 'damage' }).notes, ['Half damage on a successful save.'])
})

// --- §39 obligation 1: negated dice, end to end -----------------------------

test('a -1d4 contribution survives all the way to a rolled number', () => {
  const c = withFeatures([gfeat('Bane', [{ id: 'e1', op: 'add', value: '-1d4', label: 'Bane', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.deepEqual(total(r).dice, ['-1d4'])

  // The path that used to break: parseDice rejected the sign, so the rider
  // silently vanished at the roller instead of erroring at the audit.
  const parsed = parseDice(total(r).dice[0])!
  assert.equal(parsed.count, -1)
  assert.equal(parsed.sides, 4)

  const rolled = rollDice(Math.abs(parsed.count), parsed.sides)
  const applied = Math.sign(parsed.count) * rolled.reduce((a, b) => a + b, 0)
  assert.ok(applied <= -1 && applied >= -4, `expected a penalty, got ${applied}`)
})

test('parseDice still reads every unsigned form its existing callers pass', () => {
  assert.deepEqual(parseDice('2d6'), { count: 2, sides: 6, mod: 0 })
  assert.deepEqual(parseDice('d8'), { count: 1, sides: 8, mod: 0 })
  assert.deepEqual(parseDice('3d4 + 3'), { count: 3, sides: 4, mod: 3 })
  assert.deepEqual(parseDice('3d4+3'), { count: 3, sides: 4, mod: 3 })
  assert.deepEqual(parseDice('1d10 - 2'), { count: 1, sides: 10, mod: -2 })
  assert.equal(parseDice('not dice'), null)
  assert.equal(parseDice(''), null)
})

test('a rerolled die keeps its FIRST face through a second reroll', () => {
  // "Rerolled from 12" has to mean what the player SAW, not the face it happened
  // to hold one reroll ago — otherwise the tooltip quietly rewrites history.
  const first = { v: 12, sides: 20 }
  const twice = rerollDie(rerollDie(first))
  assert.equal(twice.orig, 12)
  assert.equal(twice.rerolled, true)
  assert.equal(twice.sides, 20)
  assert.ok(twice.v >= 1 && twice.v <= 20)
  assert.equal(first.v, 12) // and never mutates the die it was given
})

// --- §39 obligation 2: the null contribution --------------------------------

test('a contribution failing at these values is reported, and the roll still resolves', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Good', target: ['roll:attack'] },
    { id: 'e2', op: 'add', value: 'level / denom', label: 'Broken', target: ['roll:attack'] },
  ], { vars: [{ name: 'denom', kind: 'stored', type: 'num' }] })], { vars: { denom: 0 } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 2) // the rest of the roll is unaffected
  assert.equal(r.notes.length, 0) // NOT prose — the player must not read it as rule text
  assert.ok(r.problems.some(p => p.sev === 'err' && p.t === 'Contribution did not resolve'))
})

test('a condition that is not a yes/no answer is reported, not guessed', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '2', label: 'X', when: 'level', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 0)
  assert.ok(r.problems.some(p => p.t === 'Condition did not resolve'))
})

// --- scoping ----------------------------------------------------------------

test('an unequipped item\'s contributions do not exist', () => {
  const item = { id: 'i1', item_id: 'i1', name: 'Wand', slot: 'cloak', graph: [{ id: 'e1', op: 'add' as const, value: '3', label: 'Wand', target: ['roll:attack'] }] }
  assert.equal(total(resolve(buildContext(character({ sheet: SHEET, inventory: [item] })), ATTACK)).flat, 0)
  assert.equal(total(resolve(buildContext(character({ sheet: SHEET, equipped: { cloak: item } })), ATTACK)).flat, 3)
})

// --- gids -------------------------------------------------------------------

test('gid reads the catalog back-ref first, so a granted copy keeps its identity', () => {
  // gearFeatures() rewrites `id` to gear-<item>-<n>; the back-ref is what survives.
  assert.equal(gid('feature', { feature_id: 'arbiter', id: 'gear-wand-0' }), 'feature:arbiter')
  assert.equal(gid('feature', { id: 'seeded' }), 'feature:seeded')
  assert.equal(gid('spell', { spell_id: 'burning-hands' }), 'spell:burning-hands')
})

test('two shards with a core node produce distinct gids', () => {
  assert.notEqual(nodeGid('sh1', 'core'), nodeGid('sh2', 'core'))
  assert.equal(nodeGid('sh1', 'core'), 'shardnode:sh1.core')
})

test('normalizeTag collapses the ways a tag fragments', () => {
  assert.equal(normalizeTag('  Fire Damage '), 'fire_damage')
  assert.equal(normalizeTag('RADIANT'), 'radiant')
})

// --- author-time (§17) ------------------------------------------------------

test('auditNode catches every structural authoring error', () => {
  const bad = auditNode({ graph: [
    { id: 'e1', op: 'add', label: '', target: ['roll:attack'] },
    { id: 'e2', op: 'adv', value: '2', label: 'Flag with a number', target: ['roll:attack'] },
    { id: 'e3', op: 'note', label: 'Prose', ask: 'really?', target: ['roll:attack'] },
    { id: 'e4', op: 'add', value: '2', label: 'Bad kind', target: ['roll:nonsense'] },
    { id: 'e5', op: 'add', value: '2', label: 'Bad namespace', target: ['creature:goblin'] },
    { id: 'e6', op: 'add', value: '2 +', label: 'Bad formula', target: ['roll:attack'] },
    { id: 'e7', op: 'add', value: 'mercy', label: 'Unknown ident', target: ['roll:attack'] },
  ] })
  // "Missing amount" / "Missing note text" are named by the OP SCHEMA's field
  // labels, not by a branch per op — which is what lets a new op arrive without
  // the audit having to learn its fields.
  for (const t of ['Missing label', 'Missing amount', 'Value on a flag', 'Toggle on a note',
                   'Unknown roll kind', 'Unknown selector', 'Bad formula', 'Unknown identifier']) {
    assert.ok(bad.some(a => a.sev === 'err' && a.t === t), `expected a "${t}" finding`)
  }
})

test('required fields come from the op schema, so a new op needs no audit branch', () => {
  // crit/note declare their own required fields; auditNode never mentions either.
  assert.ok(auditNode({ graph: [{ id: 'e1', op: 'crit', label: 'Champion', target: ['roll:attack'] }] })
    .some(a => a.t === 'Missing crits on'))
  assert.ok(auditNode({ graph: [{ id: 'e1', op: 'note', label: 'Cover', target: ['roll:attack'] }] })
    .some(a => a.t === 'Missing note text'))
  assert.deepEqual(
    auditNode({ graph: [{ id: 'e1', op: 'crit', label: 'Champion', threshold: '19', target: ['roll:attack'] }] }),
    [],
  )
})

test('a crit threshold resolves, and the lowest one wins', () => {
  const c = withFeatures([gfeat('Champion', [
    { id: 'e1', op: 'crit', label: 'Improved Critical', threshold: '19', target: ['roll:attack'] },
    { id: 'e2', op: 'crit', label: 'Superior Critical', threshold: '18', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.crit, true)
  // A crit range is a threshold, not a stacking bonus — 18, never 17.
  assert.equal(r.critFrom, 18)
})

test('a note renders its text, falling back to the label', () => {
  const c = withFeatures([gfeat('Darkvision', [
    { id: 'e1', op: 'note', label: 'Darkvision 60 ft', text: 'You see in dim light within 60 ft as if it were bright light.', target: ['roll:attack'] },
    { id: 'e2', op: 'note', label: 'Old note with no text', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.deepEqual(r.notes, ['You see in dim light within 60 ft as if it were bright light.', 'Old note with no text'])
})

test('a contribution formula MAY read roll context, unlike a variable formula', () => {
  // The two whitelists, from the other side: `cast` is legal here and not in §33's
  // variable set — the same walk, a different permitted set.
  assert.deepEqual(auditNode({ graph: [{ id: 'e1', op: 'add', value: 'cast * 1d6', label: 'Upcast', target: ['roll:damage'] }] }), [])
  assert.ok(auditVars([{ name: 'x', kind: 'derived', formula: 'cast * 2' }]).some(a => a.t === 'Unknown identifier'))
})

test('a dangling id target is an error; a tag matching nothing is not', () => {
  const catalog = [{ gid: 'spell:burning-hands' as const }]
  const dangling = auditNode({ graph: [{ id: 'e1', op: 'add', value: '1', label: 'X', target: ['spell:nonexistent'] }] }, catalog)
  assert.ok(dangling.some(a => a.t === 'Dangling target'))

  const emptyTag = auditNode({ graph: [{ id: 'e1', op: 'add', value: '1', label: 'X', target: ['tag:nobody'] }] }, catalog)
  assert.deepEqual(emptyTag, [])
})

test('matchCount counts against the catalog, and zero is a signal not an error', () => {
  const catalog = [
    { gid: 'spell:a' as const, tags: ['Fire Damage'] },
    { gid: 'spell:b' as const, tags: ['fire_damage'] },
    { gid: 'spell:c' as const, tags: ['cold'] },
  ]
  assert.equal(matchCount('tag:fire damage', catalog), 2) // normalisation applies here too
  assert.equal(matchCount('tag:nobody', catalog), 0)
  assert.equal(matchCount('spell:a', catalog), 1)
  assert.equal(matchCount('spell:zzz', catalog), 0)
  assert.equal(matchCount('roll:attack', catalog), Infinity)
})

test('auditNode also runs the variable checks for the same node', () => {
  assert.ok(auditNode({ vars: [{ name: 'mercy', kind: 'stored' }] }).some(a => a.t === 'Missing type'))
})

// --- the audit's evaluation scope (§41) -------------------------------------
// These pin WHICH ERRORS BLOCK SAVE, which is the whole reason the scope had to
// be decided deliberately rather than inherited.

test('a division by a VARIABLE passes the audit; a literal division by zero does not', () => {
  const vars: VarDef[] = [{ name: 'mercy', kind: 'stored', type: 'num' }]
  // §39's named trap. Against all-zeros this blocked on every character, because
  // `mercy` was 0 there — a false positive on content that is perfectly legal.
  assert.deepEqual(
    auditNode({ vars, graph: [{ id: 'e1', op: 'add', value: '10 / mercy', label: 'Scaled', target: ['roll:damage'] }] }),
    [],
  )
  // Wrong in every scope, so it still blocks. Author time and roll time now cover
  // disjoint cases: this one here, `10 / mercy` at mercy=0 in Resolution.problems.
  assert.ok(
    auditNode({ graph: [{ id: 'e1', op: 'add', value: '5 / 0', label: 'Broken', target: ['roll:damage'] }] })
      .some(a => a.t === 'Bad formula'),
  )
})

test('boolean variables bind as booleans, so a two-bool condition is not a type error', () => {
  // The false positive §39 did NOT name: under all-zeros both bound to the NUMBER
  // 0, and `&&` on numbers is a §36 rejection. A `when` gate over two bools is the
  // single most likely thing a DM writes.
  const vars: VarDef[] = [
    { name: 'isRaging', kind: 'stored', type: 'bool' },
    { name: 'hasCharge', kind: 'stored', type: 'bool' },
  ]
  assert.deepEqual(
    auditNode({ vars, graph: [{ id: 'e1', op: 'add', value: '2', label: 'Rage', when: 'isRaging && hasCharge', target: ['roll:damage'] }] }),
    [],
  )
})

test('a derived variable is bound by the type its formula produces', () => {
  // `type` is absent on derived vars by design (§30), so the probe has to run the
  // walk to learn it. Binding a num probe here would fail the `!` and the `&&`.
  const vars: VarDef[] = [
    { name: 'mercy', kind: 'stored', type: 'num' },
    { name: 'isMerciful', kind: 'derived', formula: 'mercy > 5' },
  ]
  assert.deepEqual(
    auditNode({ vars, graph: [{ id: 'e1', op: 'add', value: '2', label: 'M', when: '!isMerciful', target: ['roll:damage'] }] }),
    [],
  )
})

test('type-correctness cuts both ways — real type errors still block', () => {
  const vars: VarDef[] = [{ name: 'isRaging', kind: 'stored', type: 'bool' }]
  // Arithmetic on a bool is a genuine §36 rejection, and the fix must not swallow
  // it. This is what makes the probe TYPE-correct rather than merely non-zero.
  assert.ok(
    auditNode({ vars, graph: [{ id: 'e1', op: 'add', value: 'isRaging + 1', label: 'X', target: ['roll:damage'] }] })
      .some(a => a.t === 'Bad formula'),
  )
})

test('a variable cycle is caught at author time, not left for the table', () => {
  const cyc: VarDef[] = [
    { name: 'a', kind: 'derived', formula: 'b + 1' },
    { name: 'b', kind: 'derived', formula: 'a + 1' },
  ]
  assert.ok(auditVars(cyc).some(x => x.t === 'Variable cycle'))
})

// --- damage flags (§25) -----------------------------------------------------

test('damage flags read by damage kind, honouring when', () => {
  const c = withFeatures([gfeat('Ward', [
    { id: 'e1', op: 'resist', label: 'Fire ward', target: ['tag:fire'] },
    { id: 'e2', op: 'immune', label: 'Cold ward', target: ['tag:cold'], when: 'false' },
  ])])
  const ctx = buildContext(c)
  assert.deepEqual(damageFlags(ctx, 'fire'), { resist: true, vuln: false, immune: false })
  // Authored "fire", asked "FIRE" — one normalisation, same as targeting.
  assert.deepEqual(damageFlags(ctx, 'FIRE'), { resist: true, vuln: false, immune: false })
  assert.deepEqual(damageFlags(ctx, 'cold'), { resist: false, vuln: false, immune: false })
  assert.deepEqual(damageFlags(ctx, 'acid'), { resist: false, vuln: false, immune: false })
})

test('a damage flag never reaches a Resolution', () => {
  // Being hit by fire is not a roll. If these folded into resolve() they would
  // show up as riders on an unrelated attack.
  const c = withFeatures([gfeat('Ward', [{ id: 'e1', op: 'resist', label: 'Fire ward', target: ['tag:fire'] }])])
  const r = resolve(buildContext(c), { kind: 'damage', tags: ['fire'] })
  assert.equal(r.riders.length, 0)
  assert.equal(total(r).flat, 0)
  assert.deepEqual(r.problems, [])
})

test('auditNode holds damage flags to their own shape', () => {
  const noTarget = auditNode({ graph: [{ id: 'e1', op: 'resist', label: 'Ward' }] })
  assert.ok(noTarget.some(a => a.t === 'Damage flag with no target'))

  const asked = auditNode({ graph: [{ id: 'e1', op: 'vuln', label: 'W', target: ['tag:fire'], ask: 'Take extra?' }] })
  assert.ok(asked.some(a => a.t === 'Toggle on a damage flag'))

  // Still flags, never numbers — the existing ItemEffects rule covers the new ops.
  const valued = auditNode({ graph: [{ id: 'e1', op: 'immune', label: 'W', target: ['tag:fire'], value: '2' }] })
  assert.ok(valued.some(a => a.t === 'Value on a flag'))

  assert.deepEqual(auditNode({ graph: [{ id: 'e1', op: 'resist', label: 'Ward', target: ['tag:fire'] }] }), [])
})

test('a level table steps, clamps, and overrides the flat amount', () => {
  // Filled at 1/5/11 — how a 5e progression is actually written. Sparse means
  // STEP: level 7 reads the level-5 row, not nothing.
  const table = new Array(21).fill('')
  table[1] = '1'; table[5] = '2'; table[11] = '3'
  const at = (level: number) => {
    const c = character({
      identity: { level },
      sheet: { ...SHEET, features: [gfeat('Savage', [
        { id: 'e1', op: 'add', value: '99', byLevel: table, label: 'Savage', target: ['roll:damage'] },
      ])] },
    })
    return total(resolve(buildContext(c), { kind: 'damage' })).flat
  }
  assert.equal(at(1), 1)
  assert.equal(at(4), 1)   // steps down to the level-1 row
  assert.equal(at(5), 2)
  assert.equal(at(7), 2)
  assert.equal(at(11), 3)
  assert.equal(at(20), 3)
  assert.equal(at(30), 3)  // clamps rather than erroring
  // `value: '99'` is never read while the table has any filled slot.
})

test('an empty level table leaves the flat amount alone', () => {
  const c = withFeatures([gfeat('Plain', [
    { id: 'e1', op: 'add', value: '4', byLevel: new Array(21).fill(''), label: 'Plain', target: ['roll:damage'] },
  ])])
  assert.equal(total(resolve(buildContext(c), { kind: 'damage' })).flat, 4)
})

test('a broken cell in a level table is caught at author time', () => {
  const table = new Array(21).fill('')
  table[1] = '2'; table[5] = '2 +'
  const found = auditNode({ graph: [{ id: 'e1', op: 'add', value: '1', byLevel: table, label: 'T', target: ['roll:damage'] }] })
  assert.ok(found.some(a => a.t === 'Bad level table' && a.s.includes('5')))
})

test('auditNode holds an activation to its own shape', () => {
  const vars: VarDef[] = [
    { name: 'isRaging', kind: 'stored', type: 'bool' },
    { name: 'mercy', kind: 'stored', type: 'num', scope: 'dm' },
    { name: 'doubled', kind: 'derived', formula: 'level * 2' },
  ]
  const act = (over: Partial<GraphEffect>): GraphEffect =>
    ({ id: 'a1', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Rage', ...over })

  // §31: writability is a LOCATION. A player presses this button, and migration
  // 0015 reverts a player write to dmVars — so without this check the activation
  // would look fine and silently no-op at the table.
  assert.ok(auditNode({ vars, graph: [act({ variable: 'mercy', value: '5' })] })
    .some(a => a.t === 'Activation writes a DM variable'))
  assert.ok(auditNode({ vars, graph: [act({ variable: 'doubled', value: '5' })] })
    .some(a => a.t === 'Writing a derived variable'))
  assert.ok(auditNode({ vars, graph: [act({ variable: 'nope' })] })
    .some(a => a.t === 'Unknown variable'))
  assert.ok(auditNode({ vars, graph: [act({ target: ['roll:attack'] })] })
    .some(a => a.t === 'Target on an activation'))
  // A `value` on an activation is legal — it is the assigned value, not a
  // contribution, so the "value on a flag" rule must not fire. Warnings are
  // expected here: `mercy` and `doubled` are declared and unread by this node.
  assert.deepEqual(auditNode({ vars, graph: [act({})] }).filter(a => a.sev === 'err'), [])
})

test('an activation never reaches a Resolution', () => {
  // It writes on a press. Folding it into resolve() would fire it on every roll
  // that matched, which is not what "on activation" means.
  const c = withFeatures([gfeat('Rage', [
    { id: 'a1', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Rage' },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 0)
  assert.equal(total(r).flat, 0)
  assert.deepEqual(r.problems, [])
})

test('every op reaches the palette — a schema entry is not an app feature', () => {
  // This slice has repeatedly added a thing to a type or a schema and forgotten
  // the control that authors it (byLevel, order, the activation palette,
  // resetOn). This catches the one instance of that class which IS mechanically
  // checkable: an op the DM cannot add is an op that may as well not exist.
  const ops = Object.keys(OPS) as GraphOp[]
  for (const op of ops) {
    assert.ok(OP_ORDER.includes(op), `${op} is in OPS but not in OP_ORDER — no palette button offers it`)
    assert.ok(OP_TITLE[op], `${op} has no palette label`)
  }
  assert.equal(OP_ORDER.length, ops.length)
})

test('the authored Rage shape: when + ask stays an unresolved toggle, never applied', () => {
  // Mirrors a real authored feature, field for field, because a report of "the
  // +2 just shows up" is only answerable against the exact shape.
  const rage = (when?: string): Feature => ({
    id: 'rage', name: 'Rage',
    vars: [{ name: 'isRaging', kind: 'stored', type: 'bool', scope: 'player', initial: false, resetOn: 'long' }],
    graph: [{
      id: 'elu4pl9', op: 'add', value: '2', label: 'Rage', ask: 'You mad?',
      target: ['roll:damage'], byLevel: new Array(21).fill(''), ...(when ? { when } : {}),
    }],
  })
  const roll = (f: Feature, isRaging: boolean) => {
    const c = character({ sheet: { ...SHEET, features: [f] }, resources: { graph: { vars: { isRaging } } } })
    return resolve(buildContext(c), { kind: 'damage' })
  }

  // ask + when TRUE — a toggle, not a bonus. The +2 is NOT in the number: a
  // `manual` rider is the panel's to add, never the roller's.
  const on = roll(rage('isRaging'), true)
  assert.equal(on.riders.length, 1)
  assert.equal(on.riders[0].when, 'manual')
  assert.equal(on.riders[0].on, false)
  assert.equal(total(on).flat, 0)

  // ask + when FALSE — §32 row 6, gone entirely.
  assert.equal(roll(rage('isRaging'), false).riders.length, 0)

  // ask alone — identical to the when-true case, which is the point: `when`
  // decides whether the toggle EXISTS, never whether it is already answered.
  const askOnly = roll(rage(), false)
  assert.equal(askOnly.riders.length, 1)
  assert.equal(askOnly.riders[0].when, 'manual')
  assert.equal(total(askOnly).flat, 0)

  // An empty-string ask is NOT a toggle — it is no ask at all, and the +2
  // applies. This is the one way the two cases could diverge in stored data.
  const blank = roll({ ...rage(), graph: [{ id: 'e', op: 'add', value: '2', label: 'Rage', ask: '', target: ['roll:damage'] }] }, false)
  assert.equal(blank.riders[0].when, 'always')   // applied, and named
  assert.equal(total(blank).flat, 2)             // counted once
})

test('a variable nothing reads or writes is a warning', () => {
  // Rage declared `isRaging` with no `when` referencing it and no setVar writing
  // it, so the player's toggle moved a value the engine never consults. Declaring
  // state nothing uses is the authoring-side twin of a control nothing reads.
  const orphan = auditNode({
    vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }],
    graph: [{ id: 'e1', op: 'add', value: '2', label: 'Rage', ask: 'You mad?', target: ['roll:damage'] }],
  })
  assert.ok(orphan.some(a => a.sev === 'warn' && a.t === 'Variable is never used'))

  // Read by a condition → fine.
  assert.equal(auditNode({
    vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }],
    graph: [{ id: 'e1', op: 'add', value: '2', label: 'R', when: 'isRaging', target: ['roll:damage'] }],
  }).some(a => a.t === 'Variable is never used'), false)

  // Written by an activation → also fine.
  assert.equal(auditNode({
    vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }],
    graph: [{ id: 'e1', op: 'setVar', variable: 'isRaging', value: 'true', label: 'Rage' }],
  }).some(a => a.t === 'Variable is never used'), false)
})

// --- §25 inline compute in prose --------------------------------------------

test('note text computes its interpolations, and the player never sees the source', () => {
  const c = withFeatures([gfeat('Judgement', [
    { id: 'e1', op: 'note', label: 'Judgement', text: 'DC {8 + prof + 3}, Wisdom save.', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.deepEqual(r.notes, ['DC 14, Wisdom save.'])   // level 7 → prof 3
  assert.equal(r.problems.length, 0)
})

test('a note reads its own feature\u2019s variables', () => {
  const c = withFeatures([gfeat('Reserve', [
    { id: 'e1', op: 'note', label: 'Reserve', text: 'You hold {karmicReserve} charges.', target: ['roll:attack'] },
  ], { vars: [{ name: 'karmicReserve', kind: 'stored', type: 'num' }] })], { vars: { karmicReserve: 4 } })
  assert.deepEqual(resolve(buildContext(c), ATTACK).notes, ['You hold 4 charges.'])
})

test('a conditional phrase picks a string, and both branches must be strings', () => {
  const c = withFeatures([gfeat('Arrest', [
    { id: 'e1', op: 'note', label: 'Arrest', target: ['roll:attack'],
      text: 'The target is held{upgraded ? " and restrained." : "."}' },
  ], { vars: [{ name: 'upgraded', kind: 'stored', type: 'bool' }] })], { vars: { upgraded: true } })
  assert.deepEqual(resolve(buildContext(c), ATTACK).notes, ['The target is held and restrained.'])
})

test('an interpolation that does not compute keeps its source and reports a problem', () => {
  // Silently dropping it would hide the fault from author and player both.
  const c = withFeatures([gfeat('Broken', [
    { id: 'e1', op: 'note', label: 'Broken', text: 'DC {8 / zero}.', target: ['roll:attack'] },
  ], { vars: [{ name: 'zero', kind: 'stored', type: 'num' }] })], { vars: { zero: 0 } })
  const r = resolve(buildContext(c), ATTACK)
  assert.deepEqual(r.notes, ['DC {8 / zero}.'])
  assert.ok(r.problems.some(p => p.sev === 'err' && p.t === 'Note did not compute'))
})

// --- §40's ask-on-a-note rule, relaxed --------------------------------------

test('ask on a note is an error only when the note has nothing to reveal', () => {
  const bare = auditNode({ graph: [
    { id: 'e1', op: 'note', label: 'Cover', text: 'Ignores half cover.', ask: 'did it hit?', target: ['roll:attack'] },
  ] })
  assert.ok(bare.some(a => a.t === 'Toggle on a note'))

  // The same shape, with something to reveal: the toggle is what decides whether
  // the player gets the number at all.
  const computes = auditNode({ graph: [
    { id: 'e1', op: 'note', label: 'Sanctity', text: 'DC {8 + prof}, Wisdom.', ask: 'hit with Sanctity', target: ['roll:attack'] },
  ] })
  assert.equal(computes.filter(a => a.t === 'Toggle on a note').length, 0)
})

test('an asked note becomes a rider that reveals, and contributes nothing', () => {
  const c = withFeatures([gfeat('Sanctity', [
    { id: 'e1', op: 'note', label: 'Sanctity', text: 'DC {8 + prof}, Wisdom save.',
      ask: 'hit with Sanctity', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.notes.length, 0)          // it is a toggle now, not a standing note
  assert.equal(r.riders.length, 1)
  const rd = r.riders[0]
  assert.equal(rd.op, 'note')
  assert.equal(rd.when, 'manual')
  assert.equal(rd.on, false)
  assert.equal(rd.label, 'Sanctity')
  assert.equal(rd.text, 'hit with Sanctity')   // the question
  assert.equal(rd.reveal, 'DC 11, Wisdom save.') // the answer, already computed
  assert.equal(total(r).flat, 0)               // and it moves no number
})

test('a note and a contribution sharing one ask are ONE checkbox', () => {
  // The whole reason the note rides the ask group instead of its own list:
  // "+2d8 radiant" and "DC 16, Wisdom" are one confirmation, not two.
  const c = withFeatures([gfeat('Sanctity', [
    { id: 'e1', op: 'add', value: '2d8', dmgType: 'radiant', label: 'Sanctified Arrest',
      ask: 'hit with Sanctity', target: ['roll:damage'] },
    { id: 'e2', op: 'note', label: 'Sanctity', text: 'DC {8 + prof}, Wisdom save.',
      ask: 'hit with Sanctity', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 1)
  assert.deepEqual(r.riders[0].dice, ['2d8'])
  assert.equal(r.riders[0].reveal, 'DC 11, Wisdom save.')
})

test('a variable read ONLY by note text is not reported as never used', () => {
  // Display-only reads are most of what inline compute is for. Warning on them
  // trains the author to ignore the warning that catches real dead state.
  const node = {
    vars: [{ name: 'karmicReserve', kind: 'stored', type: 'num' }] as VarDef[],
    graph: [{ id: 'e1', op: 'note', label: 'Reserve', text: 'You hold {karmicReserve}.', target: ['roll:attack'] }] as GraphEffect[],
  }
  assert.equal(auditNode(node).filter(a => a.t === 'Variable is never used').length, 0)
  // …and one nothing reads at all still is.
  assert.ok(auditNode({ ...node, vars: [...node.vars, { name: 'dead', kind: 'stored', type: 'num' }] })
    .some(a => a.t === 'Variable is never used' && a.id === 'dead'))
})

test('a typo inside note text is caught at author time, not by the player', () => {
  const bad = auditNode({ graph: [
    { id: 'e1', op: 'note', label: 'Reserve', text: 'You hold {karmicReserve}.', target: ['roll:attack'] },
  ] })
  assert.ok(bad.some(a => a.sev === 'err' && a.t === 'Unknown identifier'))
})

test('every GraphEffect field is authorable, or is explicitly recorded as not yet', () => {
  // THE RECURRING BUG THIS EXISTS TO END: a field lands in the type, the engine
  // reads it, and nothing ever renders a control — so it ships inert and the
  // authoring surface silently cannot express what the engine supports. dmgType
  // was the sixth. This map is `Record<keyof GraphEffect, …>`, so it is
  // EXHAUSTIVE BY TYPE: add a field to GraphEffect and this stops compiling
  // until you say which half it belongs to.
  const COVERAGE: Record<keyof GraphEffect, 'universal' | 'schema' | 'deferred'> = {
    // Rendered by the editor itself, on every node regardless of op.
    id: 'universal', op: 'universal', target: 'universal', label: 'universal',
    when: 'universal', ask: 'universal',
    // Rendered from OPS[op].fields — asserted below.
    value: 'schema', byLevel: 'schema', variable: 'schema', text: 'schema',
    threshold: 'schema', dmgType: 'schema', once: 'schema', stat: 'schema',
    // Nothing is deferred today. The category stays because it is the honest
    // place to put a field that is stored but not yet authorable, and saying so
    // out loud beats leaving it silently uncovered.
  }

  const authored = new Set(Object.values(OPS).flatMap(d => d.fields.map(f => f.key)))
  const missing = Object.entries(COVERAGE)
    .filter(([k, kind]) => kind === 'schema' && !authored.has(k))
    .map(([k]) => k)
  assert.deepEqual(missing, [], `field(s) in the type with no control: ${missing.join(', ')}`)

  // And the reverse: a schema field naming something GraphEffect does not carry
  // would render a control that writes to nothing.
  const stray = [...authored].filter(k => !(k in COVERAGE))
  assert.deepEqual(stray, [], `schema field(s) with no home on GraphEffect: ${stray.join(', ')}`)

  // A classification can go stale in the other direction too: `once` was
  // 'deferred' and then became authorable, and nothing would have noticed.
  const stale = Object.entries(COVERAGE)
    .filter(([k, kind]) => kind === 'deferred' && authored.has(k))
    .map(([k]) => k)
  assert.deepEqual(stale, [], `field(s) marked deferred that ARE authorable: ${stale.join(', ')}`)
})

test('a damage-typed contribution rides its type all the way to the rider', () => {
  const c = withFeatures([gfeat('Sear', [
    { id: 'e1', op: 'add', value: '2d6', dmgType: 'radiant', label: 'Searing Light', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.deepEqual(total(r).dice, ['2d6'])
  assert.equal(r.riders[0].dmgType, 'radiant')
})

// --- §16 the armed queue -----------------------------------------------------

const armedChar = (armed: object[], features: Feature[] = []) =>
  character({ sheet: { ...SHEET, features }, resources: { graph: { armed } } })

test('a `once` contribution does NOT apply to a matching roll', () => {
  // THE BUG THIS SLICE FIXES. `once` has been in the type since 1a with nothing
  // reading it, so until now it meant "every attack" — the exact opposite of
  // what it says. It applies only once ARMED.
  const c = withFeatures([gfeat('Boost', [
    { id: 'e1', op: 'add', value: '4', once: true, label: 'Boosted Cut', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 0)
  assert.equal(r.riders.length, 0)
})

test('an armed modifier applies, and total() counts it exactly once', () => {
  // The `always` double-count trap: it is folded into flat AND named as a rider.
  const c = armedChar([{ id: 'a1', source: 'feature:Boost', label: 'Boosted Cut', kind: 'attack', op: 'add', value: '4', at: 1 }])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 4)
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].armedId, 'a1')
  assert.equal(r.riders[0].when, 'always')
})

test('an armed flag sets the flag rather than a number', () => {
  const c = armedChar([{ id: 'a1', source: 'feature:F', label: 'Sure Strike', kind: 'attack', op: 'adv', at: 1 }])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.adv, true)
  assert.equal(total(r).flat, 0)
})

test('the armed predicate: kind must match, sub and subject narrow', () => {
  const req: ResolveReq = { kind: 'save', sub: 'dex', subject: 'feature:F' }
  const base = { id: 'a', source: 's', label: 'l', op: 'add' as const, at: 1 }
  assert.equal(armedMatches({ ...base, kind: 'save' }, req), true)          // bare kind = "any save"
  assert.equal(armedMatches({ ...base, kind: 'save', sub: 'dex' }, req), true)
  assert.equal(armedMatches({ ...base, kind: 'save', sub: 'wis' }, req), false)
  assert.equal(armedMatches({ ...base, kind: 'attack' }, req), false)
  assert.equal(armedMatches({ ...base, kind: 'save', subject: 'feature:F' }, req), true)
  assert.equal(armedMatches({ ...base, kind: 'save', subject: 'feature:Other' }, req), false)
  // A sub on the mod but none on the request: the request is the wider one, so no.
  assert.equal(armedMatches({ ...base, kind: 'save', sub: 'dex' }, { kind: 'save' }), false)
})

test('an armed modifier whose formula breaks is reported and STAYS armed', () => {
  const c = armedChar([{ id: 'a1', source: 'feature:F', label: 'Broken', kind: 'attack', op: 'add', value: 'nope', at: 1 }])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 0)
  assert.ok(r.problems.some(p => p.sev === 'err' && p.t === 'Armed modifier did not resolve'))
})

test('a `once` effect must target a roll kind, because the queue is keyed by one', () => {
  assert.ok(auditNode({ graph: [
    { id: 'e1', op: 'add', value: '4', once: true, label: 'Boost', target: ['tag:fire'] },
  ] }).some(a => a.sev === 'err' && a.t === 'Armed modifier needs a roll target'))

  assert.equal(auditNode({ graph: [
    { id: 'e1', op: 'add', value: '4', once: true, label: 'Boost', target: ['roll:attack'] },
  ] }).filter(a => a.t === 'Armed modifier needs a roll target').length, 0)
})

test('an ask groups on its MEANING, not on its bytes', () => {
  // The ask is prose and a key at the same time. Byte-compared, a trailing space
  // silently makes two toggles for one decision — identical on screen.
  const c = withFeatures([gfeat('Sanctity', [
    { id: 'e1', op: 'add', value: '2d8', label: 'A', ask: 'hit with Sanctity', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '1d4', label: 'B', ask: '  Hit  with sanctity ', target: ['roll:damage'] },
  ])])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.riders.length, 1)
  assert.deepEqual(r.riders[0].dice, ['2d8', '1d4'])
  // The FIRST spelling is kept for display — normalisation is for the key only.
  assert.equal(r.riders[0].text, 'hit with Sanctity')
})

test('genuinely different asks stay two decisions', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2d8', label: 'A', ask: 'did it hit?', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '1d4', label: 'B', ask: 'is it undead?', target: ['roll:damage'] },
  ])])
  assert.equal(resolve(buildContext(c), { kind: 'damage' }).riders.length, 2)
})

test('a note authored ABOVE its contribution still rolls the contribution', () => {
  // The order asymmetry that shipped broken: the group takes its op from its
  // FIRST member, and a note contributes prose only — so a note listed first
  // made the whole group a note. The toggle revealed the text and silently
  // dropped the dice, with no roll button and nothing on screen to notice.
  const effs = [
    { id: 'e1', op: 'note' as const, label: 'Condemning Strike', text: 'DC {8 + prof}, Wisdom.', ask: 'hit with Sanctity', target: ['roll:damage'] },
    { id: 'e2', op: 'add' as const, value: '2d6', dmgType: 'radiant', label: 'Condemning Strike', ask: 'hit with Sanctity', target: ['roll:damage'] },
  ]
  for (const graph of [effs, [effs[1], effs[0]]]) {
    const r = resolve(buildContext(withFeatures([gfeat('Sanctity', graph)])), { kind: 'damage' })
    assert.equal(r.riders.length, 1)
    assert.equal(r.riders[0].op, 'add', 'the contribution defines what the group does')
    assert.deepEqual(r.riders[0].dice, ['2d6'])
    assert.equal(r.riders[0].dmgType, 'radiant')
    assert.equal(r.riders[0].reveal, 'DC 11, Wisdom.')
  }
})

test('one ask, two kinds of contribution, is reported rather than silently halved', () => {
  const mixed = auditNode({ graph: [
    { id: 'e1', op: 'add', value: '2d6', label: 'A', ask: 'did it hit?', target: ['roll:damage'] },
    { id: 'e2', op: 'adv', label: 'B', ask: 'did it hit?', target: ['roll:attack'] },
  ] })
  assert.ok(mixed.some(a => a.sev === 'warn' && a.t === 'One checkbox, two kinds of effect'))

  // A note joining a contribution is the SUPPORTED shape — prose plus a number.
  assert.equal(auditNode({ graph: [
    { id: 'e1', op: 'add', value: '2d6', label: 'A', ask: 'did it hit?', target: ['roll:damage'] },
    { id: 'e2', op: 'note', text: 'DC {8 + prof}.', label: 'B', ask: 'did it hit?', target: ['roll:damage'] },
  ] }).filter(a => a.t === 'One checkbox, two kinds of effect').length, 0)
})

// --- §49: one record, and the roller/panel split ----------------------------

test('total() counts each contribution exactly once, whatever kind it is', () => {
  // The property the deleted fold kept breaking, now true by construction: there
  // is one record of a contribution, so there is nothing to add twice.
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] },
    { id: 'e2', op: 'add', value: '3', label: 'Raging', when: 'isRaging', target: ['roll:attack'] },
    { id: 'e3', op: 'add', value: '1d6', label: 'Dice', target: ['roll:attack'] },
  ], { vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }] })], { vars: { isRaging: true } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders.length, 3)
  assert.equal(total(r).flat, 5)                 // 2 + 3, each once
  assert.deepEqual(total(r).dice, ['1d6'])
})

test('total() is the ROLLER half of the split: everything except `manual`', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] },
    { id: 'e2', op: 'add', value: '9', label: 'Asked', ask: 'did it hit?', target: ['roll:attack'] },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 2, 'a manual rider is the panel\u2019s to add, never the roller\u2019s')
  // Still true once the player has answered it: the roll already happened, and
  // the panel adds it on top. Both sides adding it is the bug this pins.
  const answered = { ...r, riders: r.riders.map(x => (x.when === 'manual' ? { ...x, on: true, rolled: true } : x)) }
  assert.equal(total(answered).flat, 2)
})

test('an armed modifier is in total() exactly once', () => {
  const c = armedChar([{ id: 'a1', source: 'feature:F', label: 'Boost', kind: 'attack', op: 'add', value: '4', at: 1 }])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(total(r).flat, 4)
  assert.equal(r.riders.length, 1)
})

test('rollResolution keeps each contribution\u2019s faces ON that contribution', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Flat', target: ['roll:attack'] },
    { id: 'e2', op: 'add', value: '1d6', label: 'Dice', target: ['roll:attack'] },
    { id: 'e3', op: 'add', value: '1d6', label: 'Asked', ask: 'did it hit?', target: ['roll:attack'] },
  ])])
  const rolled = rollResolution(resolve(buildContext(c), ATTACK))

  const dice = rolled.riders.find(r => r.label === 'Dice')!
  assert.equal(dice.rolledDice?.length, 1)
  assert.equal(dice.rolledDice![0].sides, 6)
  // The sum it reports IS the sum of what it attributed — the property that
  // makes the panel's row checkable against the line.
  assert.equal(rolled.flat, 2 + dice.rolledDice![0].v)

  // A manual rider is NOT rolled here. §7: a value shown before the player
  // decides puts a thumb on the decision.
  assert.equal(rolled.riders.find(r => r.label === 'Asked')!.rolledDice, undefined)
})

test('rollResolution doubles dice for a crit, and never the flats', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Flat', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '2d6', label: 'Dice', target: ['roll:damage'] },
  ])])
  const res = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(rollResolution(res, false).riders.find(r => r.label === 'Dice')!.rolledDice!.length, 2)
  assert.equal(rollResolution(res, true).riders.find(r => r.label === 'Dice')!.rolledDice!.length, 4)
  // The flat rider is untouched by doubling — a crit doubles dice, not modifiers.
  assert.equal(rollResolution(res, true).riders.find(r => r.label === 'Flat')!.rolledDice, undefined)
})

test('a negative contribution still subtracts once rolled', () => {
  const c = withFeatures([gfeat('Bane', [
    { id: 'e1', op: 'add', value: '-1d4', label: 'Bane', target: ['roll:attack'] },
  ])])
  const rolled = rollResolution(resolve(buildContext(c), ATTACK))
  assert.ok(rolled.flat <= -1 && rolled.flat >= -4, `expected a penalty, got ${rolled.flat}`)
  assert.equal(rolled.riders[0].rolledDice!.every(d => d.v < 0), true)
})

// --- §6a: the read path reaches spells, items and shard nodes ---------------

/** A character with one shard slotted and one node attuned. */
const withShard = (nodes: object[], attuned: string[], shardId = 'sh1') => ({
  character: character({
    sheet: SHEET,
    shards: { slot1: { shardId, attuned } },
  }),
  trees: { [shardId]: { id: shardId, name: 'Test Shard', nodes } } as never,
})

test('an attuned shard node\u2019s graph reaches the roll — it was dropped entirely', () => {
  // sourceGid() returned null for shardnode, and buildContext skips a source
  // with no gid. So the node's contributions were indexed nowhere: authored,
  // stored, and doing nothing, exactly like `once` before 5c.
  const { character: c, trees } = withShard(
    [{ id: 'core', name: 'Core', graph: [{ id: 'e1', op: 'add', value: '3', label: 'Shard Might', target: ['roll:attack'] }] }],
    ['core'],
  )
  assert.equal(total(resolve(buildContext(c, trees), ATTACK)).flat, 3)
})

test('an UNattuned node contributes nothing', () => {
  const { character: c, trees } = withShard(
    [{ id: 'core', name: 'Core', graph: [{ id: 'e1', op: 'add', value: '3', label: 'Shard Might', target: ['roll:attack'] }] }],
    [],
  )
  assert.equal(total(resolve(buildContext(c, trees), ATTACK)).flat, 0)
})

test('a shardnode: selector names one node, and two shards\u2019 cores do not collide', () => {
  // Every shard is seeded with a node called `core`, so the gid has to be
  // qualified by the tree — an unqualified id would make one shard's Core
  // targetable through another's.
  const c = character({
    sheet: SHEET,
    shards: { slot1: { shardId: 'sh1', attuned: ['core'] }, slot2: { shardId: 'sh2', attuned: ['core'] } },
  })
  const trees = {
    sh1: { id: 'sh1', name: 'A', nodes: [{ id: 'core', name: 'Core',
      graph: [{ id: 'e1', op: 'add', value: '2', label: 'A', target: ['roll:attack'] }] }] },
    sh2: { id: 'sh2', name: 'B', nodes: [{ id: 'core', name: 'Core',
      graph: [{ id: 'e2', op: 'add', value: '5', label: 'B', target: ['shardnode:sh1.core'] }] }] },
  } as never
  const r = resolve(buildContext(c, trees), ATTACK)
  // A contributes 2 to the attack; B boosts A's contribution by 5 rather than
  // applying to the roll itself — which only works if the two cores are distinct.
  assert.equal(total(r).flat, 7)
  assert.equal(nodeGid('sh1', 'core'), 'shardnode:sh1.core')
  assert.notEqual(nodeGid('sh1', 'core'), nodeGid('sh2', 'core'))
})

test('a spell\u2019s own graph applies to its roll, keyed by the CATALOG id', () => {
  const c = character({
    sheet: SHEET,
    spellbook: { spells: [{
      id: 'inst-1', spell_id: 'cat-flame', name: 'Sacred Flame', level: 0, tags: ['fire'],
      graph: [{ id: 'e1', op: 'add', value: '2', label: 'Searing', target: ['roll:damage'] }],
    }] },
  })
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'damage', subject: 'spell:cat-flame' })).flat, 2)
  // …and a feature can target that spell by the same gid.
  const c2 = character({
    sheet: { ...SHEET, features: [gfeat('Empower', [
      { id: 'e1', op: 'add', value: '4', label: 'Empowered', target: ['spell:cat-flame'] },
    ])] },
    spellbook: c.spellbook,
  })
  assert.equal(total(resolve(buildContext(c2), { kind: 'damage', subject: 'spell:cat-flame' })).flat, 6)
})

test('a tag on a spell matches the same matcher a weapon\u2019s tags do', () => {
  const c = character({
    sheet: { ...SHEET, features: [gfeat('Pyromancer', [
      { id: 'e1', op: 'add', value: '3', label: 'Fire Affinity', target: ['tag:fire'] },
    ])] },
    spellbook: { spells: [{ id: 'inst-1', spell_id: 'cat-flame', name: 'Flame', level: 0, tags: ['Fire'] }] },
  })
  assert.equal(total(resolve(buildContext(c), { kind: 'damage', subject: 'spell:cat-flame', tags: ['Fire'] })).flat, 3)
})

test('an equipped item\u2019s graph applies, and a contribution can target the item', () => {
  const item = {
    id: 'i1', item_id: 'cat-ring', name: 'Ring of Flame', slot: 'ring1',
    graph: [{ id: 'e1', op: 'add', value: '1', label: 'Ring', target: ['roll:damage'] }],
  }
  const c = character({
    sheet: { ...SHEET, features: [gfeat('Attuned', [
      { id: 'e1', op: 'add', value: '2', label: 'Attunement', target: ['item:cat-ring'] },
    ])] },
    equipped: { ring1: item },
  })
  const r = resolve(buildContext(c), { kind: 'damage', subject: 'item:cat-ring' })
  assert.equal(total(r).flat, 3)   // the ring's own 1, boosted by 2
})

test('an effect targeting a node counts ONCE when that node is the roll\u2019s subject', () => {
  // "+4 to Sacred Flame" is one statement. It matched the roll directly (the
  // subject IS the spell) AND boosted the spell's own contribution, so the same
  // +4 landed twice. Only reachable once a subject can carry its own graph,
  // which is what slice 6a wired — the third double-count of this family.
  const c = character({
    sheet: { ...SHEET, features: [gfeat('Empower', [
      { id: 'e1', op: 'add', value: '4', label: 'Empowered', target: ['spell:cat-flame'] },
    ])] },
    spellbook: { spells: [{
      id: 'inst-1', spell_id: 'cat-flame', name: 'Sacred Flame', level: 0,
      graph: [{ id: 'e2', op: 'add', value: '2', label: 'Base', target: ['roll:damage'] }],
    }] },
  })
  assert.equal(total(resolve(buildContext(c), { kind: 'damage', subject: 'spell:cat-flame' })).flat, 6)
})

test('…and chaining still works when the roll did NOT name the node', () => {
  // §4's two-level chain: B boosts A, A contributes to a roll whose subject is
  // something else entirely. B never matched the roll, so it must still boost.
  const c = withFeatures([
    gfeat('A', [{ id: 'a1', op: 'add', value: '2', label: 'A', target: ['roll:attack'] }]),
    gfeat('B', [{ id: 'b1', op: 'add', value: '3', label: 'B', target: ['feature:A'] }]),
  ])
  assert.equal(total(resolve(buildContext(c), { kind: 'attack', subject: 'weapon:sword' })).flat, 5)
})

test('roll:damage.melee narrows to weapons; roll:damage still catches everything', () => {
  // "damage dealt by a weapon, not a spell" is two selectors, because the target
  // list is an OR and there is no "weapon" roll kind to name. The sub NARROWS:
  // an unsubbed roll:damage keeps matching all three.
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '1', label: 'Any damage', target: ['roll:damage'] },
    { id: 'e2', op: 'add', value: '2', label: 'Weapon only', target: ['roll:damage.melee', 'roll:damage.ranged'] },
    { id: 'e3', op: 'add', value: '4', label: 'Melee only', target: ['roll:damage.melee'] },
    { id: 'e4', op: 'add', value: '8', label: 'Spell only', target: ['roll:damage.spell'] },
  ])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'melee' })).flat, 1 + 2 + 4)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'ranged' })).flat, 1 + 2)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'spell' })).flat, 1 + 8)
  // A damage roll carrying no sub matches only the unnarrowed one.
  assert.equal(total(resolve(ctx, { kind: 'damage' })).flat, 1)
  // And narrowing damage must not leak into the attack roll.
  assert.equal(total(resolve(ctx, { kind: 'attack', sub: 'melee' })).flat, 0)
})

test('attack and damage narrow independently — one weapon, two statements', () => {
  const c = withFeatures([gfeat('Duelist', [
    { id: 'e1', op: 'adv', label: 'Melee finesse', target: ['roll:attack.melee'] },
    { id: 'e2', op: 'add', value: '2', label: 'Melee bite', target: ['roll:damage.melee'] },
  ])])
  const ctx = buildContext(c)
  // The melee weapon's attack gets advantage and nothing else; its damage gets
  // the +2 and no advantage flag of its own.
  assert.equal(resolve(ctx, { kind: 'attack', sub: 'melee' }).adv, true)
  assert.equal(total(resolve(ctx, { kind: 'attack', sub: 'melee' })).flat, 0)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'melee' })).flat, 2)
  // A bow gets neither.
  assert.equal(resolve(ctx, { kind: 'attack', sub: 'ranged' }).adv, false)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'ranged' })).flat, 0)
})

test('every roll selector the editor offers is one a roll surface can pass', () => {
  // The guard for the class of bug this slice kept finding: an option in the
  // authoring UI that nothing downstream ever matches. `attack.spell` is the
  // known exception — nothing in this app rolls a spell attack — and naming it
  // here is the point, so it cannot be forgotten a second time.
  const PASSED_BY_A_SURFACE = new Set([
    'attack', 'attack.melee', 'attack.ranged',           // Equipment.attack()
    'damage', 'damage.melee', 'damage.ranged',           // Equipment.attack()
    'damage.spell',                                      // Spellbook.castSpell()
    'feature',                                           // ActivationSheet, consume
    'save', 'check',                                     // Character.pushCheck()
    ...['str', 'dex', 'con', 'int', 'wis', 'cha'].map(a => `save.${a}`),
    ...['athletics', 'stealth', 'perception'].map(s => `check.${s}`),
  ])
  const KNOWN_DEAD = new Set(['attack.spell'])
  const stray = ROLL_SELECTORS.filter(r => !PASSED_BY_A_SURFACE.has(r) && !KNOWN_DEAD.has(r))
  assert.deepEqual(stray, [], `selector(s) no roll surface passes: ${stray.join(', ')}`)
})

// --- §6b: the audit is kind-agnostic ----------------------------------------

test('auditNode reads a spell-shaped node exactly as it reads a feature', () => {
  // The extraction assumes this: the same block authors a spell, an item and a
  // shard node, so the audit cannot be feature-shaped. Its signature is already
  // `{ graph?, vars? }` — this pins that it stays that way.
  const node = {
    vars: [{ name: 'shardsHeld', kind: 'stored', type: 'num' }] as VarDef[],
    graph: [
      { id: 'e1', op: 'add', value: 'shardsHeld * 2', label: 'Zealot', target: ['roll:damage'] },
    ] as GraphEffect[],
  }
  assert.deepEqual(auditNode(node), [])
  // …and the same node with a typo reports against the same vocabulary.
  assert.ok(auditNode({ ...node, graph: [{ ...node.graph[0], value: 'shardsHelt * 2' }] })
    .some(a => a.sev === 'err' && a.t === 'Unknown identifier'))
})

test('a dangling target is reported only when there IS a catalog to check', () => {
  // auditNode skips dangling detection on an empty node list, which is why every
  // host must gate its audit on the libraries having loaded. A clean report from
  // an unloaded catalog is a lie, and the spell form gates on `ready` for this.
  const node = { graph: [{ id: 'e1', op: 'add', value: '2', label: 'X', target: ['spell:nope'] }] as GraphEffect[] }
  assert.equal(auditNode(node).filter(a => a.t === 'Dangling target').length, 0)
  assert.equal(auditNode(node, [{ gid: 'spell:real' }]).filter(a => a.t === 'Dangling target').length, 1)
  assert.equal(auditNode(node, [{ gid: 'spell:nope' }]).filter(a => a.t === 'Dangling target').length, 0)
})

test('an armed rider shows a name in the source column, falling back to the gid', () => {
  const named = armedChar([{ id: 'a1', source: 'spell:cat-flame', sourceName: 'Sacred Flame',
    label: 'Sanctified', kind: 'attack', op: 'add', value: '4', at: 1 }])
  assert.equal(resolve(buildContext(named), ATTACK).riders[0].source, 'Sacred Flame')

  // An entry armed before the name was captured still reads — badly, but the
  // queue is cleared by any rest, so those age out within a session.
  const bare = armedChar([{ id: 'a1', source: 'spell:cat-flame',
    label: 'Sanctified', kind: 'attack', op: 'add', value: '4', at: 1 }])
  assert.equal(resolve(buildContext(bare), ATTACK).riders[0].source, 'spell:cat-flame')
})

test('a tag matches whatever carries it — feature, spell, item, shard node', () => {
  // A tag's whole purpose is to reach across catalogs. Until 6c only features
  // could carry one, so `tag:fire` matched a feature and nothing else while
  // Equipment and Spellbook were both passing tags into every resolve.
  const c = withFeatures([gfeat('Pyromancer', [
    { id: 'e1', op: 'add', value: '3', label: 'Fire Affinity', target: ['tag:fire'] },
  ])])
  const ctx = buildContext(c)
  // Normalised on save, so the casing the roll passes cannot matter.
  for (const tag of ['fire', 'Fire', 'FIRE']) {
    assert.equal(total(resolve(ctx, { kind: 'damage', tags: [tag] })).flat, 3, tag)
  }
  assert.equal(total(resolve(ctx, { kind: 'damage', tags: ['cold'] })).flat, 0)
})

// --- the AND target list ----------------------------------------------------

test('`and` is what says "a fire weapon, on its DAMAGE roll"', () => {
  // The bug: a weapon carries its tags into BOTH resolves, so `tag:fire` alone
  // applies to the attack roll and the damage roll — +1 twice for one swing.
  const or = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '1', dmgType: 'fire', label: 'Ember', target: ['tag:fire'] },
  ])])
  const req = { subject: 'weapon:w', tags: ['fire'] }
  assert.equal(total(resolve(buildContext(or), { kind: 'attack', ...req })).flat, 1)
  assert.equal(total(resolve(buildContext(or), { kind: 'damage', ...req })).flat, 1)

  const and = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '1', dmgType: 'fire', label: 'Ember',
      match: 'and', target: ['tag:fire', 'roll:damage'] },
  ])])
  const ctx = buildContext(and)
  assert.equal(total(resolve(ctx, { kind: 'attack', ...req })).flat, 0, 'not the attack roll')
  assert.equal(total(resolve(ctx, { kind: 'damage', ...req })).flat, 1, 'only the damage roll')
  // …and not a different weapon's damage.
  assert.equal(total(resolve(ctx, { kind: 'damage', subject: 'weapon:x', tags: ['cold'] })).flat, 0)
})

test('`and` normalises tags the same way the index does', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Ember', match: 'and', target: ['tag:Fire Damage', 'roll:damage'] },
  ])])
  assert.equal(total(resolve(buildContext(c), { kind: 'damage', tags: ['fire_damage'] })).flat, 2)
})

test('a sub-kind satisfies its parent inside an `and`', () => {
  // A melee damage roll carries both `roll:damage` and `roll:damage.melee`, so
  // an AND naming the broader one still holds.
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'X', match: 'and', target: ['tag:fire', 'roll:damage'] },
  ])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'damage', sub: 'melee', tags: ['fire'] })).flat, 2)
})

test('an `or` list is unchanged — it is still the default and still the common case', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '3', label: 'Either', target: ['weapon:sword', 'weapon:axe'] },
  ])])
  const ctx = buildContext(c)
  assert.equal(total(resolve(ctx, { kind: 'attack', subject: 'weapon:sword' })).flat, 3)
  assert.equal(total(resolve(ctx, { kind: 'attack', subject: 'weapon:axe' })).flat, 3)
  assert.equal(total(resolve(ctx, { kind: 'attack', subject: 'weapon:bow' })).flat, 0)
})

test('an AND that can never match is an error, not a silent no-op', () => {
  const bad = (target: string[]) => auditNode({ graph: [
    { id: 'e1', op: 'add', value: '1', label: 'X', match: 'and', target },
  ] }).filter(a => a.t === 'This AND can never match')

  assert.equal(bad(['roll:attack', 'roll:damage']).length, 1)      // one kind per roll
  assert.equal(bad(['weapon:sword', 'weapon:axe']).length, 1)      // one subject per roll
  assert.equal(bad(['roll:save.dex', 'roll:save.wis']).length, 1)  // one sub per roll
  // Legitimate ANDs pass.
  assert.equal(bad(['tag:fire', 'roll:damage']).length, 0)
  assert.equal(bad(['tag:fire', 'tag:magic', 'roll:damage']).length, 0)
  assert.equal(bad(['weapon:sword', 'roll:damage']).length, 0)
  // Broad + narrow of the SAME kind is satisfiable — a melee damage roll is both.
  assert.equal(bad(['roll:damage', 'roll:damage.melee']).length, 0)

  // And an AND with nothing to combine says so.
  assert.ok(auditNode({ graph: [{ id: 'e1', op: 'add', value: '1', label: 'X', match: 'and', target: ['tag:fire'] }] })
    .some(a => a.t === 'AND with one target'))
})

/* ---------- what the panel needs to EXPLAIN a contribution (§55) ---------- */

test('a rider carries its source’s card text, so the panel can show why it applied', () => {
  // `source` is a bare display NAME, and a roll entry is not a catalog row — the
  // prose lives on a DM-only table the player never reads. Without this the
  // panel cannot answer "should this have applied?" at all.
  const c = withFeatures([gfeat('Zealot', [{ id: 'e1', op: 'add', value: '2', label: 'Ember', target: ['roll:attack'] }],
    { light_description: 'While attuned, your strikes carry the ember.' })])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders[0].sourceText, 'While attuned, your strikes carry the ember.')
})

test('card text falls back through the four names a node can keep prose under', () => {
  // A feature, an item, a spell and a shard node each call it something else.
  // One lookup, so the panel never has to know which kind it is holding.
  for (const [field, text] of [['light_description', 'a'], ['summary', 'b'], ['description', 'c'], ['effect', 'd']]) {
    const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '1', label: 'L', target: ['roll:attack'] }],
      { [field]: text } as Partial<Feature>)])
    assert.equal(resolve(buildContext(c), ATTACK).riders[0].sourceText, text, `${field} should be found`)
  }
})

test('a formula rider carries its operands at the values the roll used', () => {
  // Captured at resolve time because it cannot be recovered later: the scope is
  // a snapshot mid-roll, and by the time anything renders the log it has moved.
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: 'level + prof', label: 'L', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.deepEqual(r.riders[0].parts, [{ name: 'level', value: 7 }, { name: 'prof', value: 3 }])
  assert.equal(r.riders[0].flat, 10)
})

test('a flat number and a bare die carry no derivation', () => {
  // A chevron that opens onto nothing is worse than no chevron, so "there is
  // nothing to show" has to be expressible.
  for (const value of ['2', '2d6']) {
    const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value, label: 'L', target: ['roll:attack'] }])])
    assert.equal(resolve(buildContext(c), ATTACK).riders[0].parts, undefined, `${value} derives from nothing`)
  }
})

test('an ask-gated flag is an authoring error — it can never take effect', () => {
  // The trap: `ask` is answered in the roll panel, AFTER the d20 exists. A number
  // can still be added there; advantage changes how the die is rolled, and §8 #2
  // forbids re-rolling. So the toggle appears, the player says yes, and the roll
  // it was meant to change is already spent.
  const bad = auditNode({ graph: [{ id: 'e1', op: 'adv', label: 'Hood', ask: 'While hood is up', target: ['roll:check.stealth'] }] }, [])
  const hit = bad.find(a => a.t === 'Adv cannot be asked')
  assert.ok(hit, 'an ask on adv must be reported')
  assert.equal(hit?.sev, 'err')
  assert.match(hit!.s, /player toggle/, 'and must name the fix')

  // The same flag gated by `when` is exactly right — the engine knows in time.
  const good = auditNode({
    graph: [{ id: 'e1', op: 'adv', label: 'Hood', when: 'hoodUp', target: ['roll:check.stealth'] }],
    vars: [{ name: 'hoodUp', kind: 'stored', type: 'bool', scope: 'player' }],
  }, [])
  assert.equal(good.filter(a => a.sev === 'err').length, 0)

  // And an ask on a NUMBER stays legal — that is the whole point of the panel.
  const num = auditNode({ graph: [{ id: 'e1', op: 'add', value: '1d6', label: 'Smite', ask: 'Did it hit?', target: ['roll:damage'] }] }, [])
  assert.equal(num.filter(a => a.sev === 'err').length, 0)
})

// --- a rider knows WHERE it came from, not just what it is called ------------

test('A RIDER CARRIES ITS SOURCE GID, so the panel can link to it', () => {
  // `source` is a display NAME by design, which left the Roll Context Panel's
  // catalog sheet naming a contributor it could not open. The gid is the handle
  // the Features screen already resolves through its byGid map.
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders[0].source, 'F', 'still a human name')
  assert.equal(r.riders[0].sourceGid, 'feature:F', 'and now an identity beside it')
})

test('a conditional rider carries it too, not just an unconditional one', () => {
  // Two separate construction sites in resolve(); the `always` one is the easy
  // one to remember and the gated one is the easy one to forget.
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '3', label: 'Gated', target: ['roll:attack'], ask: 'did it land?' },
  ])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'manual')
  assert.equal(r.riders[0].sourceGid, 'feature:F')
})

test('an armed rider reports the gid it armed from', () => {
  // ArmedMod.source IS the gid (database.types.ts says so) and sourceName is the
  // display copy — so this one is already in hand and only had to be passed on.
  const c = armedChar([{ id: 'a1', source: 'spell:cat-flame', sourceName: 'Sacred Flame',
    label: 'Sanctified', kind: 'attack', op: 'add', value: '4', at: 1 }])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.riders[0].source, 'Sacred Flame')
  assert.equal(r.riders[0].sourceGid, 'spell:cat-flame')
})

test('a NON-feature source is still reported — the panel decides what is linkable', () => {
  // The engine must not pre-filter to `feature:`: an item rider is a real fact
  // about the roll, and hiding its identity here would make the panel guess.
  const c = armedChar([{ id: 'a1', source: 'item:cat-blade', sourceName: 'Blade',
    label: 'Etched', kind: 'attack', op: 'add', value: '1', at: 1 }])
  const gid = resolve(buildContext(c), ATTACK).riders[0].sourceGid
  assert.equal(gid, 'item:cat-blade')
  assert.ok(!gid?.startsWith('feature:'), 'and it is not a feature, so the panel will not link it')
})
