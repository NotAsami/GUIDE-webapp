// Run: node --test src/lib/rollView.test.ts
//
// The panel's arithmetic, tested without a renderer. This is the layer where a
// wrong number is most dangerous: a rider counted twice, or an answered `ask`
// that never reaches the total, is a number a player trusts and shouldn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rider } from './graph.ts'
import type { RollEntry } from './rolls.tsx'
import type { CharacterRow } from './database.types.ts'
import {
  catalogView, lineViews, rerollAt, resolvedOf, riderAmount, riderValue, riderViews, rollTotals, unresolvedOf,
} from './rollView.ts'

const rider = (over: Partial<Rider>): Rider => ({
  label: 'R', source: 'Src', op: 'add', formula: '2', flat: 2, dice: [],
  when: 'always', on: true, ...over,
})

const entry = (over: Partial<RollEntry>): RollEntry => ({
  id: 'r1', at: 0, kind: 'weapon', title: 'Longsword', ...over,
} as RollEntry)

/** Faces → dice. `sides` travels with the die now, so every fixture states it. */
const faces = (sides: number, ...vs: number[]) => vs.map(v => ({ v, sides }))
const d20s = (...vs: number[]) => faces(20, ...vs)

const ATTACK = { d20: 14, rolls: d20s(14), mode: 'normal' as const, bonus: 6, total: 20, crit: false, fumble: false, breakdown: '' }
const DAMAGE = { diceExpr: '1d8', dice: faces(8, 5), bonus: 3, total: 8, type: 'slashing', crit: false, breakdown: '' }

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
      rider({ when: 'manual', on: true, dice: ['1d6'], flat: 0, rolled: true, rolledDice: faces(6, 4) }),
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
  const r = rider({ when: 'manual', on: false, dice: ['1d6'], flat: 0, rolled: true, rolledDice: faces(6, 4) })
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
  const e = entry({ attack: { ...ATTACK, d20: 18, rolls: d20s(7, 18), mode: 'adv', total: 24 } })
  const [line] = lineViews(e)
  assert.deepEqual(line.dice, [{ v: 7, sides: 20, dropped: true }, { v: 18, sides: 20, dropped: false }])
  assert.equal(line.mode, 'adv')
})

test('two identical faces still mark exactly one kept', () => {
  // Both dice show 17 under advantage. Naive "is this the pick" marks neither as
  // dropped, or both — either reads as a bug on screen.
  const e = entry({ attack: { ...ATTACK, d20: 17, rolls: d20s(17, 17), mode: 'adv' } })
  const [line] = lineViews(e)
  assert.deepEqual(line.dice.map(d => d.dropped), [false, true])
})

test('a normal attack shows one die and no mode', () => {
  const [line] = lineViews(entry({ attack: ATTACK }))
  assert.deepEqual(line.dice, [{ v: 14, sides: 20, dropped: false }])
  assert.equal(line.mode, undefined)
})

test('die sides come off the DIE, not off the expression', () => {
  // The expression lies on purpose: re-parsing "2d6" is how a 6 gets drawn as a
  // maximum roll on a d8. The die carries its own sides and wins.
  const [line] = lineViews(entry({ damage: { ...DAMAGE, diceExpr: '2d6', dice: faces(8, 3, 6) } }))
  assert.deepEqual(line.dice, [{ v: 3, sides: 8 }, { v: 6, sides: 8 }])
})

test('a check line derives its modifier from total minus the kept die', () => {
  const e = entry({
    kind: 'save',
    check: { mode: 'adv', rolls: d20s(4, 15), pick: 15, breakdown: '', total: 22, crit: false, fumble: false },
  })
  const [line] = lineViews(e)
  assert.equal(line.label, 'Save')
  assert.equal(line.mods, 7)
  assert.equal(line.total, 22)
  assert.deepEqual(line.dice.map(d => d.dropped), [true, false])
})

// --- reroll ------------------------------------------------------------------

test('rerolling a damage die moves the line total AND the roll total', () => {
  const e = entry({ damage: { ...DAMAGE, diceExpr: '2d6', dice: faces(6, 3, 4), bonus: 3, total: 10 } })
  const patch = rerollAt(e, { line: 0, die: 0 })!
  const next = { ...e, ...patch }
  const [line] = lineViews(next)
  const rolled = next.damage!.dice[0]
  assert.equal(rolled.rerolled, true)
  assert.equal(rolled.orig, 3)
  assert.equal(next.damage!.dice[1].v, 4)                    // its neighbour is untouched
  assert.equal(next.damage!.total, rolled.v + 4 + 3)         // the stored total moved
  assert.equal(line.total, next.damage!.total)               // and the line agrees
  assert.equal(rollTotals(next, riderViews(next)).damage, next.damage!.total)
})

test('rerolling the loser of an advantage pair is refused', () => {
  // It did not count. Rerolling it would imply it could.
  const e = entry({ attack: { ...ATTACK, d20: 18, rolls: d20s(7, 18), mode: 'adv', total: 24 } })
  assert.equal(rerollAt(e, { line: 0, die: 0 }), null)
  assert.notEqual(rerollAt(e, { line: 0, die: 1 }), null)
})

test('rerolling the kept d20 re-picks under advantage', () => {
  const e = entry({ attack: { ...ATTACK, d20: 18, rolls: d20s(7, 18), mode: 'adv', bonus: 6, total: 24 } })
  const next = { ...e, ...rerollAt(e, { line: 0, die: 1 })! }
  const a = next.attack!
  assert.equal(a.d20, Math.max(a.rolls![0].v, a.rolls![1].v)) // advantage still keeps the high die
  assert.equal(a.total, a.d20 + 6)
  // Frozen on purpose: the crit already decided how many damage dice exist.
  assert.equal(a.crit, e.attack!.crit)
})

test('a die index that does not exist is refused rather than guessed at', () => {
  assert.equal(rerollAt(entry({ damage: DAMAGE }), { line: 0, die: 9 }), null)
  assert.equal(rerollAt(entry({ damage: DAMAGE }), { line: 3, die: 0 }), null)
})

// --- the catalog sheet -------------------------------------------------------

test('a subject resolves against the character, and a missing one returns null', () => {
  const weapon = { id: 'w1', name: 'Greatsword', damageDice: '1d12', type: 'slashing', category: 'weapon' as const }
  const character = {
    id: 'c1', sheet: { features: [{ id: 'f1', name: 'Second Wind', usage: '1/short rest' }] },
    equipped: { weapons: [weapon] },
  } as unknown as CharacterRow

  const w = catalogView(character, { kind: 'weapon', id: 'w1' })!
  assert.equal(w.name, 'Greatsword')
  assert.deepEqual(w.damage, [['1d12', 'slashing']])

  const f = catalogView(character, { kind: 'feature', id: 'f1' })!
  assert.equal(f.name, 'Second Wind')
  assert.ok(f.stats.some(([k, v]) => k === 'Usage' && v === '1/short rest'))

  // Unequipped since the roll — the sheet says so instead of drawing a blank.
  assert.equal(catalogView(character, { kind: 'weapon', id: 'gone' }), null)
  assert.equal(catalogView(character, undefined), null)
  assert.equal(catalogView(null, { kind: 'weapon', id: 'w1' }), null)
})

// --- what a rider READS as, versus what it is worth ---------------------------

test('a dice contribution reads as its dice, not as "+0"', () => {
  // THE BUG: riderValue() is the number a rider adds to the panel's totals, and
  // for a dice contribution that is genuinely 0 — the roller already rolled it
  // into the line's modifier. Printing it said "+0" for a +1d6.
  const r = rider({ when: 'always', label: 'Boosted Cut', flat: 0, dice: ['1d6'] })
  assert.equal(riderValue(r), 0)
  assert.equal(riderAmount(r), '+1d6')

  assert.equal(riderAmount(rider({ when: 'always', flat: 3, dice: [] })), '+3')
  assert.equal(riderAmount(rider({ when: 'always', flat: -2, dice: [] })), '-2')
  assert.equal(riderAmount(rider({ when: 'always', flat: 2, dice: ['1d6'] })), '+1d6 + 2')
  // Bane: the dice term carries its own sign and must not gain a second one.
  assert.equal(riderAmount(rider({ when: 'always', flat: 0, dice: ['-1d4'] })), '-1d4')
  // Unanswered: the formula, never a value (§7).
  assert.equal(riderAmount(rider({ when: 'manual', on: false, formula: '1d6', flat: 0, dice: ['1d6'] })), '1d6')
  // Answered and rolled: a real number.
  assert.equal(riderAmount(rider({ when: 'manual', on: true, rolled: true, rolledDice: faces(6, 4), flat: 0, dice: ['1d6'] })), '+4')
  assert.equal(riderAmount(rider({ op: 'adv', when: 'always', flat: 0 })), 'ADV')
})

test('the panel adds ONLY manual riders — everything else is already in the line', () => {
  // Every roll producer builds its bonus from total(), which contains both the
  // unconditional fold AND every resolved rider. Adding an `active` rider here
  // too inflated the footer past the line it was supposedly totalling.
  const e = entry({
    // bonus 9 = the weapon's 6 plus the active rider's 3, as the roller built it
    attack: { ...ATTACK, bonus: 9, total: 23 },
    riderGroups: [{ label: 'Attack', riders: [
      rider({ when: 'active', on: true, label: 'Bloodied', flat: 3, dice: [] }),
    ] }],
  })
  const t = rollTotals(e, riderViews(e))
  assert.equal(lineViews(e)[0].total, 23)
  assert.equal(t.attack, 23, 'the footer must agree with the line above it')
})

test('…and a manual rider IS added, because it was answered after the roll', () => {
  const e = entry({
    attack: { ...ATTACK, bonus: 6, total: 20 },
    riderGroups: [{ label: 'Attack', riders: [
      rider({ when: 'manual', on: true, rolled: true, rolledDice: [], flat: 3, dice: [] }),
    ] }],
  })
  assert.equal(rollTotals(e, riderViews(e)).attack, 23)
})

test('a rolled contribution reads as its result, not its expression', () => {
  // §49: the roller now keeps each contribution's faces ON the contribution, so
  // the row can show a number the player can check against the line above it.
  const r = rider({ when: 'always', label: 'Boosted Cut', flat: 0, dice: ['1d6'], rolledDice: faces(6, 4) })
  assert.equal(riderAmount(r), '+4')
  // …and a flat riding along with the dice is included.
  assert.equal(riderAmount(rider({ when: 'always', flat: 2, dice: ['1d6'], rolledDice: faces(6, 4) })), '+6')
  // Unrolled still reads as the expression — nothing has happened yet.
  assert.equal(riderAmount(rider({ when: 'always', flat: 0, dice: ['1d6'] })), '+1d6')
})
