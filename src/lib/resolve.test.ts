// Run: node --test src/lib/resolve.test.ts
//
// The resolve's promises are numbers: every total by 400 ms whatever the die
// count, and no noise frame that could be read as a result.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schedule, entryClock, natOf, noise } from './resolve.ts'

test('every total locks by 400 ms, however many dice', () => {
  for (let n = 1; n <= 40; n++) {
    for (const split of [[n], [1, n], [n, n]]) {
      const { dice, totals } = schedule(split)
      const flat = dice.flat()
      assert.equal(flat[0], 180)
      assert.ok(flat.every((t, i) => i === 0 || t > flat[i - 1]), `strictly staggered: ${split}`)
      assert.ok(Math.max(...totals) <= 400.0001, `${split} lands by 400`)
    }
  }
})

test('the worked examples on the canvas', () => {
  assert.deepEqual(schedule([3]), { dice: [[180, 225, 270]], totals: [355] })  // 2d6 + 1d8
  assert.deepEqual(schedule([1]), { dice: [[180]], totals: [265] })            // d20
  const fb = schedule([8])                                                     // 8d6
  assert.equal(Math.round(fb.dice[0][7]), 315)
  assert.equal(Math.round(fb.totals[0]), 400)
})

test('a dice-less line (a save DC) was never rolled, so it never waits', () => {
  assert.deepEqual(schedule([0, 1]).totals, [0, 265])
})

test('the outcome is decided when the KEPT d20 locks', () => {
  const adv = { kind: 'check', dice: [{ v: 9, sides: 20, dropped: true }, { v: 16, sides: 20 }] }
  const c = entryClock(1000, [adv])
  assert.equal(c.lines[0].decide, 1225)
  assert.equal(c.lines[0].dim, 1265)
  assert.equal(c.done, 1310)
})

test('a reroll moves only its die and its line total', () => {
  const atk = { kind: 'attack', dice: [{ v: 20, sides: 20 }] }
  const dmg = { kind: 'damage', dice: [{ v: 3, sides: 6 }, { v: 5, sides: 6 }] }
  const c = entryClock(0, [atk, dmg], { at: 5000, line: 1, die: 0 })
  assert.deepEqual(c.lines[1].dice, [5180, 270])
  assert.equal(c.lines[1].total, 5265)
  assert.equal(c.lines[0].total, 265, 'the attack line is untouched')
  assert.equal(c.lines[0].decide, 180, 'a damage reroll does not re-decide the attack')
  assert.equal(c.done, 5265)
})

test('a dropped 20 is not a natural 20', () => {
  const dis = { kind: 'attack', dice: [{ v: 20, sides: 20, dropped: true }, { v: 6, sides: 20 }] }
  assert.equal(natOf(dis), undefined)
  assert.equal(natOf({ kind: 'check', dice: [{ v: 1, sides: 20 }] }), 'nat1')
  assert.equal(natOf({ kind: 'damage', dice: [{ v: 20, sides: 20 }] }), undefined)
})

test('noise can never be read as a number', () => {
  for (let f = 0; f < 500; f++) {
    const s = noise(2, f % 7, f)
    assert.equal(s.length, 2)
    assert.doesNotMatch(s, /\d/)
  }
})
