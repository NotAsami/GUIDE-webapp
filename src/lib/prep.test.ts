// Run: node --test src/lib/prep.test.ts
//
// The board's own promises: a card says what it will do, a dragged card lands
// where it was dropped without renumbering its neighbours, and a played card
// offers a sentence the DM can keep.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventText, fireLabel, firedLabel, moveTo, planEvents, sortBetween, split, targetNames } from './prep.ts'
import type { PlanCardRow } from './database.types.ts'

const card = (over: Partial<PlanCardRow> = {}): PlanCardRow => ({
  id: 'c1', plan_id: 'p', kind: 'note', ref: null, title: '', note: '', target: [], sort: 0,
  fired_at: null, created_at: '', ...over,
})
const NAMES = new Map([['ros', 'Ros Chrisstone'], ['cor', 'Cornelius the III.']])

test('a quest card reveals a hidden quest and closes a visible one', () => {
  assert.equal(fireLabel('quest', { questVisible: false }), 'Reveal')
  assert.equal(fireLabel('quest', { questVisible: true }), 'Complete')
  assert.equal(firedLabel('quest', { questClosed: true }), 'Closed')
  // A revealed quest is visible but not closed — the reveal must not read as one.
  assert.equal(firedLabel('quest', { questClosed: false }), 'Revealed')
  assert.equal(fireLabel('shop'), 'Open')
  assert.equal(firedLabel('loot'), 'Rolled and pushed')
})

test('no one named means the whole party', () => {
  assert.equal(targetNames([], NAMES), 'the party')
  assert.equal(targetNames(['ros'], NAMES), 'Ros Chrisstone')
  assert.equal(targetNames(['ros', 'cor'], NAMES), 'Ros Chrisstone and Cornelius the III.')
})

test('each kind offers a sentence, not a log line', () => {
  assert.equal(eventText(card({ kind: 'shop', title: 'Freddy The III.' }), NAMES), 'Freddy The III. opened for the party.')
  assert.equal(eventText(card({ kind: 'loot', title: 'the Knight Corpse' }), NAMES), 'The party searched the Knight Corpse.')
  assert.equal(eventText(card({ kind: 'handout', title: 'The Scroll', target: ['ros'] }), NAMES), 'The Scroll reached Ros Chrisstone.')
  assert.equal(eventText(card({ kind: 'npc', title: 'Magistrate Voss', target: ['cor'] }), NAMES), 'Cornelius the III. learned of Magistrate Voss.')
  assert.equal(eventText(card({ kind: 'quest', title: 'Clear Your Name' }), NAMES), 'Clear Your Name began.')
  // A note is the DM's own words; it gets a full stop and nothing else.
  assert.equal(eventText(card({ kind: 'note', title: 'The assize convened' }), NAMES), 'The assize convened.')
  assert.equal(eventText(card({ kind: 'note', title: 'The assize convened.' }), NAMES), 'The assize convened.')
})

test('the wrap offers what was played, in the order it was played', () => {
  const cards = [
    card({ id: 'a', kind: 'shop', title: 'Freddy The III.', fired_at: '2026-09-22T21:48:00Z' }),
    card({ id: 'b', kind: 'note', title: 'The assize convened', fired_at: '2026-09-22T21:02:00Z' }),
    card({ id: 'c', kind: 'quest', ref: 'q1', title: 'Clear Your Name', fired_at: '2026-09-22T22:30:00Z' }),
    card({ id: 'd', kind: 'loot', title: 'the Knight Corpse' }),   // never played
  ]
  assert.deepEqual(planEvents(cards, NAMES, ref => ref === 'q1'), [
    'The assize convened.',
    'Freddy The III. opened for the party.',
    'Clear Your Name was closed.',   // that card's quest ended
  ])
  // The same card, when its quest was merely revealed, reads the other way.
  assert.deepEqual(planEvents(cards, NAMES, () => false).slice(-1), ['Clear Your Name began.'])
})

test('staged keeps the DM order; played reads newest first', () => {
  const cards = [
    card({ id: 'a', sort: 2 }), card({ id: 'b', sort: 1 }),
    card({ id: 'c', sort: 0, fired_at: '2026-09-22T21:00:00Z' }),
    card({ id: 'd', sort: 0, fired_at: '2026-09-22T22:00:00Z' }),
  ]
  const { staged, played } = split(cards)
  assert.deepEqual(staged.map(c => c.id), ['b', 'a'])
  assert.deepEqual(played.map(c => c.id), ['d', 'c'])
})

test('a dragged card writes one row, and the others keep their order', () => {
  const cards = [{ id: 'a', sort: 0 }, { id: 'b', sort: 1 }, { id: 'c', sort: 2 }]
  const sort = moveTo(cards, 'c', 0)!
  assert.ok(sort < 0, 'to the top: below the first')
  const after = [...cards.map(c => (c.id === 'c' ? { ...c, sort } : c))].sort((x, y) => x.sort - y.sort)
  assert.deepEqual(after.map(c => c.id), ['c', 'a', 'b'])
  // Into the middle, and nothing else moves.
  const mid = moveTo(after, 'c', 1)!
  assert.equal(mid, sortBetween(0, 1))
  assert.deepEqual([...after.map(c => (c.id === 'c' ? { ...c, sort: mid } : c))].sort((x, y) => x.sort - y.sort).map(c => c.id), ['a', 'c', 'b'])
  // Dropping a card where it already is changes nothing.
  assert.equal(moveTo(cards, 'a', 0), null)
  assert.equal(moveTo(cards, 'zzz', 0), null)
})
