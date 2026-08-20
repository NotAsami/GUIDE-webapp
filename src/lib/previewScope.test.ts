import test from 'node:test'
import assert from 'node:assert/strict'
import { previewScope, PREVIEW_LEVEL } from './previewScope.ts'
import { interpolate } from './expr.ts'

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
