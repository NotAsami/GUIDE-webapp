// Run: node --test src/lib/kit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItemData, ClassDef, EquippedGear, InventoryItem } from './database.types.ts'
import {
  grantKitItems, grantKitOption, kitChoices, kitEntriesText, kitItemsText, legacyKitText,
  openQuestions, poolKey, resolvePool, snapshotKit,
} from './kit.ts'

const item = (name: string, over: Partial<CatalogItemData> = {}): CatalogItemData =>
  ({ name, category: 'gear', w: 1, h: 1, ...over } as CatalogItemData)

const CATALOG = new Map<string, CatalogItemData>([
  ['scale_mail', item('Scale Mail', { category: 'armor' })],
  ['leather', item('Leather Armour', { category: 'armor' })],
  ['longbow', item('Longbow', { category: 'weapon' })],
  ['arrows', item('Arrows', { category: 'ammo' })],
  ['pack', item('Dungeoneer’s Pack')],
])

const cls = (startingEquipment: ClassDef['startingEquipment']): ClassDef => ({
  name: 'Arbiter', icon: 'fa-shield-halved', desc: '', hitDie: 10, primaryAbility: 'str',
  saveProficiencies: ['str', 'con'], skillChoices: [], skillChooseN: 0,
  proficiencies: {}, startingEquipment, caster: 'none',
  features: [], tags: [], vars: [], graph: [],
})

test('a multi-option group becomes a question the player is asked', () => {
  const { fixed, kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Armour', options: [
      { id: 'a', label: 'Scale mail', items: [{ item_id: 'scale_mail', qty: 1 }] },
      { id: 'b', label: 'Leather and a longbow', items: [{ item_id: 'leather', qty: 1 }, { item_id: 'arrows', qty: 20 }] },
    ],
  }]), CATALOG)
  assert.deepEqual(fixed, [])
  assert.equal(kit?.choices.length, 1)
  assert.equal(kit?.choices[0].options.length, 2)
  // Resolved to DATA, not ids — the player cannot read item_catalog.
  assert.equal(kit?.choices[0].options[0].items[0].data.name, 'Scale Mail')
})

test('a one-option group is granted outright and never reaches the player', () => {
  // A question with one answer is not a question. Pre-picking it instead left
  // its items sitting in a list that nothing ever granted.
  const { fixed, kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Pack', options: [{ id: 'a', label: 'Pack', items: [{ item_id: 'pack', qty: 1 }] }],
  }]), CATALOG)
  assert.equal(kit, null, 'nothing to ask, so nothing parks on the sheet')
  assert.deepEqual(fixed.map(f => f.data.name), ['Dungeoneer’s Pack'])
})

test('fixed and chosen groups are split, not merged', () => {
  const { fixed, kit } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Pack', options: [{ id: 'a', label: 'Pack', items: [{ item_id: 'pack', qty: 1 }] }] },
    {
      id: 'c2', label: 'Armour', options: [
        { id: 'a', label: 'Scale', items: [{ item_id: 'scale_mail', qty: 1 }] },
        { id: 'b', label: 'Leather', items: [{ item_id: 'leather', qty: 1 }] },
      ],
    },
  ]), CATALOG)
  assert.deepEqual(fixed.map(f => f.data.name), ['Dungeoneer’s Pack'])
  assert.equal(kit?.choices.length, 1)
  assert.equal(kit?.choices[0].id, 'c2')
})

test('a reference to a deleted item is dropped, and an option it empties with it', () => {
  const { fixed, kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Armour', options: [
      { id: 'a', label: 'Scale mail', items: [{ item_id: 'scale_mail', qty: 1 }] },
      { id: 'b', label: 'Ghost gear', items: [{ item_id: 'deleted_item', qty: 1 }] },
    ],
  }]), CATALOG)
  // Only one option survives, so it stops being a question and is granted.
  assert.equal(kit, null)
  assert.deepEqual(fixed.map(f => f.data.name), ['Scale Mail'])
})

test('a row still holding the old prose does not take the editor down', () => {
  // startingEquipment was free text before it was a list of choices, and JSONB
  // does not migrate itself. .map on a string is a blank screen, not an error
  // anyone can read.
  const prose = String.raw`• (a) scale mail or (b) leather armor`
  assert.deepEqual(kitChoices(prose), [])
  assert.deepEqual(kitChoices(undefined), [])
  assert.deepEqual(kitChoices(null), [])
  assert.equal(legacyKitText(prose), prose)
  assert.equal(legacyKitText([]), null)
  assert.equal(legacyKitText('   '), null)
  // and snapshotKit reads through the same guard
  const legacy = { ...cls([]), startingEquipment: prose as never }
  assert.deepEqual(snapshotKit('arbiter', legacy, CATALOG), { fixed: [], kit: null })
})

test('a class with no kit parks nothing rather than an empty prompt', () => {
  const { fixed, kit } = snapshotKit('arbiter', cls([]), CATALOG)
  assert.equal(kit, null)
  assert.deepEqual(fixed, [])
})

test('openQuestions reports only what is still unanswered', () => {
  const { kit } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'A', options: [
      { id: 'x', label: 'x', items: [{ item_id: 'scale_mail', qty: 1 }] },
      { id: 'y', label: 'y', items: [{ item_id: 'leather', qty: 1 }] }] },
    { id: 'c2', label: 'B', options: [
      { id: 'x', label: 'x', items: [{ item_id: 'longbow', qty: 1 }] },
      { id: 'y', label: 'y', items: [{ item_id: 'arrows', qty: 20 }] }] },
  ]), CATALOG)
  assert.equal(openQuestions(kit).length, 2)
  assert.equal(openQuestions({ ...kit!, picked: { c1: 'x' } }).length, 1)
  assert.equal(openQuestions({ ...kit!, picked: { c1: 'x', c2: 'y' } }).length, 0)
  assert.deepEqual(openQuestions(undefined), [])
})

// -- pools: "a martial weapon" ----------------------------------------------

const WEAPONS = new Map<string, CatalogItemData>([
  ['longsword', item('Longsword', { category: 'weapon', tags: ['martial'] })],
  ['battleaxe', item('Battleaxe', { category: 'weapon', tags: ['martial'] })],
  ['dagger', item('Dagger', { category: 'weapon', tags: ['simple'] })],
  ['shield', item('Shield', { category: 'armor' })],
])

test('resolvePool runs the DM query the same way the item index does', () => {
  assert.deepEqual(resolvePool('tag:martial', WEAPONS).map(x => x.data.name), ['Longsword', 'Battleaxe'])
  assert.deepEqual(resolvePool('dagger', WEAPONS).map(x => x.data.name), ['Dagger'])
  assert.deepEqual(resolvePool('nothing-matches-this', WEAPONS), [])
})

test('kit pools got negation for free, because the query engine is shared', () => {
  // Nothing in kit.ts changed when `!term` was added — resolvePool goes through
  // lib/catalogSearch.ts, the same parser the loot pool rows and the DM search
  // boxes use. This test exists so that stays true: give the kit its own copy of
  // the parser and this is what fails.
  const relics = new Map(WEAPONS)
  relics.set('sunblade', item('Sunblade', { category: 'weapon', tags: ['martial', 'relic'] }))

  assert.deepEqual(resolvePool('tag:martial', relics).map(x => x.data.name),
    ['Longsword', 'Battleaxe', 'Sunblade'])
  assert.deepEqual(resolvePool('tag:martial !relic', relics).map(x => x.data.name),
    ['Longsword', 'Battleaxe'])
})

test('a blank pool query resolves to nothing, never to the whole catalog', () => {
  // parseCatalogQuery treats blank as "match everything", which is right for a
  // search box and catastrophic here: it would offer the player every item in
  // the game as a starting choice.
  assert.deepEqual(resolvePool('', WEAPONS), [])
  assert.deepEqual(resolvePool('   ', WEAPONS), [])
})

test('a pool is asked only after the option holding it is chosen', () => {
  const { kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Primary weapon', options: [
      { id: 'a', label: 'A martial weapon and a shield', items: [
        { pick: 1, from: 'tag:martial', label: 'A martial weapon' },
        { item_id: 'shield', qty: 1 },
      ] },
      { id: 'b', label: 'Two martial weapons', items: [
        { pick: 2, from: 'tag:martial', label: 'Two martial weapons' },
      ] },
    ],
  }]), WEAPONS)

  const first = openQuestions(kit)
  assert.equal(first.length, 1)
  assert.equal(first[0].kind, 'option', 'never ask about a branch not yet taken')

  const q = openQuestions({ ...kit!, picked: { c1: 'a' } })
  assert.equal(q.length, 1)
  if (q[0].kind !== 'pool') throw new Error('expected a pool question')
  assert.equal(q[0].count, 1)
  assert.deepEqual(q[0].pool.map(x => x.data.name), ['Longsword', 'Battleaxe'])
})

test('a pick-2 pool stays open until both are chosen', () => {
  const { kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Weapons', options: [
      { id: 'a', label: 'One', items: [{ item_id: 'shield', qty: 1 }] },
      { id: 'b', label: 'Two martial weapons', items: [{ pick: 2, from: 'tag:martial' }] },
    ],
  }]), WEAPONS)
  const picked = { ...kit!, picked: { c1: 'b' } }
  assert.equal(openQuestions(picked).length, 1)

  const one = { ...picked, picks: { [poolKey('c1', 0)]: ['longsword'] } }
  const q = openQuestions(one)
  assert.equal(q.length, 1, 'still one pick short')
  if (q[0].kind !== 'pool') throw new Error('expected a pool question')
  assert.deepEqual(q[0].chosen, ['longsword'])

  const both = { ...picked, picks: { [poolKey('c1', 0)]: ['longsword', 'battleaxe'] } }
  assert.equal(openQuestions(both).length, 0)
})

test('choosing an option grants its plain items now and leaves its pools for later', () => {
  const gear = {} as EquippedGear
  const { kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Primary', options: [
      { id: 'a', label: 'Martial + shield', items: [
        { pick: 1, from: 'tag:martial' },
        { item_id: 'shield', qty: 1 },
      ] },
      { id: 'b', label: 'Two martial', items: [{ pick: 2, from: 'tag:martial' }] },
    ],
  }]), WEAPONS)
  const inv = grantKitOption(kit!.choices[0].options[0], gear, [] as InventoryItem[])
  assert.deepEqual(inv.map(i => i.name), ['Shield'], 'the weapon has not been picked yet')
})

test('a single option that still asks something stays a question', () => {
  // One option is normally a fixed grant. Not when it contains a pool: there is
  // still a decision inside it, so it cannot be handed over at assign.
  const { fixed, kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Weapon',
    options: [{ id: 'a', label: 'A martial weapon', items: [{ pick: 1, from: 'tag:martial' }] }],
  }]), WEAPONS)
  assert.deepEqual(fixed, [])
  assert.equal(kit?.choices.length, 1)
})

test('a pool that matches nothing is dropped, like a deleted item reference', () => {
  const { fixed, kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Weapon', options: [
      { id: 'a', label: 'Ghost pool', items: [{ pick: 1, from: 'tag:nonexistent' }] },
      { id: 'b', label: 'Shield', items: [{ item_id: 'shield', qty: 1 }] },
    ],
  }]), WEAPONS)
  // (a) resolves to nothing, so only (b) survives, and one settled option is
  // not a question.
  assert.equal(kit, null)
  assert.deepEqual(fixed.map(f => f.data.name), ['Shield'])
})

test('kitEntriesText names a pool as the question it is, never as a blank', () => {
  const { kit } = snapshotKit('arbiter', cls([{
    id: 'c1', label: 'Primary', options: [
      { id: 'a', label: 'A', items: [
        { pick: 1, from: 'tag:martial', label: 'A martial weapon' },
        { item_id: 'shield', qty: 1 },
      ] },
      { id: 'b', label: 'B', items: [{ pick: 2, from: 'tag:martial', label: 'A martial weapon' }] },
    ],
  }]), WEAPONS)
  assert.equal(kitEntriesText(kit!.choices[0].options[0].items), 'A martial weapon \u00b7 Shield')
  assert.equal(kitEntriesText(kit!.choices[0].options[1].items), 'A martial weapon \u00d72')
})

test('granting routes items one at a time, so two never land in the same cell', () => {
  const gear = {} as EquippedGear
  const { fixed } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Kit', options: [{ id: 'a', label: 'All', items: [
      { item_id: 'scale_mail', qty: 1 }, { item_id: 'longbow', qty: 1 }, { item_id: 'pack', qty: 1 },
    ] }] },
  ]), CATALOG)
  const inv = grantKitItems(fixed, gear, [] as InventoryItem[])
  assert.equal(inv.length, 3)
  const cells = inv.filter(i => i.col != null).map(i => `${i.containerId}:${i.col},${i.row}`)
  assert.equal(new Set(cells).size, cells.length, 'every placed item has its own cell')
  // Instance ids are fresh, and every row keeps its catalog back-ref.
  assert.equal(new Set(inv.map(i => i.id)).size, 3)
  assert.ok(inv.every(i => !!i.item_id))
})

test('granting appends to an existing pack rather than replacing it', () => {
  const gear = {} as EquippedGear
  const existing = [{ id: 'old', name: 'Rope', containerId: 'person', col: 1, row: 1 }] as InventoryItem[]
  const { fixed } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Kit', options: [{ id: 'a', label: 'All', items: [{ item_id: 'pack', qty: 1 }] }] },
  ]), CATALOG)
  const inv = grantKitItems(fixed, gear, existing)
  assert.equal(inv.length, 2)
  assert.ok(inv.some(i => i.id === 'old'))
})

test('a non-stackable count becomes that many rows, not one silent copy', () => {
  // "five javelins": a javelin is a weapon, so it does not stack. Granting it
  // through grantInstance with qty:5 produced ONE javelin and no error at all.
  const gear = {} as EquippedGear
  const { fixed } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Kit', options: [{ id: 'a', label: 'Javelins', items: [{ item_id: 'javelin', qty: 5 }] }] },
  ]), new Map([['javelin', item('Javelin', { category: 'weapon' })]]))
  const inv = grantKitItems(fixed, gear, [] as InventoryItem[])
  assert.equal(inv.length, 5, 'five javelins are five rows')
  assert.ok(inv.every(i => i.name === 'Javelin'))
  assert.equal(new Set(inv.map(i => i.id)).size, 5, 'each is its own instance')
})

test('a stackable count becomes one stack carrying the quantity', () => {
  const gear = {} as EquippedGear
  const { fixed } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Kit', options: [{ id: 'a', label: 'Arrows', items: [{ item_id: 'arrows', qty: 20 }] }] },
  ]), CATALOG)
  const inv = grantKitItems(fixed, gear, [] as InventoryItem[])
  assert.equal(inv.length, 1)
  assert.equal(inv[0].qty, 20)
})

test('kitItemsText is the one description both the DM and the player read', () => {
  const { fixed } = snapshotKit('arbiter', cls([
    { id: 'c1', label: 'Kit', options: [{ id: 'a', label: 'All', items: [
      { item_id: 'longbow', qty: 1 }, { item_id: 'arrows', qty: 20 },
    ] }] },
  ]), CATALOG)
  assert.equal(kitItemsText(fixed), 'Longbow · Arrows ×20')
})
