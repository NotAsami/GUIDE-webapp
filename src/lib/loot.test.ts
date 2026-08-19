// Run: node --test src/lib/loot.test.ts
//
// A loot roll is the easiest thing in this app to get wrong invisibly. Every
// wrong answer looks like luck: an off-by-one that makes the top of a range
// unreachable, a comparison that turns 0% into "sometimes", a broken row that
// quietly yields less. So the rng is scripted and the results are exact.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItemData, LootTable } from './database.types.ts'
import { chanceOfNothing, expectedYield, rollLoot, rollQty, rowHits } from './loot.ts'

/** Hands back the given numbers in order, then throws — so a test that consumes
 *  more randomness than it scripted fails loudly instead of drifting into
 *  Math.random and becoming flaky. */
function scripted(...values: number[]) {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted after ${values.length} draws`)
    return values[i++]
  }
}

const item = (name: string, category = 'gear'): CatalogItemData =>
  ({ name, category } as CatalogItemData)

const CATALOG = new Map<string, CatalogItemData>([
  ['boots', item('Chainmail Boots', 'armor')],
  ['arrows', item('Arrows', 'ammo')],
  ['torch', item('Torch')],
])

const TABLE: LootTable = {
  name: 'Knight Corpse', icon: 'fa-skull',
  rows: [
    { kind: 'item', item_id: 'boots', min: 1, max: 1, chance: 30 },
    { kind: 'item', item_id: 'arrows', min: 1, max: 10, chance: 50 },
    { kind: 'coin', coin: 'silver', min: 2, max: 20, chance: 80 },
  ],
}

test('ROWS ROLL INDEPENDENTLY — a corpse can carry everything at once', () => {
  // The decision the whole engine turns on. These chances sum to 160%, which is
  // not a bug: each row gets its own flip. A weighted pick-one would have to
  // normalise, and "30% chance of boots" would stop meaning 30%.
  // draws: hit(.0) qty(.0) | hit(.0) qty(.999) | hit(.0) qty(.999)
  const r = rollLoot(TABLE, CATALOG, scripted(0, 0, 0, 0.999, 0, 0.999))
  assert.deepEqual(r.items.map(i => [i.data.name, i.qty]), [['Chainmail Boots', 1], ['Arrows', 10]])
  assert.equal(r.coins.silver, 20)
})

test('and can carry nothing', () => {
  // Every row missing is a legal, common outcome — an empty chest.
  const r = rollLoot(TABLE, CATALOG, scripted(0.99, 0.99, 0.99))
  assert.deepEqual(r.items, [])
  assert.deepEqual(r.coins, { gold: 0, silver: 0, copper: 0 })
  assert.equal(r.outcomes.every(o => !o.hit), true)
})

test('MISSES ARE REPORTED, not omitted — the preview shows the whole table', () => {
  // Without the misses you cannot see that a table is tuned wrong; you would
  // have to roll it twenty times and form an impression.
  const r = rollLoot(TABLE, CATALOG, scripted(0, 0, 0.99, 0, 0))
  assert.equal(r.outcomes.length, 3, 'one outcome per row, always')
  assert.deepEqual(r.outcomes.map(o => o.hit), [true, false, true])
})

test('THE RANGE INCLUDES BOTH ENDS — 1-10 has ten outcomes, not nine', () => {
  // The classic off-by-one. Without the +1 the top of every range is
  // unreachable, and nobody notices that arrows never roll 10.
  assert.equal(rollQty(1, 10, () => 0), 1, 'bottom')
  assert.equal(rollQty(1, 10, () => 0.9999), 10, 'top — reachable')
  assert.equal(rollQty(1, 10, () => 0.5), 6)
  // A fixed quantity needs no special case.
  assert.equal(rollQty(2, 2, () => 0.7), 2)
})

test('chance 0 never fires and chance 100 always does', () => {
  // The two values a DM will actually type at the ends of the dial.
  assert.equal(rowHits(0, () => 0), false, '0% must be never, even on a 0 draw')
  assert.equal(rowHits(100, () => 0.9999), true, '100% must be always')
  assert.equal(rowHits(30, () => 0.2999), true)
  assert.equal(rowHits(30, () => 0.3), false, 'the boundary belongs to the miss')
})

test('A ROW POINTING AT A DELETED ITEM IS REPORTED, not silently dropped', () => {
  // Yielding less and saying nothing is indistinguishable from bad luck, and
  // the DM is the only one who can fix a broken table.
  const broken: LootTable = { ...TABLE, rows: [{ kind: 'item', item_id: 'ghost', min: 1, max: 1, chance: 100 }] }
  const r = rollLoot(broken, CATALOG, scripted(0, 0))
  assert.deepEqual(r.missing, ['ghost'])
  assert.deepEqual(r.items, [], 'nothing to grant')
  assert.equal(r.outcomes[0].missing, true, 'and the preview says so')
})

test('THE RNG IS CONSUMED PER ROW — exactly one draw for every chance', () => {
  /* A generator consumed conditionally shifts its sequence when an unrelated
     row changes, and every test of it becomes a puzzle. Counting the draws is
     the only assertion that catches it: an earlier version of this test just
     checked the hit pattern, which a short-circuit on `chance >= 100` sailed
     straight through.

     Contract: 1 draw per row for the chance, + 1 more for each HIT's quantity. */
  let draws = 0
  const counting = (seq: number[]) => () => seq[draws++ % seq.length]

  const certain: LootTable = {
    name: 'Certain', icon: 'fa-box',
    rows: [
      { kind: 'item', item_id: 'torch', min: 1, max: 1, chance: 100 },  // always hits
      { kind: 'item', item_id: 'boots', min: 1, max: 1, chance: 0 },    // never hits
      { kind: 'coin', coin: 'gold', min: 1, max: 1, chance: 100 },      // always hits
    ],
  }
  draws = 0
  const r = rollLoot(certain, CATALOG, counting([0]))
  assert.deepEqual(r.outcomes.map(o => o.hit), [true, false, true])
  // 3 chance draws + 2 quantity draws. A short-circuit on a 100% row spends 3.
  assert.equal(draws, 5, 'one draw per row, plus one per hit')

  // And a table that misses everything spends exactly one draw per row. Note
  // this needs its OWN table: a 100%-chance row hits on any draw, so `certain`
  // above can never miss.
  const longshots: LootTable = {
    name: 'Longshots', icon: 'fa-box',
    rows: [
      { kind: 'item', item_id: 'torch', min: 1, max: 1, chance: 5 },
      { kind: 'item', item_id: 'boots', min: 1, max: 1, chance: 5 },
      { kind: 'coin', coin: 'gold', min: 1, max: 1, chance: 5 },
    ],
  }
  draws = 0
  const missed = rollLoot(longshots, CATALOG, counting([0.99]))
  assert.equal(missed.outcomes.every(o => !o.hit), true, 'all three miss')
  assert.equal(draws, 3, 'a miss costs the chance draw and nothing more')
})

test('coins aggregate per denomination and do not become items', () => {
  const t: LootTable = {
    name: 'Purse', icon: 'fa-coins',
    rows: [
      { kind: 'coin', coin: 'gold', min: 1, max: 1, chance: 100 },
      { kind: 'coin', coin: 'gold', min: 4, max: 4, chance: 100 },
      { kind: 'coin', coin: 'copper', min: 7, max: 7, chance: 100 },
    ],
  }
  const r = rollLoot(t, CATALOG, scripted(0, 0, 0, 0, 0, 0))
  assert.deepEqual(r.coins, { gold: 5, silver: 0, copper: 7 })
  assert.deepEqual(r.items, [], 'coins are not inventory')
})

test('a hit that rolls zero is shown but not granted', () => {
  // A 0-2 range is legal and "rolled a zero" is a real outcome worth seeing.
  const t: LootTable = { name: 'T', icon: 'fa-box', rows: [{ kind: 'item', item_id: 'torch', min: 0, max: 2, chance: 100 }] }
  const r = rollLoot(t, CATALOG, scripted(0, 0))
  assert.equal(r.outcomes[0].hit, true)
  assert.equal(r.outcomes[0].qty, 0)
  assert.deepEqual(r.items, [], 'nothing to write')
})

test('expected yield is what tells you a table is tuned wrong', () => {
  // 0.3*1 + 0.5*5.5 = 3.05 items, 0.8*11 = 8.8 silver.
  const e = expectedYield(TABLE)
  assert.ok(Math.abs(e.items - 3.05) < 1e-9, `items ${e.items}`)
  assert.ok(Math.abs(e.coins.silver - 8.8) < 1e-9, `silver ${e.coins.silver}`)
})

test('chance of nothing answers "why is this chest always empty"', () => {
  // Five rows at 5% look like a full table and yield nothing 77% of the time.
  const thin: LootTable = {
    name: 'Thin', icon: 'fa-box',
    rows: Array.from({ length: 5 }, () => ({ kind: 'item' as const, item_id: 'torch', min: 1, max: 1, chance: 5 })),
  }
  assert.ok(Math.abs(chanceOfNothing(thin) - 0.95 ** 5) < 1e-9)
  assert.equal(chanceOfNothing({ name: 'Sure', icon: 'x', rows: [{ kind: 'item', item_id: 'torch', min: 1, max: 1, chance: 100 }] }), 0)
})

test('an empty table rolls cleanly rather than throwing', () => {
  const r = rollLoot({ name: 'Empty', icon: 'fa-box', rows: [] }, CATALOG, scripted())
  assert.deepEqual(r.outcomes, [])
  assert.deepEqual(r.items, [])
  assert.equal(chanceOfNothing({ name: 'Empty', icon: 'x', rows: [] }), 1)
})
