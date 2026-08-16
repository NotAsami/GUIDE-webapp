// Run: node --test src/lib/rollView.test.ts
//
// The panel's arithmetic, tested without a renderer. This is the layer where a
// wrong number is most dangerous: a rider counted twice, or an answered `ask`
// that never reaches the total, is a number a player trusts and shouldn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import { lineViews, resolvedOf, riderViews, rollTotals, unresolvedOf } from './rollView.ts'

const rider = (over: Partial<Rider>): Rider => ({
  label: 'R', source: 'Src', op: 'add', formula: '2', flat: 2, dice: [],
  when: 'always', on: true, ...over,
})

const entry = (over: Partial<RollEntry>): RollEntry => ({
  id: 'r1', at: 0, kind: 'weapon', title: 'Longsword', ...over,
} as RollEntry)

const ATTACK = { d20: 14, rolls: [14], mode: 'normal' as const, bonus: 6, total: 20, crit: false, fumble: false, breakdown: '' }
const DAMAGE = { diceExpr: '1d8', dice: [5], bonus: 3, total: 8, type: 'slashing', crit: false, breakdown: '' }

test('an `always` rider is named but NOT added again', () => {
  // The roller already folded it into the line's bonus. Counting it here would
  // double every unconditional contribution — the same trap total() has.
  const e = entry({
    attack: ATTACK, damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({ when: 'always', label: 'Rage', flat: 2 })] }],
  })
  const views = riderViews(e)
  assert.equal(views[0].live, true)          // it IS contributing…
  assert.equal(views[0].value, 2)            // …and says how much…
  assert.equal(rollTotals(e, views).damage, 8) // …but the total is the line's 8, not 10
})

test('resolved and unresolved split on `when`, matching the engine', () => {
  const e = entry({
    riderGroups: [{ label: 'Damage', riders: [
      rider({ when: 'always', label: 'A' }),
      rider({ when: 'active', label: 'B' }),
      rider({ when: 'manual', label: 'C', on: false }),
    ] }],
  })
  const v = riderViews(e)
  assert.deepEqual(resolvedOf(v).map(x => x.rider.label), ['A', 'B'])
  assert.deepEqual(unresolvedOf(v).map(x => x.rider.label), ['C'])
})

test('an unanswered manual rider contributes nothing and is counted as pending', () => {
  const e = entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({ when: 'manual', on: false, dice: ['1d6'], flat: 0 })] }],
  })
  const t = rollTotals(e, riderViews(e))
  assert.equal(t.damage, 8)
  assert.equal(t.pending, 1)
})

test('toggled on but UNROLLED still contributes nothing — the formula is not a value', () => {
  // §7: showing a pre-rolled number before the player decides puts a thumb on
  // the decision. Saying yes is not the same as having rolled.
  const e = entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [rider({ when: 'manual', on: true, dice: ['1d6'], flat: 0 })] }],
  })
  const t = rollTotals(e, riderViews(e))
  assert.equal(t.damage, 8)
  assert.equal(t.pending, 1)
})

test('a rolled manual rider adds its FACES, not its formula', () => {
  const e = entry({
    damage: DAMAGE,
    riderGroups: [{ label: 'Damage', riders: [
      rider({ when: 'manual', on: true, dice: ['1d6'], flat: 0, rolled: true, rolledDice: [4] }),
    ] }],
  })
  const v = riderViews(e)
  assert.equal(v[0].live, true)
  assert.equal(v[0].value, 4)
  const t = rollTotals(e, v)
  assert.equal(t.damage, 12)   // 8 + 4
  assert.equal(t.pending, 0)
})

test('an answered rider that is toggled back off stops counting but keeps its value', () => {
  // The lock: the number is settled, so toggling reuses it rather than rerolling.
  const r = rider({ when: 'manual', on: false, dice: ['1d6'], flat: 0, rolled: true, rolledDice: [4] })
  const e = entry({ damage: DAMAGE, riderGroups: [{ label: 'Damage', riders: [r] }] })
  const v = riderViews(e)
  assert.equal(v[0].live, false)
  assert.equal(rollTotals(e, v).damage, 8)
  // Toggling back on must reuse 4, never reroll.
  const back = riderViews(entry({ damage: DAMAGE, riderGroups: [{ label: 'Damage', riders: [{ ...r, on: true }] }] }))
  assert.equal(back[0].value, 4)
})

test('flag riders become granted flags, and only when live', () => {
  const e = entry({
    attack: ATTACK,
    riderGroups: [{ label: 'Attack', riders: [
      rider({ op: 'adv', when: 'always', flat: 0, label: 'Pack tactics' }),
      rider({ op: 'crit', when: 'manual', on: false, flat: 0, label: 'Sure strike' }),
    ] }],
  })
  const v = riderViews(e)
  assert.deepEqual(v.map(x => x.kind), ['flag', 'flag'])
  assert.deepEqual(rollTotals(e, v).flags, ['ADVANTAGE'])

  // A flag needs no roll — saying yes is the whole decision, so it goes live
  // the moment it is toggled on.
  const on = riderViews(entry({ ...e, riderGroups: [{ label: 'Attack', riders: [
    rider({ op: 'crit', when: 'manual', on: true, flat: 0 }),
  ] }] }))
  assert.equal(on[0].live, true)
  assert.deepEqual(rollTotals(e, on).flags, ['CRIT'])
})

test('an attack rider adds to the attack, a damage rider to the damage', () => {
  const e = entry({
    attack: ATTACK, damage: DAMAGE,
    riderGroups: [
      { label: 'Attack', riders: [rider({ when: 'manual', on: true, rolled: true, rolledDice: [], flat: 3, dice: [] })] },
      { label: 'Damage', riders: [rider({ when: 'manual', on: true, rolled: true, rolledDice: [], flat: 5, dice: [] })] },
    ],
  })
  const t = rollTotals(e, riderViews(e))
  assert.equal(t.attack, 23)   // 14 + 6 + 3
  assert.equal(t.damage, 13)   // 8 + 5
})

// --- die chips ---------------------------------------------------------------

test('an adv attack keeps both dice and strikes the loser through', () => {
  const e = entry({ attack: { ...ATTACK, d20: 18, rolls: [7, 18], mode: 'adv', total: 24 } })
  const [line] = lineViews(e)
  assert.deepEqual(line.dice, [{ v: 7, sides: 20, dropped: true }, { v: 18, sides: 20, dropped: false }])
  assert.equal(line.mode, 'adv')
})

test('two identical faces still mark exactly one kept', () => {
  // Both dice show 17 under advantage. Naive "is this the pick" marks neither as
  // dropped, or both — either reads as a bug on screen.
  const e = entry({ attack: { ...ATTACK, d20: 17, rolls: [17, 17], mode: 'adv' } })
  const [line] = lineViews(e)
  assert.deepEqual(line.dice.map(d => d.dropped), [false, true])
})

test('a normal attack shows one die and no mode', () => {
  const [line] = lineViews(entry({ attack: ATTACK }))
  assert.deepEqual(line.dice, [{ v: 14, sides: 20, dropped: false }])
  assert.equal(line.mode, undefined)
})

test('damage die sides are recovered from the expression', () => {
  const [line] = lineViews(entry({ damage: { ...DAMAGE, diceExpr: '2d6', dice: [3, 6] } }))
  assert.deepEqual(line.dice, [{ v: 3, sides: 6 }, { v: 6, sides: 6 }])
})

test('a check line derives its modifier from total minus the kept die', () => {
  const e = entry({
    kind: 'save',
    check: { mode: 'adv', rolls: [4, 15], pick: 15, breakdown: '', total: 22, crit: false, fumble: false },
  })
  const [line] = lineViews(e)
  assert.equal(line.label, 'Save')
  assert.equal(line.mods, 7)
  assert.equal(line.total, 22)
  assert.deepEqual(line.dice.map(d => d.dropped), [true, false])
})
