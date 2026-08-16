// Run: node --test src/lib/graph.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, VarDef } from './database.types.ts'
import { VAR_IDENTS, evalExpr } from './expr.ts'
import { parseDice, rollDice } from './dice.ts'
import {
  auditNode, auditVars, baseScope, buildContext, characterVars, collectVars, gid,
  damageFlags, matchCount, nodeGid, normalizeTag, resolve, total, varCollisions, type ResolveReq,
} from './graph.ts'
import { activeSources } from './effects.ts'
import { OPS, OP_ORDER, OP_TITLE } from './opSchema.ts'
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

// --- target matching, all three namespaces (§11) ----------------------------

test('roll: selectors match by kind and by sub-kind', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'All saves', target: ['roll:save'] },
    { id: 'e2', op: 'add', value: '3', label: 'Dex saves', target: ['roll:save.dex'] },
  ])])
  const ctx = buildContext(c)
  assert.equal(resolve(ctx, { kind: 'save' }).flat, 2)
  assert.equal(resolve(ctx, { kind: 'save', sub: 'dex' }).flat, 5) // both match
  assert.equal(resolve(ctx, { kind: 'save', sub: 'con' }).flat, 2)
  assert.equal(resolve(ctx, ATTACK).flat, 0)
})

test('tag: selectors match the subject\'s tags, through one normalisation', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '4', label: 'Radiant', target: ['tag:Fire Damage'] }])])
  const ctx = buildContext(c)
  // Authored "Fire Damage", requested "fire_damage" — same tag or targeting is
  // silently broken, which is the whole reason normalizeTag is shared.
  assert.equal(resolve(ctx, { kind: 'damage', tags: ['fire_damage'] }).flat, 4)
  assert.equal(resolve(ctx, { kind: 'damage', tags: ['FIRE DAMAGE'] }).flat, 4)
  assert.equal(resolve(ctx, { kind: 'damage', tags: ['cold'] }).flat, 0)
})

test('an id selector matches exactly one thing', () => {
  const c = withFeatures([gfeat('Buff', [{ id: 'e1', op: 'add', value: '5', label: 'Blessed blade', target: ['weapon:sword'] }])])
  const ctx = buildContext(c)
  assert.equal(resolve(ctx, { kind: 'attack', subject: 'weapon:sword' }).flat, 5)
  assert.equal(resolve(ctx, { kind: 'attack', subject: 'weapon:axe' }).flat, 0)
})

test('a target array is an OR, and a doubly-matching effect applies once', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Either', target: ['roll:attack', 'tag:fire'] },
  ])])
  assert.equal(resolve(buildContext(c), { kind: 'attack', tags: ['fire'] }).flat, 2)
})

test('an effect with no target applies to its own node\'s roll', () => {
  const c = withFeatures([gfeat('SelfBuff', [{ id: 'e1', op: 'add', value: '3', label: 'Self' }])])
  const ctx = buildContext(c)
  assert.equal(resolve(ctx, { kind: 'feature', subject: 'feature:SelfBuff' }).flat, 3)
  assert.equal(resolve(ctx, { kind: 'feature', subject: 'feature:Other' }).flat, 0)
})

// --- chaining (§13 step 3) --------------------------------------------------

test('a two-level chain: B boosts A\'s contribution, A contributes to the roll', () => {
  const c = withFeatures([
    gfeat('A', [{ id: 'a1', op: 'add', value: '1d6', label: 'Judgment', target: ['roll:damage'] }]),
    gfeat('B', [{ id: 'b1', op: 'add', value: '2', label: 'Empower', target: ['feature:A'] }]),
  ])
  const r = resolve(buildContext(c), { kind: 'damage' })
  assert.equal(r.flat, 2)
  assert.deepEqual(r.dice, ['1d6'])
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
  assert.ok(Number.isFinite(r.flat))
})

// --- §32's when/ask table, all six rows -------------------------------------

test('§32 row 1 — no when, no ask: folds into flat, no rider', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '2', label: 'Always', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.flat, 2)
  assert.equal(r.riders.length, 0)
})

test('§32 row 2 — when true, no ask: a resolved rider, not folded', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Raging', when: 'isRaging', target: ['roll:attack'] },
  ], { vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }] })], { vars: { isRaging: true } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.flat, 0) // resolved riders are NOT in flat
  assert.equal(r.riders.length, 1)
  assert.equal(r.riders[0].when, 'active')
  assert.equal(r.riders[0].on, true)
  assert.equal(total(r).flat, 2) // ...but total() composes them
})

test('§32 row 3 — when false, no ask: does not surface at all', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Raging', when: 'isRaging', target: ['roll:attack'] },
  ], { vars: [{ name: 'isRaging', kind: 'stored', type: 'bool' }] })], { vars: { isRaging: false } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.flat, 0)
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
  assert.equal(r.riders[0].label, 'at least one failed the save')
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
  assert.equal(r.riders[0].op, 'crit') // the panel is told WHAT the toggle grants
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
  assert.deepEqual(r.dice, ['-1d4'])

  // The path that used to break: parseDice rejected the sign, so the rider
  // silently vanished at the roller instead of erroring at the audit.
  const parsed = parseDice(r.dice[0])!
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

// --- §39 obligation 2: the null contribution --------------------------------

test('a contribution failing at these values is reported, and the roll still resolves', () => {
  const c = withFeatures([gfeat('F', [
    { id: 'e1', op: 'add', value: '2', label: 'Good', target: ['roll:attack'] },
    { id: 'e2', op: 'add', value: 'level / denom', label: 'Broken', target: ['roll:attack'] },
  ], { vars: [{ name: 'denom', kind: 'stored', type: 'num' }] })], { vars: { denom: 0 } })
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.flat, 2) // the rest of the roll is unaffected
  assert.equal(r.notes.length, 0) // NOT prose — the player must not read it as rule text
  assert.ok(r.problems.some(p => p.sev === 'err' && p.t === 'Contribution did not resolve'))
})

test('a condition that is not a yes/no answer is reported, not guessed', () => {
  const c = withFeatures([gfeat('F', [{ id: 'e1', op: 'add', value: '2', label: 'X', when: 'level', target: ['roll:attack'] }])])
  const r = resolve(buildContext(c), ATTACK)
  assert.equal(r.flat, 0)
  assert.ok(r.problems.some(p => p.t === 'Condition did not resolve'))
})

// --- scoping ----------------------------------------------------------------

test('an unequipped item\'s contributions do not exist', () => {
  const item = { id: 'i1', item_id: 'i1', name: 'Wand', slot: 'cloak', graph: [{ id: 'e1', op: 'add' as const, value: '3', label: 'Wand', target: ['roll:attack'] }] }
  assert.equal(resolve(buildContext(character({ sheet: SHEET, inventory: [item] })), ATTACK).flat, 0)
  assert.equal(resolve(buildContext(character({ sheet: SHEET, equipped: { cloak: item } })), ATTACK).flat, 3)
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
  assert.equal(r.flat, 0)
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
    return resolve(buildContext(c), { kind: 'damage' }).flat
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
  assert.equal(resolve(buildContext(c), { kind: 'damage' }).flat, 4)
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
  assert.equal(r.flat, 0)
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

  // ask + when TRUE — a toggle, not a bonus. `flat` stays 0: the +2 is NOT in
  // the number, and total() excludes it too because `on` is false.
  const on = roll(rage('isRaging'), true)
  assert.equal(on.riders.length, 1)
  assert.equal(on.riders[0].when, 'manual')
  assert.equal(on.riders[0].on, false)
  assert.equal(on.flat, 0)
  assert.equal(total(on).flat, 0)

  // ask + when FALSE — §32 row 6, gone entirely.
  assert.equal(roll(rage('isRaging'), false).riders.length, 0)

  // ask alone — identical to the when-true case, which is the point: `when`
  // decides whether the toggle EXISTS, never whether it is already answered.
  const askOnly = roll(rage(), false)
  assert.equal(askOnly.riders.length, 1)
  assert.equal(askOnly.riders[0].when, 'manual')
  assert.equal(askOnly.flat, 0)

  // An empty-string ask is NOT a toggle — it is no ask at all, and the +2
  // applies. This is the one way the two cases could diverge in stored data.
  const blank = roll({ ...rage(), graph: [{ id: 'e', op: 'add', value: '2', label: 'Rage', ask: '', target: ['roll:damage'] }] }, false)
  assert.equal(blank.flat, 2)
  assert.equal(blank.riders.length, 0)
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
