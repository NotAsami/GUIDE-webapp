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
