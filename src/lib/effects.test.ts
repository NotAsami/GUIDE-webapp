// Run: node --test src/lib/effects.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, EquippedItem, ShardTree } from './database.types.ts'
import { activeSources, carryMultiplier, effectiveSheet, gearFeatures } from './effects.ts'

function character(over: Partial<CharacterRow>): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'Test',
    identity: {}, sheet: {}, resources: {}, inventory: [], equipped: {},
    shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
    ...over,
  } as CharacterRow
}

const BASE = {
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
  hp: { current: 52, max: 52 },
  ac: 15, speed: 30, initiative: 1,
  senses: { darkvision: 0 },
}

const cloak: EquippedItem = { id: 'i1', name: 'Cloak of Protection', slot: 'cloak', effects: { ac: 1, saves: 1 } }
const belt: EquippedItem = { id: 'i2', name: 'Belt of Giant Strength', slot: 'neck', effects: { abilitySet: { str: 21 } } }

const tree: ShardTree = {
  id: 'sh1', name: 'Testing Shard', rarity: 'common', module: 'm', icon: 'fa-gem',
  capacity: 10, published: true,
  baseMods: { maxHp: 5 },
  branches: { core: 'Core' },
  nodes: [
    { id: 'core', name: 'Core', tier: 0, branch: 'core', angle: 0, cost: 0, icon: 'fa-gem', prereqs: [], effect: '' },
    { id: 'might', name: 'Might', tier: 1, branch: 'core', angle: 0, cost: 1, icon: 'fa-gem', prereqs: ['core'], effect: '', mods: { abilities: { str: 2 }, darkvision: 60 } },
  ],
}
const trees = { sh1: tree }

// --- the numbers, across all three fx groups -------------------------------

test('effectiveSheet layers worn gear, applied effects and slotted shards together', () => {
  const c = character({
    sheet: BASE,
    equipped: { cloak, neck: belt },
    resources: { activeEffects: [{ id: 'e1', name: 'Bless', effects: { ac: 2, speed: 10 } }] },
    shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core', 'might'] } },
  })
  const view = effectiveSheet(c, trees)

  assert.equal(view.abilities!.str, 23) // max(14, set 21) + 2 from the node
  assert.equal(view.abilities!.dex, 12) // untouched
  assert.equal(view.ac, 18) // 15 + 1 cloak + 2 bless
  assert.equal(view.speed, 40) // 30 + 10 bless, no encumbrance at STR 23
  assert.equal(view.hp!.max, 57) // 52 + 5 shard baseMods
  assert.equal(view.senses!.darkvision, 60)
  assert.equal(view.saveBonuses!.str, 1) // cloak's `saves: 1` applies to every ability
  assert.equal(view.saveBonuses!.cha, 1)
})

test('the base sheet is never mutated — the effective view is derived only', () => {
  const sheet = { ...BASE }
  const c = character({ sheet, equipped: { cloak } })
  effectiveSheet(c, trees)
  assert.equal(sheet.ac, 15)
  assert.equal(c.sheet.ac, 15)
})

// --- the correctness gate: per-attack effects are not passive ---------------

test('an equipped WEAPON contributes features but never its effects', () => {
  const sword = { id: 'w1', name: 'Flame Tongue', hand: 'main', effects: { attack: 1, damage: 2, ac: 99 }, features: [{ id: 'f1', name: 'Ignite' }] }
  const c = character({ sheet: BASE, equipped: { weapons: [sword] } })

  // The weapon's own bonuses stay per-attack (lib/weapons.ts reads them directly).
  assert.equal(effectiveSheet(c, trees).ac, 15)
  // ...but the feature it grants is active.
  assert.deepEqual(gearFeatures(c).map(f => f.name), ['Ignite'])
  assert.equal(activeSources(c, trees).find(s => s.kind === 'weapon')?.fx, undefined)
})

test('the guide shard contributes features but never its effects', () => {
  const guide = { id: 'g1', name: 'G.U.I.D.E. Shard', effects: { ac: 99 }, features: [{ id: 'f2', name: 'Uplink' }] }
  const c = character({ sheet: BASE, equipped: { guideShard: guide } })

  assert.equal(effectiveSheet(c, trees).ac, 15)
  assert.deepEqual(gearFeatures(c).map(f => f.name), ['Uplink'])
})

// --- scoping ----------------------------------------------------------------

test('an unequipped item contributes neither itself nor its features', () => {
  const carried = { ...cloak, features: [{ id: 'f3', name: 'Ward' }] }
  const c = character({ sheet: BASE, inventory: [carried], equipped: {} })

  assert.equal(effectiveSheet(c, trees).ac, 15)
  assert.equal(gearFeatures(c).length, 0)
  assert.equal(activeSources(c, trees).length, 0)
})

test('a slotted shard grants base mods; a node contributes only once attuned', () => {
  const slotted = character({ sheet: BASE, shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core'] } } })
  assert.equal(effectiveSheet(slotted, trees).abilities!.str, 14)
  assert.equal(effectiveSheet(slotted, trees).hp!.max, 57) // baseMods apply on slot

  const attuned = character({ sheet: BASE, shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core', 'might'] } } })
  assert.equal(effectiveSheet(attuned, trees).abilities!.str, 16)
})

test('a shard with no catalog entry degrades to no bonus instead of throwing', () => {
  const c = character({ sheet: BASE, shards: { slot1: { shardId: 'missing', earned: 5, attuned: ['core'] } } })
  assert.equal(effectiveSheet(c, {}).abilities!.str, 14)
  assert.equal(activeSources(c, {}).length, 0)
})

// --- order (§30: first declaration wins on a variable-name collision) -------

test('activeSources returns sheet features → gear → shards → spells, then the rest', () => {
  const c = character({
    sheet: { ...BASE, features: [{ id: 'sf1', name: 'Second Wind' }] },
    equipped: { cloak: { ...cloak, features: [{ id: 'gf1', name: 'Ward' }] }, weapons: [{ id: 'w1', name: 'Axe' }] },
    shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core', 'might'] } },
    spellbook: { spells: [{ id: 'sp1', name: 'Bless', level: 1 }] },
    resources: { activeEffects: [{ id: 'e1', name: 'Bless', effects: { ac: 2 } }] },
  })
  assert.deepEqual(activeSources(c, trees).map(s => s.kind), [
    'feature', // sheet.features
    'feature', // gear
    'shard', 'shardnode', 'shardnode',
    'spell',
    'weapon',
    'item', // worn gear
    'effect',
  ])
})

// --- carryMultiplier shares the same list ----------------------------------

test('carryMultiplier takes the largest granted value, never the product', () => {
  const doubler = { id: 'p1', name: 'Powerful Build', effects: { carryMult: 2 } }
  const c = character({
    sheet: BASE,
    resources: { activeEffects: [{ ...doubler, effects: { carryMult: 2 } }, { id: 'p2', name: 'Also', effects: { carryMult: 2 } }] },
  })
  assert.equal(carryMultiplier(c, trees), 2)
})
