import test from 'node:test'
import assert from 'node:assert/strict'
import { classHas, grantLevels, previewBool, previewScope, progressionScope, progressionState, PREVIEW_LEVEL } from './previewScope.ts'
import { interpolate } from './expr.ts'
import { probeScope } from './graph.ts'

const barbarian = {
  features: [{ feature_id: 'weapon-mastery' }],
  vars: [{ name: 'weaponMastery', kind: 'derived' as const,
    formula: '[0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4][level]' }],
}
const bard = {
  features: [{ feature_id: 'bardic-inspiration' }],
  vars: [{ name: 'cantrips', kind: 'derived' as const,
    formula: '[0,2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4][level]' }],
}

test('a class variable resolves in its own feature prose', () => {
  const s = previewScope({ featureId: 'weapon-mastery', owners: [barbarian] })
  assert.equal(s.level, PREVIEW_LEVEL)
  assert.equal(s.weaponMastery, 3, 'level 7 Barbarian has three weapon masteries')
  const { text, bad } = interpolate('mastery of {weaponMastery} kinds', s)
  assert.equal(text, 'mastery of 3 kinds')
  assert.deepEqual(bad, [])
})

test("ANOTHER CLASS'S VARIABLES ARE NOT IN SCOPE", () => {
  // Six classes declare `cantrips` with different progressions. Pulling in
  // every owner would quietly show a Bard's number inside a Wizard's prose —
  // a wrong answer that looks exactly like a right one.
  const s = previewScope({ featureId: 'weapon-mastery', owners: [barbarian, bard] })
  assert.equal(s.weaponMastery, 3)
  assert.equal(s.cantrips, undefined)
  assert.deepEqual(interpolate('{cantrips}', s).bad, ['cantrips'])
})

test('WHAT CANNOT BE KNOWN STAYS LITERAL AND IS NAMED', () => {
  // prof is authored on the sheet, not derived from level, so a preview that
  // printed a number here would be inventing one the DM is allowed to set.
  const s = previewScope({})
  const { text, bad } = interpolate('{prof} and {str} at level {level}', s)
  assert.equal(text, '{prof} and {str} at level 7')
  assert.deepEqual(bad.sort(), ['prof', 'str'])
})

test('a stored variable previews at its declared initial', () => {
  const s = previewScope({ vars: [
    { name: 'mercy', kind: 'stored', type: 'num', initial: 4 },
    { name: 'sworn', kind: 'stored', type: 'bool' },
    { name: 'empty', kind: 'stored', type: 'num' },
  ] })
  assert.equal(s.mercy, 4)
  assert.equal(s.sworn, false)
  assert.equal(s.empty, 0)
})

test('a derived variable reading another settles whatever the order', () => {
  const s = previewScope({ vars: [
    { name: 'doubled', kind: 'derived', formula: 'base * 2' },
    { name: 'base', kind: 'derived', formula: 'level + 1' },
  ] })
  assert.equal(s.base, 8)
  assert.equal(s.doubled, 16, 'declared before what it reads, and still resolves')
})

test('the level is settable, and the tables track it', () => {
  const at = (level: number) =>
    previewScope({ level, featureId: 'weapon-mastery', owners: [barbarian] }).weaponMastery
  assert.deepEqual([1, 4, 10, 20].map(at), [2, 3, 4, 4])
})

/* ---------- class progression (the Graph view's preview lens) ---------- */

const NAMES = new Map([['bs', 'Brutal Strike'], ['ibs', 'Improved Brutal Strike'], ['ibse', 'Improved Brutal Strike (Enhanced)']])
const BARB = [
  { feature_id: 'bs', when: 'level >= 9' }, { feature_id: 'ibs', when: 'level >= 13' },
  { feature_id: 'ibse', when: 'level >= 17' }, { feature_id: 'gone', when: 'level >= 2' },
]
const at = (lv: number) => progressionScope(lv, classHas(BARB, NAMES, lv))
const isBool = previewBool(probeScope([], undefined, { recklessAttack: 'bool' }))

test('owning a granted feature is a function of level', () => {
  assert.deepEqual(classHas(BARB, NAMES, 13), {
    has_brutal_strike: true, has_improved_brutal_strike: true, has_improved_brutal_strike_enhanced: false,
  })
  // A grant whose feature is not loaded is skipped, not reported as unowned.
  assert.equal('has_gone' in classHas(BARB, NAMES, 20), false)
})

test('the level chips are where the grants change', () => {
  assert.deepEqual(grantLevels(BARB, NAMES), [1, 9, 13, 17])
})

test('a gate on class grants and level is decided', () => {
  assert.equal(progressionState({ when: 'has_improved_brutal_strike' }, at(9), isBool), 'off')
  assert.equal(progressionState({ when: 'has_improved_brutal_strike' }, at(13), isBool), 'active')
  assert.equal(progressionState({ when: 'level >= 5' }, at(9), isBool), 'active')
  assert.equal(progressionState({}, at(9), isBool), 'active')
})

test('unknown booleans are enumerated: decided only if every combination agrees', () => {
  // false regardless of recklessAttack → off
  assert.equal(progressionState({ when: 'recklessAttack && has_improved_brutal_strike' }, at(9), isBool), 'off')
  // depends on recklessAttack → undetermined
  assert.equal(progressionState({ when: 'recklessAttack && has_brutal_strike' }, at(9), isBool), 'undetermined')
  // true regardless → active
  assert.equal(progressionState({ when: 'recklessAttack || has_brutal_strike' }, at(9), isBool), 'active')
})

test('an unknown NUMBER is never guessed — and a stored variable is not its initial', () => {
  assert.equal(progressionState({ when: 'attacksThisTurn == 0 && has_brutal_strike' }, at(9), isBool), 'undetermined')
  // mercy starts at 0 but moves in play: a preview must not call this off.
  const s = progressionScope(9, {}, [{ name: 'mercy', kind: 'stored', type: 'num', initial: 0 }])
  assert.equal(progressionState({ when: 'mercy >= 2' }, s, isBool), 'undetermined')
})

test('a derived variable over level is decided; one over play state is not', () => {
  const defs = [
    { name: 'tier', kind: 'derived' as const, formula: 'level >= 11' },
    { name: 'ready', kind: 'derived' as const, formula: 'recklessAttack && attacksThisTurn == 0' },
  ]
  const s = progressionScope(13, {}, defs)
  assert.equal(s.tier, true)
  assert.equal('ready' in s, false)
})

test('an ask is never decided by a preview — only a false when turns it off', () => {
  assert.equal(progressionState({ ask: 'Did it?' }, at(9), isBool), 'undetermined')
  assert.equal(progressionState({ ask: 'Did it?', when: 'has_improved_brutal_strike' }, at(9), isBool), 'off')
  assert.equal(progressionState({ ask: 'Did it?', when: 'has_improved_brutal_strike' }, at(13), isBool), 'undetermined')
})

test('an untyped derived boolean is enumerated, so a false conjunct beside it decides', () => {
  // recklessAttackReady is declared without a type; the audit's probe infers boolean.
  const vars = [{ name: 'ready', kind: 'derived' as const, formula: 'recklessAttack && attacksThisTurn == 0' }]
  const isB = previewBool(probeScope(vars, undefined, { recklessAttack: 'bool' }))
  assert.equal(progressionState({ when: 'ready && has_improved_brutal_strike' }, at(9), isB), 'off')
  assert.equal(progressionState({ when: 'ready && has_improved_brutal_strike' }, at(13), isB), 'undetermined')
})
