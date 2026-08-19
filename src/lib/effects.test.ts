// Run: node --test src/lib/effects.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, EquippedItem, ShardTree, Feature } from './database.types.ts'
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

/* A FEATURE CAN GRANT A FLAT NUMBER.
   Races and classes reach the sheet as a carrier feature (lib/classes.ts
   assignClass), so a racial +2 DEX / 60ft darkvision has nowhere else to live.
   Features used to be pushed into activeSources with no `fx` at all, which made
   every number a feature granted silently inert. */

const elf: Feature = {
  id: 'race:elf', name: 'Elf', category: 'racial',
  graph: [
    { id: 'b1', op: 'boost', label: 'Elven Grace', stat: 'DEX', value: '2' },
    { id: 'b2', op: 'boost', label: 'Fleet of Foot', stat: 'Speed', value: '5' },
    { id: 'b3', op: 'boost', label: 'Darkvision', stat: 'Darkvision', value: '60' },
  ],
}

test('a feature grants flat numbers the same way a worn item does', () => {
  const c = character({ sheet: { ...BASE, features: [elf] } })
  const view = effectiveSheet(c)
  assert.equal(view.abilities!.dex, 14, '12 base + 2 from the race')
  assert.equal(view.speed, 35)
  assert.equal(view.senses!.darkvision, 60)
})

test('removing the feature takes its numbers with it', () => {
  // The whole reason this layers instead of being written into sheet.abilities:
  // changing race has to give the points back, and be seen to.
  const withRace = effectiveSheet(character({ sheet: { ...BASE, features: [elf] } }))
  const without = effectiveSheet(character({ sheet: BASE }))
  assert.equal(withRace.abilities!.dex, 14)
  assert.equal(without.abilities!.dex, 12)
  assert.equal(without.senses!.darkvision, 0)
})

test('a feature with no boosts contributes nothing, as before', () => {
  const prose: Feature = { id: 'f1', name: 'Second Wind' }
  const view = effectiveSheet(character({ sheet: { ...BASE, features: [prose] } }))
  assert.equal(view.abilities!.dex, 12)
  assert.equal(view.ac, 15)
})

test('feature numbers stack with gear and shards rather than replacing them', () => {
  const c = character({
    sheet: { ...BASE, features: [elf] },
    equipped: { cloak },
    shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core', 'might'] } },
  })
  const view = effectiveSheet(c, trees)
  assert.equal(view.abilities!.dex, 14, 'race +2')
  assert.equal(view.abilities!.str, 16, 'base 14 + 2 from the shard node')
  assert.equal(view.ac, 16, '15 + 1 cloak')
  // Both the race and the shard node grant darkvision; the larger wins.
  assert.equal(view.senses!.darkvision, 60)
})

test('activeSources compiles a feature\'s boost ops into its effects', () => {
  const src = activeSources(character({ sheet: { ...BASE, features: [elf] } }))
  const found = src.find(x => x.kind === 'feature' && x.obj.id === 'race:elf')
  assert.ok(found, 'the feature is a source')
  assert.deepEqual(found!.fx, { abilities: { dex: 2 }, speed: 5, darkvision: 60 })
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
    spellbook: { spells: [{ id: 'sp1', name: 'Bless', level: 1, prepared: true }] },
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

test('effective HP is clamped on READ, and the stored value survives', () => {
  // Losing a +maxHp source leaves `current` above the new ceiling. The sheet must
  // not show 52/40 — and must not fix it by writing, or re-equipping could never
  // give the hit points back.
  const withShard = character({
    sheet: { hp: { current: 52, max: 40 } },
    equipped: { cloak: { id: 'i1', name: 'Vitality Cloak', slot: 'cloak', effects: { maxHp: 12 } } },
  })
  const worn = effectiveSheet(withShard)
  assert.equal(worn.hp?.max, 52)
  assert.equal(worn.hp?.current, 52)   // at the ceiling, untouched

  const bare = effectiveSheet(character({ sheet: { hp: { current: 52, max: 40 } } }))
  assert.equal(bare.hp?.max, 40)
  assert.equal(bare.hp?.current, 40)   // clamped for display…
  // …and the row underneath is unchanged, so re-equipping restores the 52.
  assert.equal(withShard.sheet?.hp?.current, 52)
})

test('only READY spells are active sources — and a Warlock owns no unready ones', () => {
  // An unprepared spell is not a thing you are carrying. But `prepared` is
  // meaningless for a known-style caster, so reading it directly would silence
  // every spell a Warlock owns — the exact trap isPrepared() exists for.
  const spells = [
    { id: 'a', name: 'Cantrip', level: 0 },
    { id: 'b', name: 'Readied', level: 1, prepared: true },
    { id: 'c', name: 'Known only', level: 1, prepared: false },
  ]
  const kinds = (sb: object) =>
    activeSources(character({ spellbook: { ...sb, spells } }))
      .filter(s => s.kind === 'spell').map(s => s.obj.name)

  // A prepared-style caster: the cantrip and the readied spell, not the third.
  assert.deepEqual(kinds({ preparesSpells: true }), ['Cantrip', 'Readied'])
  // A Warlock prepares nothing — every spell they own is ready.
  assert.deepEqual(kinds({ pactMagic: true }), ['Cantrip', 'Readied', 'Known only'])
  // …as is any explicitly known-style caster.
  assert.deepEqual(kinds({ preparesSpells: false }), ['Cantrip', 'Readied', 'Known only'])
})

test('a concealed, unrevealed node contributes nothing — even to the DM', () => {
  // On a player's client this is already true: a concealed node arrives as bare
  // geometry. The check exists for the DM, whose copy has the secrets merged —
  // without it the console simulates contributions the player cannot have.
  const node = { id: 'core', name: 'Core', concealed: true, mods: { ac: 2 } }
  const trees = { sh1: { id: 'sh1', name: 'S', nodes: [node] } } as never
  const c = (revealed?: object) => character({
    shards: { slot1: { shardId: 'sh1', attuned: ['core'], ...(revealed ? { revealed } : {}) } },
  })
  const nodes = (ch: ReturnType<typeof c>) =>
    activeSources(ch, trees).filter(s => s.kind === 'shardnode').length

  assert.equal(nodes(c()), 0)
  // Revealed by the DM, it counts again.
  assert.equal(nodes(c({ core: { name: 'Core', effect: 'x' } })), 1)
  // An unconcealed node never needed revealing.
  const plain = { sh1: { id: 'sh1', name: 'S', nodes: [{ ...node, concealed: false }] } } as never
  assert.equal(activeSources(c(), plain).filter(s => s.kind === 'shardnode').length, 1)
})

/* ---------- item-granted skill proficiency & expertise ---------- */

test('an equipped item can grant skill proficiency, unioned with the character’s own', () => {
  // UNION, never replace. A ring that grants Stealth must not take away the
  // Perception a class gave you — that would be a silent loss of a proficiency
  // nobody touched.
  const c = character({
    sheet: { skillProficiencies: ['perception'] },
    equipped: { cloak: ({ id: 'g1', name: 'Ring of Shadows', slot: 'cloak', effects: { skillProficiencies: ['stealth'] } } as EquippedItem) },
  })
  const view = effectiveSheet(c)
  assert.deepEqual([...(view.skillProficiencies ?? [])].sort(), ['perception', 'stealth'])
})

test('granted expertise implies proficiency', () => {
  // lib/dnd.ts scores `expertise ? 2 : proficient ? 1 : 0`, so expertise without
  // proficiency would be a coherent-looking state that doubles nothing.
  const c = character({ equipped: { cloak: ({ id: 'g2', name: 'Cloak of Elvenkind', slot: 'cloak', effects: { skillExpertise: ['stealth'] } } as EquippedItem) } })
  const view = effectiveSheet(c)
  assert.ok((view.skillProficiencies ?? []).includes('stealth'))
  assert.ok((view.skillExpertise ?? []).includes('stealth'))
})

test('unequipping takes the granted proficiency back', () => {
  // It is a grant, not a write to the sheet.
  const c = character({ sheet: { skillProficiencies: ['perception'] }, equipped: {} })
  assert.deepEqual(effectiveSheet(c).skillProficiencies, ['perception'])
})

test('two items granting different skills grant both', () => {
  const c = character({
    equipped: {
      cloak: ({ id: 'g1', name: 'Ring of Shadows', slot: 'cloak', effects: { skillProficiencies: ['stealth'] } } as EquippedItem),
      neck: ({ id: 'g3', name: 'Gauntlets', slot: 'neck', effects: { skillProficiencies: ['athletics'] } } as EquippedItem),
    },
  })
  assert.deepEqual([...(effectiveSheet(c).skillProficiencies ?? [])].sort(), ['athletics', 'stealth'])
})
