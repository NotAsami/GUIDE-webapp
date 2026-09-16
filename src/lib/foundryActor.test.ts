// Run: node --test src/lib/foundryActor.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, EquippedItem } from './database.types.ts'
import { toFoundryActor } from './foundryActor.ts'

function character(over: Partial<CharacterRow>): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'Cornelius',
    identity: {}, sheet: {}, resources: {}, inventory: [], equipped: {},
    shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
    ...over,
  } as CharacterRow
}

const cloak: EquippedItem = { id: 'i1', name: 'Cloak of Protection', slot: 'cloak', effects: { ac: 1 } }

const SHEET = {
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
  hp: { current: 41, max: 52, temp: 3 },
  ac: 15, speed: 30,
  hitDice: { current: 7, max: 7, die: 'd10' },
  senses: { darkvision: 60 },
}

const subject = () => character({
  sheet: SHEET,
  identity: { class: 'Fighter', level: 7 },
  equipped: { cloak },
})

test('the actor mirrors the DERIVED sheet, not the authored one', () => {
  const a = toFoundryActor(subject()) as any
  // 15 authored + 1 from the worn cloak. Reading character.sheet.ac gives 15.
  assert.equal(a.system.attributes.ac.flat, 16)
  assert.equal(a.system.attributes.ac.calc, 'flat')
  assert.equal(a.system.attributes.hp.value, 41)
  assert.equal(a.system.attributes.hp.max, 52)
  assert.equal(a.system.attributes.hp.temp, 3)
  assert.equal(a.system.abilities.str.value, 14)
  assert.equal(a.system.attributes.senses.darkvision, 60)
  assert.equal(a.system.attributes.movement.walk, 30)
})

/* THE CLASS ITEM IS WHAT MAKES THE ACTOR A LEVEL. dnd5e derives character level
   and proficiency bonus from class items; export none and the token is level 0
   with PB +2 and every Foundry-side roll is quietly wrong. */
test('a class item carries the level and the hit die', () => {
  const a = toFoundryActor(subject()) as any
  assert.equal(a.items.length, 1)
  assert.equal(a.items[0].type, 'class')
  assert.equal(a.items[0].name, 'Fighter')
  assert.equal(a.items[0].system.levels, 7)
  assert.equal(a.items[0].system.hd.denomination, 'd10')
})

/* THE POOL IS SPENT-COUNTED, NOT SIZE-COUNTED. dnd5e derives the TOTAL from
   class levels and shows `available/total`, so a character who has burned hit
   dice reads as untouched unless `spent` travels with them. */
test('spent hit dice travel, clamped to the level', () => {
  const burned = character({
    identity: { class: 'Fighter', level: 7 },
    sheet: { ...SHEET, hitDice: { current: 5, max: 7, die: 'd10' } },
  })
  assert.equal((toFoundryActor(burned) as any).items[0].system.hd.spent, 2)

  // Untouched pool.
  assert.equal((toFoundryActor(subject()) as any).items[0].system.hd.spent, 0)

  /* The codex's own hitDice.max can disagree with the level (Cornelius: level 3,
     max 5). Foundry's total is the level, so an unclamped spend would show a
     negative pool. */
  const over = character({
    identity: { class: 'Warlock', level: 3 },
    sheet: { ...SHEET, hitDice: { current: 0, max: 5, die: 'd8' } },
  })
  assert.equal((toFoundryActor(over) as any).items[0].system.hd.spent, 3)
})

test('a character with no class or level still exports a usable level-1 actor', () => {
  const a = toFoundryActor(character({ sheet: { abilities: SHEET.abilities } })) as any
  assert.equal(a.items[0].system.levels, 1)
  assert.equal(a.items[0].name, 'Adventurer')
  assert.equal(a.items[0].system.hd.denomination, 'd8')
  assert.equal(a.system.attributes.hp.value, 0)
})

test('the token is linked and friendly, and named for the character', () => {
  const a = toFoundryActor(subject()) as any
  assert.equal(a.name, 'Cornelius')
  assert.equal(a.type, 'character')
  assert.equal(a.prototypeToken.name, 'Cornelius')
  assert.equal(a.prototypeToken.actorLink, true)
  assert.equal(a.prototypeToken.disposition, 1)
})

/* ---------- the weapons on the token ----------
 *
 * Display only: the sheet says what the character is holding, and the codex
 * stays the only thing that knows what a swing is worth. */

const SANCTITY = {
  id: 'w1', name: 'Sanctity', damageDice: '1d8', ability: 'str', type: 'Slashing',
  tags: ['arbiter', 'martial', 'relic'],
} as never
const SHORTBOW = {
  id: 'w2', name: 'Shortbow', damageDice: '1d6', ability: 'dex', type: 'Piercing', ranged: true,
} as never

const armed = () => character({
  sheet: SHEET,
  identity: { class: 'Fighter', level: 7 },
  equipped: { weapons: [SANCTITY, SHORTBOW] },
})

test('an equipped weapon crosses as a dnd5e weapon item', () => {
  const weapons = (toFoundryActor(armed()) as any).items.filter((i: any) => i.type === 'weapon')
  assert.equal(weapons.length, 2)

  const sanctity = weapons[0]
  assert.equal(sanctity.name, 'Sanctity')
  // Martial from the tag, melee because it is not ranged.
  assert.equal(sanctity.system.type.value, 'martialM')
  // `denomination` is the number of SIDES, not the count.
  assert.deepEqual(sanctity.system.damage.base, { number: 1, denomination: 8, types: ['slashing'] })
  assert.equal(sanctity.system.equipped, true)

  // Untagged and ranged: simple, and the R kind.
  assert.equal(weapons[1].system.type.value, 'simpleR')
})

test('a magic weapon carries its bonus, a plain one carries no key at all', () => {
  const magic = character({
    sheet: SHEET,
    equipped: { weapons: [{ ...SANCTITY, effects: { attack: 2, damage: 2 } }] },
  })
  assert.equal((toFoundryActor(magic) as any).items[1].system.magicalBonus, '2')
  assert.equal((toFoundryActor(armed()) as any).items[1].system.magicalBonus, undefined)
})

test('a weapon with no parseable dice still crosses, without inventing damage', () => {
  const odd = character({ sheet: SHEET, equipped: { weapons: [{ ...SANCTITY, damageDice: 'special' }] } })
  const item = (toFoundryActor(odd) as any).items[1]
  assert.equal(item.name, 'Sanctity')
  assert.equal(item.system.damage, undefined)
})

/* THE FLAG IS WHAT MAKES THE SYNC SAFE. The bridge updates and deletes only
   what it made; a potion the DM dropped on the actor by hand is not its
   business. */
test('everything the exporter creates is flagged as the bridge’s own', () => {
  const items = (toFoundryActor(armed()) as any).items
  for (const item of items) assert.equal(item.flags['guide-bridge'].managed, true, item.name)
})

test('the description says not to roll it here', () => {
  const item = (toFoundryActor(armed()) as any).items[1]
  assert.match(item.system.description.value, /Roll it there/)
})
