// Run: node --test src/lib/weaponRoll.test.ts
//
// The swing, now that it is shared: the Equipment button and a Foundry hotbar
// macro both come through here, so anything that differs between them differs
// because of this file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, EquippedWeapon, InventoryItem } from './database.types.ts'
import { buildContext } from './graph.ts'
import { ammoStacksFor, rollWeapon } from './weaponRoll.ts'

const SHEET = {
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 3,
}

const SWORD = { id: 'w1', name: 'Longsword', damageDice: '1d8', ability: 'str', type: 'Slashing', hand: 'main' } as EquippedWeapon
const BOW = { id: 'w2', name: 'Shortbow', damageDice: '1d6', ability: 'dex', type: 'Piercing', hand: 'main', ranged: true } as EquippedWeapon

const ARROWS = { id: 'a1', name: 'Arrows', category: 'ammo', containerId: 'person', qty: 3 } as unknown as InventoryItem
const LAST_ARROW = { ...ARROWS, qty: 1 }

function character(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'T', identity: { level: 5 },
    sheet: SHEET, resources: {}, inventory: [], equipped: {},
    shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
    ...over,
  } as unknown as CharacterRow
}

/** Pin every die: [face, sides] in the order the roller asks for them. */
function pin<T>(faces: [number, number][], fn: () => T): T {
  const real = Math.random
  const q = [...faces]
  Math.random = () => {
    const next = q.shift()
    if (!next) throw new Error('pin(): ran out of dice')
    return (next[0] - 1) / next[1] + 1e-9
  }
  try { return fn() } finally { Math.random = real }
}

const swing = (c: CharacterRow, weapon: EquippedWeapon, ammo: InventoryItem | null = null) =>
  rollWeapon({ character: c, weapon, sheet: c.sheet!, graph: buildContext(c), ammo, target: null })

test('a swing logs a weapon roll and reports what it spent', () => {
  const c = character()
  const out = pin([[14, 20], [3, 20], [5, 8]], () => swing(c, SWORD))
  assert.equal(out.rolled, true)
  assert.equal(out.entry.kind, 'weapon')
  assert.equal(out.entry.title, 'Longsword')
  assert.equal(out.entry.attack?.total, 14 + 3 /* STR */ + 3 /* PROF */)
  assert.deepEqual(out.arms, [])
  // A melee swing moves no inventory at all.
  assert.equal(out.inventory, undefined)
})

/* A BOW WITH AN EMPTY QUIVER HAS NOTHING TO LOOSE. It still logs — the player
   pressed something and is owed an answer — but it rolls no dice and spends
   nothing, so the caller writes nothing either. */
test('a ranged weapon with no ammunition refuses instead of rolling', () => {
  const out = swing(character(), BOW, null)
  assert.equal(out.rolled, false)
  assert.equal(out.entry.subtitle, 'No ammunition')
  assert.equal(out.entry.attack, undefined)
  assert.deepEqual(out.arms, [])
  assert.equal(out.inventory, undefined)
})

test('a shot spends one arrow, and the last one leaves the stack behind', () => {
  const many = character({ inventory: [ARROWS] })
  const out = pin([[14, 20], [3, 20], [4, 6]], () => swing(many, BOW, ARROWS))
  assert.equal(out.rolled, true)
  assert.deepEqual(out.inventory, [{ ...ARROWS, qty: 2 }])
  assert.equal(out.entry.subtitle, 'Main Hand · Arrows')

  const one = character({ inventory: [LAST_ARROW] })
  const last = pin([[14, 20], [3, 20], [4, 6]], () => swing(one, BOW, LAST_ARROW))
  assert.deepEqual(last.inventory, [], 'an empty stack is gone, not a zero')
})

/* THE HOTBAR DRAWS FROM THE SAME QUIVER THE SCREEN DOES. It was derived inside
   Equipment, so a remote swing would have had to guess at it. */
test('ammoStacksFor reads the quiver first, then what is loose on the person', () => {
  const c = character({
    equipped: { containers: { quiver: { id: 'q1', name: 'Quiver' } } },
    inventory: [
      { ...ARROWS, id: 'a2', name: 'In quiver', containerId: 'q1' },
      { ...ARROWS, id: 'a3', name: 'In pocket', containerId: 'person' },
      { ...ARROWS, id: 'a4', name: 'In backpack', containerId: 'bp' },
    ],
  } as Partial<CharacterRow>)
  assert.deepEqual(ammoStacksFor(c).map(a => a.name), ['In quiver', 'In pocket'])
})
