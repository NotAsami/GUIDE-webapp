// Run: node --test src/lib/rollView.test.ts
//
// The panel's arithmetic, tested without a renderer. This is the layer where a
// wrong number is most dangerous: a rider counted twice, or an answered `ask`
// that never reaches the total, is a number a player trusts and shouldn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Rider } from './graph.ts'
import type { CheckRoll, RollEntry } from './rolls.tsx'
import type { CharacterRow } from './database.types.ts'
import {
  askSections, catalogView, lineViews, openAsks, patchRiders, pendingOf, pendingTotal, pickedOf,
  picksAllowed, picksTaken, rerollAt, rerollD20, rerollDamage, rerollsOf,
  releaseIdsOf, resolvedOf, riderAmount, riderValue, riderViews, rollTotals, sourceGroups, unresolvedOf,
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

test('a spell\u2019s save DC leads the lines and titles the footer honestly', () => {
  // It fills the slot an attack roll would, but it is not a roll: no dice, and
  // "Total Save DC" would be a lie — a DC is not a total of anything.
  const e = entry({ kind: 'custom', saveDC: 15, damage: DAMAGE })
  const [first] = lineViews(e)
  assert.equal(first.label, 'Save DC')
  assert.equal(first.totalLabel, 'Save DC')
  assert.deepEqual(first.dice, [])
  assert.equal(first.total, 15)
  assert.equal(first.mods, 15)
  // The footer reads it as the attack-slot line, and damage still totals apart.
  const t = rollTotals(e, riderViews(e))
  assert.equal(t.attack, 15)
  assert.equal(t.damage, 8)
})

test('a roll with no save DC is unchanged', () => {
  assert.equal(lineViews(entry({ attack: ATTACK }))[0].label, 'Attack')
  assert.equal(lineViews(entry({ attack: ATTACK }))[0].totalLabel, undefined)
})

test('a save DC names its ability, and a spell with no save shows none', () => {
  const withSave = entry({ kind: 'custom', saveDC: 15, saveAbility: 'dex', damage: DAMAGE })
  const [first] = lineViews(withSave)
  assert.equal(first.label, 'DEX Save DC')
  assert.equal(first.totalLabel, 'DEX Save DC')
  assert.equal(first.total, 15)
  // No saveDC at all — the slot stays empty rather than showing a DC the spell
  // never calls for, which is what it did before the spell could say.
  assert.equal(lineViews(entry({ kind: 'custom', damage: DAMAGE })).length, 1)
})

/* ---------- pendingOf: one definition for three surfaces ---------- */

const askRider = (on: boolean) => rider({ when: 'manual', on, dice: ['1d6'], flat: 0 })
const err = { sev: 'err' as const, id: null, t: 'Broke', s: 'produced no value' }

test('an unanswered ask counts, and answering it decrements', () => {
  const groups = (on: boolean) => [{ label: 'Damage', riders: [askRider(on)] }]
  assert.equal(pendingOf(entry({ riderGroups: groups(false) })).total, 1)
  assert.equal(pendingOf(entry({ riderGroups: groups(true) })).total, 0)
})

test('only err problems count — a warn or an ok is not something the player must do', () => {
  // An AuditItem can be 'ok' or 'warn'. Counting an authoring note as work is the
  // badge lying about the roll.
  for (const sev of ['warn', 'ok'] as const) {
    assert.equal(pendingOf(entry({ problems: [{ ...err, sev }] })).total, 0, `${sev} must not count`)
  }
  assert.equal(pendingOf(entry({ problems: [err] })).total, 1)
})

test('acked settles everything, including an ask left switched off', () => {
  // The dismissal rule, and the correction that matters: LEAVING A TOGGLE OFF IS
  // AN ANSWER. The attack missed, so the feature did not apply and the player is
  // done — counting it as outstanding pulses the badge for the rest of the
  // session at someone who already dealt with it.
  const both = { riderGroups: [{ label: 'Damage', riders: [askRider(false)] }], problems: [err] }
  assert.deepEqual(pendingOf(entry(both)), { asks: 1, problems: 1, total: 2 })
  assert.deepEqual(pendingOf(entry({ ...both, acked: true })), { asks: 0, problems: 0, total: 0 })
})

test('a plain roll has nothing pending', () => {
  // The toast's "no second line" case and the badge's hidden case are the same
  // fact, which is why they read the same function.
  assert.equal(pendingOf(entry({ attack: ATTACK, damage: DAMAGE })).total, 0)
})

test('the badge counts things, not rolls', () => {
  // "2" has to mean two things need you. Two rolls each owing one decision is 2,
  // and one roll owing two is also 2.
  const one = entry({ id: 'a', riderGroups: [{ label: 'Damage', riders: [askRider(false)] }] })
  const two = entry({ id: 'b', riderGroups: [{ label: 'Damage', riders: [askRider(false), askRider(false)] }] })
  assert.equal(pendingTotal([one, one]), 2)
  assert.equal(pendingTotal([two]), 2)
  assert.equal(pendingTotal([]), 0)
})


/* ---------- exclusive choices: pick one, and it locks ----------
   Brutal Strike's two blows are one decision. The failure this guards is the
   one that shipped: both offered at once, both takeable, both armed. */

const blow = (label: string, over: Partial<Rider> = {}): Rider => rider({
  label, source: 'Brutal Strike', op: 'note', formula: '', flat: 0, dice: [],
  when: 'manual', on: false, choice: 'feature:brutal', armedId: `feature:brutal:${label}`, ...over,
})

const entryOf = (riders: Rider[]): RollEntry => ({
  id: 'e', at: 0, kind: 'weapon', title: 'Sanctity',
  riderGroups: [{ label: 'Damage', riders }],
})

test('riders sharing a `choice` become ONE section, in the position of the first', () => {
  const e = entryOf([
    rider({ label: 'Judged', when: 'manual', on: false }),
    blow('Forceful Blow'),
    blow('Hamstring Blow'),
  ])
  const secs = askSections(riderViews(e))
  assert.equal(secs.length, 2)
  assert.equal(secs[0].choice, undefined)
  assert.equal(secs[1].choice, 'feature:brutal')
  assert.deepEqual(secs[1].views.map(v => v.rider.label), ['Forceful Blow', 'Hamstring Blow'])
})

test('a LONE offered arm is a yes/no, not a pick-one', () => {
  // Painting one option as a choice implies a sibling that is not there.
  const secs = askSections(riderViews(entryOf([rider({ label: 'Judged', when: 'manual', on: false })])))
  assert.equal(secs.length, 1)
  assert.equal(secs[0].choice, undefined)
})

test('only one option in a group can be answered', () => {
  const secs = askSections(riderViews(entryOf([blow('Forceful Blow'), blow('Hamstring Blow')])))
  const group = secs[0].views
  assert.equal(pickedOf(group), null, 'opens with nothing chosen')
  // What the panel does on a pick: every sibling is patched, not just the one
  // clicked. If it ever patches only the target, this is what catches it.
  const picked = group.map(v => ({ ...v.rider, on: v.rider.label === 'Hamstring Blow' }))
  assert.equal(picked.filter(r => r.on).length, 1)
  const after = askSections(riderViews(entryOf(picked)))
  assert.equal(pickedOf(after[0].views)?.rider.label, 'Hamstring Blow')
})

test('a group may allow TWO picks, and the count belongs to the group', () => {
  /* Improved Brutal Strike (Enhanced): "you can use two different Brutal Strike
     effects". The limit rides on the riders, so every member agrees about it by
     construction rather than by two fields staying in step. */
  const two = [blow('Forceful Blow', { picks: 2 }), blow('Hamstring Blow', { picks: 2 }), blow('Staggering Blow', { picks: 2 })]
  const open = askSections(riderViews(entryOf(two)))[0].views
  assert.equal(picksAllowed(open), 2)
  assert.deepEqual(picksTaken(open), [])

  // One taken: the group is ANSWERED — taking fewer than the limit is a
  // decision, not an omission — but it is not full, so a second is still open.
  const one = two.map(r => ({ ...r, on: r.label === 'Forceful Blow' }))
  const afterOne = askSections(riderViews(entryOf(one)))[0].views
  assert.equal(pickedOf(afterOne)?.rider.label, 'Forceful Blow')
  assert.equal(picksTaken(afterOne).length, 1)
  assert.equal(openAsks(riderViews(entryOf(one))).length, 0, 'answered, so the badge stops counting it')

  // Two taken, and they STAND TOGETHER: the panel's patch is additive, so the
  // second pick does not un-pick the first.
  const both = two.map(r => ({ ...r, on: r.label !== 'Staggering Blow' }))
  const afterTwo = askSections(riderViews(entryOf(both)))[0].views
  assert.deepEqual(picksTaken(afterTwo).map(v => v.rider.label), ['Forceful Blow', 'Hamstring Blow'])
  assert.equal(picksTaken(afterTwo).length >= picksAllowed(afterTwo), true, 'full')
})

test('a group with no picks count is a pick-one, exactly as before', () => {
  const group = askSections(riderViews(entryOf([blow('Forceful Blow'), blow('Hamstring Blow')])))[0].views
  assert.equal(picksAllowed(group), 1)
})

test('an unanswered offered arm contributes NOTHING to the total', () => {
  // It is `manual`, so the roller never folded it in and the panel must not
  // either — an offered blow is not a bonus you have.
  const e: RollEntry = {
    ...entryOf([blow('Big Hit', { op: 'add', formula: '1d10', flat: 8, dice: [] })]),
    damage: { ...DAMAGE, diceExpr: '1d8', dice: faces(8, 4), bonus: 8, total: 12 },
  }
  const views = riderViews(e)
  assert.equal(rollTotals(e, views).damage, 12)
  assert.equal(views[0].live, false)
})


test('PICKING PATCHES THE WHOLE GROUP IN ONE WRITE', () => {
  /* The bug this exists for: the panel patched one rider per call, and each
     call rebuilt the list from the same pre-patch entry — so the second call
     overwrote the first and the pick silently did nothing on screen. */
  const e = entryOf([blow('Forceful Blow'), blow('Hamstring Blow')])
  const groups = patchRiders(e, [
    { index: 0, patch: { on: true } },
    { index: 1, patch: { on: false } },
  ])
  assert.deepEqual(groups[0].riders.map(r => r.on), [true, false])
  // And the view layer agrees about which one is answered.
  assert.equal(pickedOf(askSections(riderViews({ ...e, riderGroups: groups }))[0].views)?.rider.label, 'Forceful Blow')
})

test('patching addresses riders across groups, and leaves the rest alone', () => {
  const e: RollEntry = {
    id: 'e', at: 0, kind: 'weapon', title: 'T',
    riderGroups: [
      { label: 'Attack', riders: [rider({ label: 'A' }), rider({ label: 'B' })] },
      { label: 'Damage', riders: [rider({ label: 'C' })] },
    ],
  }
  const g = patchRiders(e, [{ index: 2, patch: { label: 'patched' } }])
  assert.deepEqual(g[0].riders.map(r => r.label), ['A', 'B'])
  assert.deepEqual(g[1].riders.map(r => r.label), ['patched'])
})

test('A PICK-ONE IS ONE QUESTION, AND CHOOSING ANSWERS IT', () => {
  /* Two failures in one: it counted "2 riders waiting" for a single decision,
     and after picking it still counted 1 — the option NOT taken is unanswered
     by construction, so the count could never reach zero. */
  const open = entryOf([blow('Forceful Blow'), blow('Hamstring Blow')])
  assert.equal(openAsks(riderViews(open)).length, 1, 'two options, one question')
  assert.equal(pendingOf(open).total, 1)

  const picked = entryOf([blow('Forceful Blow', { on: true }), blow('Hamstring Blow')])
  assert.equal(openAsks(riderViews(picked)).length, 0, 'choosing answers the group')
  assert.equal(pendingOf(picked).total, 0)
  assert.equal(rollTotals(picked, riderViews(picked)).pending, 0)
})

test('ADVANTAGE AND DISADVANTAGE CANCEL, so neither is reported as granted', () => {
  // Brutal Strike forgoing Reckless Attack's advantage. Printing both reads as
  // the app not knowing what it did — the d20 line already shows the single die.
  const e = entry({
    attack: ATTACK,
    riderGroups: [{ label: 'Attack', riders: [
      rider({ op: 'adv', when: 'always', flat: 0, label: 'Reckless Attack' }),
      rider({ op: 'dis', when: 'always', flat: 0, label: 'Brutal Strike' }),
    ] }],
  })
  assert.deepEqual(rollTotals(e, riderViews(e)).flags, [])

  // One on its own still reports.
  const only = entry({
    attack: ATTACK,
    riderGroups: [{ label: 'Attack', riders: [rider({ op: 'adv', when: 'always', flat: 0 })] }],
  })
  assert.deepEqual(rollTotals(only, riderViews(only)).flags, ['ADVANTAGE'])

  // A crit alongside a cancelling pair survives — only the pair cancels.
  const withCrit = entry({
    attack: ATTACK,
    riderGroups: [{ label: 'Attack', riders: [
      rider({ op: 'adv', when: 'always', flat: 0 }),
      rider({ op: 'dis', when: 'always', flat: 0 }),
      rider({ op: 'crit', when: 'always', flat: 0 }),
    ] }],
  })
  assert.deepEqual(rollTotals(withCrit, riderViews(withCrit)).flags, ['CRIT'])
})

/* Brutal Strike buys extra damage WITH disadvantage. Rider order follows the
   engine's line groups (Attack before Damage), so the row printed the price
   before the thing bought — "DISADVANTAGE +10". */
test('a source lists its amounts before the flags it attached', () => {
  const views = riderViews(entry({
    riderGroups: [
      { label: 'Attack', riders: [rider({ sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Dis', op: 'disadvantage' })] },
      { label: 'Damage', riders: [rider({ sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Extra', flat: 10 })] },
    ],
  }))
  const [g] = sourceGroups(views)
  assert.deepEqual(g.views.map(v => v.rider.label), ['Extra', 'Dis'])
})

test('two amounts from one source keep the order the engine gave them', () => {
  const views = riderViews(entry({
    riderGroups: [{ label: 'Damage', riders: [
      rider({ sourceGid: 'feature:x', source: 'X', label: 'First', flat: 1 }),
      rider({ sourceGid: 'feature:x', source: 'X', label: 'Second', flat: 2 }),
    ] }],
  }))
  assert.deepEqual(sourceGroups(views)[0].views.map(v => v.rider.label), ['First', 'Second'])
})

/* ONE PRESS, ONE SWING, ONE RELEASE. Brutal Strike arms four mods on a single
   activation: two offered blows and two TAKEN ones. Answering released only the
   arms that asked, so "Remove Advantage" and the +1d10 stayed in the queue and
   rode the next attack — the blows correctly gone, the price still charged. */
const bsEntry = () => entry({
  riderGroups: [
    { label: 'Attack', riders: [rider({
      sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Remove Advantage',
      op: 'dis', when: 'always', on: true, armedId: 'a-dis',
    })] },
    { label: 'Damage', riders: [
      rider({ sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Add 1d10',
        dice: ['1d10'], flat: 0, when: 'always', on: true, armedId: 'a-add' }),
      rider({ sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Forceful Blow',
        op: 'note', when: 'manual', on: false, armedId: 'a-forceful', choice: 'feature:bs' }),
      rider({ sourceGid: 'feature:bs', source: 'Brutal Strike', label: 'Hamstring Blow',
        op: 'note', when: 'manual', on: false, armedId: 'a-hamstring', choice: 'feature:bs' }),
      rider({ sourceGid: 'feature:rage', source: 'Rage', label: 'Rage', flat: 2, armedId: 'a-rage' }),
    ] },
  ],
})

test('answering a blow releases the WHOLE activation, taken arms included', () => {
  const views = riderViews(bsEntry())
  const [section] = askSections(views).filter(s => s.choice)
  assert.deepEqual(
    releaseIdsOf(views, section.views).sort(),
    ['a-add', 'a-dis', 'a-forceful', 'a-hamstring'],
  )
})

test('releasing one source never reaches another feature holding on the same roll', () => {
  const views = riderViews(bsEntry())
  const [section] = askSections(views).filter(s => s.choice)
  assert.ok(!releaseIdsOf(views, section.views).includes('a-rage'))
})

/* ---------- `reroll`: re-running a roll that already happened ---------- */

const checked = (over: Partial<CheckRoll> = {}): RollEntry => ({
  id: 'r1', at: 1, kind: 'save', title: 'WIS SAVE',
  check: {
    mode: 'normal', rolls: [{ v: 7, sides: 20 }], pick: 7,
    terms: [{ label: 'WIS', value: 4 }, { label: 'PROF', value: 3, prof: true }],
    breakdown: '7 +4 WIS +3 PROF', total: 14, crit: false, fumble: false, ...over,
  },
})

test('reroll with advantage ADDS a die and keeps the higher', () => {
  const before = checked()
  const patch = rerollD20(before, 'advantage')!
  const c = patch.check!
  assert.equal(c.rolls.length, 2, 'the original die is still there')
  assert.equal(c.rolls[0].v, 7, '…and it is the one that was rolled')
  assert.equal(c.mode, 'adv')
  assert.equal(c.pick, Math.max(...c.rolls.map(d => d.v)))
  // The total is recomposed from the terms, so the breakdown cannot drift.
  assert.equal(c.total, c.pick + 7)
  assert.ok(c.breakdown.startsWith(`${c.pick} `))
})

test('reroll `new` replaces the die — better or worse, you are stuck with it', () => {
  const c = rerollD20(checked(), 'new')!.check!
  assert.equal(c.rolls.length, 1, 'no second die')
  assert.equal(c.mode, 'normal')
  assert.equal(c.pick, c.rolls[0].v)
  assert.equal(c.total, c.pick + 7)
})

test('a rerolled d20 recomputes crit and fumble — unlike a single-die reroll', () => {
  /* rerollAt freezes them on purpose: a crit already decided how many damage
     dice exist. A check or a save has no damage hanging off it, so a save still
     reading CRIT on a natural 20 the player just rerolled away is simply wrong. */
  for (let i = 0; i < 200; i++) {
    const c = rerollD20(checked({ rolls: [{ v: 20, sides: 20 }], pick: 20, crit: true, total: 27 }), 'new')!.check!
    assert.equal(c.crit, c.pick === 20, `crit follows the die that counts (${c.pick})`)
    assert.equal(c.fumble, c.pick === 1)
  }
})

test('a reroll rider is an offer, not a contribution and not a checkbox', () => {
  const entry: RollEntry = {
    ...checked(),
    riderGroups: [{ label: 'Save', riders: [
      { label: 'Countercharm', source: 'Countercharm', op: 'reroll', formula: '', flat: 0, dice: [], when: 'manual', on: false, keep: 'advantage' },
      { label: 'Bless', source: 'Bless', op: 'add', formula: '1d4', flat: 0, dice: ['1d4'], when: 'always', on: true },
    ] }],
  }
  const views = riderViews(entry)
  assert.deepEqual(resolvedOf(views).map(v => v.rider.label), ['Bless'], 'not an applied line')
  assert.deepEqual(unresolvedOf(views).map(v => v.rider.label), [], 'not an outstanding ask')
  assert.deepEqual(rerollsOf(views).map(v => v.rider.label), ['Countercharm'])
  // Taken, it stops being offered.
  const taken = patchRiders(entry, [{ index: 0, patch: { on: true } }])
  assert.equal(rerollsOf(riderViews({ ...entry, riderGroups: taken })).length, 0)
})

test('a roll with no d20 cannot be rerolled', () => {
  assert.equal(rerollD20({ id: 'x', at: 1, kind: 'weapon', title: 'Axe' }, 'advantage'), null)
})

/* ---------- rerolling DAMAGE: Great Weapon Fighting and Savage Attacker ---- */

const damaged = (dice: number[], bonus = 4): RollEntry => ({
  id: 'd1', at: 1, kind: 'weapon', title: 'Greataxe',
  damage: { dice: dice.map(v => ({ v, sides: 12 })), bonus, total: dice.reduce((a, b) => a + b, 0) + bonus, diceExpr: '2d12', type: 'slashing', crit: false },
})

test('GREAT WEAPON FIGHTING: only the low dice are rerolled, and they stand', () => {
  for (let i = 0; i < 200; i++) {
    const before = damaged([1, 2, 11])
    const d = rerollDamage(before, 'new', 2)!.damage!
    // The high die was never touched; the low two were.
    assert.equal(d.dice[2].v, 11, 'a die above the threshold is left alone')
    assert.ok(d.dice[0].v >= 1 && d.dice[0].v <= 12)
    // Whatever came up, it counts — this is not "keep the better".
    assert.equal(d.total, d.dice.reduce((a, b) => a + b.v, 0) + d.bonus)
  }
})

test('a threshold no die meets is not a reroll at all', () => {
  // Pressing Halfling Lucky on a 14 must leave the roll alone, not hand out a
  // free reroll — and null is what tells the panel to keep the offer up.
  assert.equal(rerollDamage(damaged([7, 9]), 'new', 2), null)
  assert.equal(rerollD20(checked({ rolls: [{ v: 14, sides: 20 }], pick: 14 }), 'new', 1), null)
  // …and at the threshold it does fire.
  assert.ok(rerollDamage(damaged([2, 9]), 'new', 2))
  assert.ok(rerollD20(checked({ rolls: [{ v: 1, sides: 20 }], pick: 1 }), 'new', 1))
})

test('SAVAGE ATTACKER: the whole roll again, and the better TOTAL wins', () => {
  /* Better total, never better dice: picking the higher face of each die
     individually would be a much stronger feature than the one printed. */
  for (let i = 0; i < 300; i++) {
    const before = damaged([12, 12])
    const d = rerollDamage(before, 'better')!.damage!
    assert.equal(d.total, 28, 'a maximum roll can only be matched, never beaten')
  }
  for (let i = 0; i < 300; i++) {
    const before = damaged([1, 1])
    const d = rerollDamage(before, 'better')!.damage!
    assert.ok(d.total >= 6, 'the worst roll can only improve')
    assert.equal(d.total, d.dice.reduce((a, b) => a + b.v, 0) + d.bonus)
  }
})

test('a roll with no damage cannot have its damage rerolled', () => {
  assert.equal(rerollDamage(checked(), 'better'), null)
  assert.equal(rerollDamage({ id: 'x', at: 1, kind: 'weapon', title: 'Axe' }, 'new'), null)
})

test('a damage reroll rider says WHICH dice it re-runs', () => {
  // `keep: 'new'` reads identically on a d20 and on damage, so the panel cannot
  // guess — the rider carries `rerolls`.
  const entry: RollEntry = {
    ...damaged([1, 5]),
    riderGroups: [{ label: 'Damage', riders: [
      { label: 'Great Weapon Fighting', source: 'Fighting Style', op: 'reroll', formula: '', flat: 0, dice: [], when: 'manual', on: false, keep: 'new', rerolls: 'damage', faces: 2 },
    ] }],
  }
  const [v] = rerollsOf(riderViews(entry))
  assert.equal(v.rider.rerolls, 'damage')
  assert.equal(v.rider.faces, 2)
})
