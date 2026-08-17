// Run: node --test src/lib/turns.test.ts
//
// Every number here is wrong quietly. An effect that expires a turn late is a
// bonus the player no longer has; one that expires a turn early is one they paid
// for and lost. Neither announces itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ActiveEffect } from './database.types.ts'
import { advanceTurn, durationTurns, turnsLabel } from './turns.ts'

const eff = (over: Partial<ActiveEffect> = {}): ActiveEffect =>
  ({ id: 'e1', name: 'Haste', effects: {}, ...over }) as ActiveEffect

test('a minute is ten turns, and a round is one', () => {
  // The conversion the whole feature was asked for.
  assert.equal(durationTurns(1, 'minute'), 10)
  assert.equal(durationTurns(10, 'round'), 10)
  assert.equal(durationTurns(3, 'round'), 3)
})

test('anything longer than a day is untracked rather than a huge number', () => {
  // A count nobody will watch reach zero is worse than no count.
  assert.equal(durationTurns(2, 'day'), undefined)
  assert.equal(durationTurns(0, 'minute'), undefined)
  assert.equal(durationTurns(1, 'until rest'), undefined)
})

test('a counted effect ticks down and expires at zero', () => {
  const one = advanceTurn([eff({ turns: 2 })])
  assert.equal(one.next[0].turns, 1)
  assert.equal(one.expired.length, 0)

  const last = advanceTurn(one.next)
  assert.deepEqual(last.next, [])
  assert.equal(last.expired.length, 1)
})

test('an effect with NO count never ticks and never expires', () => {
  // Absent means untracked, not zero. Reading it as expired would wipe every
  // "until rest" effect the first time the button was pressed.
  const r = advanceTurn([eff({ note: 'until rest' })])
  assert.equal(r.next.length, 1)
  assert.deepEqual(r.expired, [])
  assert.equal(r.running, 0, 'and it is not counted as running')
})

test('an effect ticks on the turn it expires, not the turn before', () => {
  // A poison with one turn left still poisons you as it wears off. Ticking after
  // the expiry check would silently cost the player a turn of damage.
  const r = advanceTurn([eff({ turns: 1, tick: '1d6' })])
  assert.deepEqual(r.ticks.map(t => t.dice), ['1d6'])
  assert.equal(r.expired.length, 1)
})

test('ticks come back to be ROLLED, not pre-rolled', () => {
  // The dice expression travels; no number is produced here. A number the app
  // rolled while the player was not looking is one they cannot check.
  const r = advanceTurn([eff({ id: 'p', name: 'Poison', turns: 5, tick: '1d6' })])
  assert.deepEqual(r.ticks, [{ id: 'p', name: 'Poison', dice: '1d6', icon: undefined }])
  assert.equal(r.next[0].turns, 4)
})

test('counted and uncounted effects survive the same pass independently', () => {
  const r = advanceTurn([eff({ id: 'a', turns: 1 }), eff({ id: 'b' }), eff({ id: 'c', turns: 4 })])
  assert.deepEqual(r.expired.map(e => e.id), ['a'])
  assert.deepEqual(r.next.map(e => e.id), ['b', 'c'])
  assert.equal(r.running, 1)
})

test('the chip label reads the last turn differently', () => {
  assert.equal(turnsLabel(eff({ turns: 3 })), '3 turns')
  assert.equal(turnsLabel(eff({ turns: 1 })), 'last turn')
  assert.equal(turnsLabel(eff({})), null)
})

test('a countdown that merely went down is reported too, not just an expiry', () => {
  // A tracker that only speaks when something expires cannot be trusted between
  // expiries: pressing the button and seeing nothing reads as "it did nothing"
  // rather than "three turns left".
  const r = advanceTurn([eff({ name: "Giant's Strength", turns: 3 })])
  assert.deepEqual(r.counted.map(e => [e.name, e.turns]), [["Giant's Strength", 2]])
  assert.deepEqual(r.expired, [])
})

test('the turn it expires it is expired, not counted', () => {
  // Both lists at once would report one effect twice on its last turn.
  const r = advanceTurn([eff({ turns: 1 })])
  assert.deepEqual(r.counted, [])
  assert.equal(r.expired.length, 1)
})
