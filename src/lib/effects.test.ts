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

// --- armour class ----------------------------------------------------------

/** BASE without an authored `ac`, so the derivation is the answer. DEX 12 = +1. */
const BARE = { ...BASE, ac: undefined }
const armour = (over: Partial<EquippedItem>): EquippedItem =>
  ({ id: 'a1', name: 'Armour', slot: 'armor', ...over }) as EquippedItem
const unarmoredRule = (base: number, ability?: string, id = 'f-ud'): Feature => ({
  id, name: 'Unarmored Defense',
  graph: [{ id: 'g1', op: 'unarmored', label: 'Unarmored Defense', value: String(base), ...(ability ? { ability } : {}) }],
})

test('with nothing worn, AC is ten plus Dexterity', () => {
  assert.equal(effectiveSheet(character({ sheet: BARE })).ac, 11)
})

test('armour REPLACES the base, and the Dex cap is why baseAc alone was not enough', () => {
  // A Breastplate is "14 + Dex (max 2)"; a bare 14 silently becomes a flat 14.
  const dexy = { ...BARE, abilities: { ...BASE.abilities, dex: 18 } } // +4
  const brs = { armor: armour({ name: 'Breastplate', baseAc: 14, acAddDex: true, acDexCap: 2 }) }
  assert.equal(effectiveSheet(character({ sheet: dexy, equipped: brs })).ac, 16, 'capped at +2')
  // Light armour: no cap.
  const leather = { armor: armour({ name: 'Leather', baseAc: 11, acAddDex: true }) }
  assert.equal(effectiveSheet(character({ sheet: dexy, equipped: leather })).ac, 15)
  // Heavy: no Dex at all, however nimble.
  const plate = { armor: armour({ name: 'Chain Mail', baseAc: 16 }) }
  assert.equal(effectiveSheet(character({ sheet: dexy, equipped: plate })).ac, 16)
})

test('an unarmored rule competes with armour rather than stacking', () => {
  // 10 + 1 DEX + 1 CON (13) = 12.
  const c = character({ sheet: { ...BARE, features: [unarmoredRule(10, 'CON')] } })
  assert.equal(effectiveSheet(c).ac, 12)
  // Put armour on and the rule switches itself off — no `when` needed, because
  // the sheet layer can see the slot.
  const armoured = character({
    sheet: { ...BARE, features: [unarmoredRule(10, 'CON')] },
    equipped: { armor: armour({ name: 'Chain Mail', baseAc: 16 }) },
  })
  assert.equal(effectiveSheet(armoured).ac, 16, 'armour, not 16 + the rule')
})

test('A SHIELD IS NOT ARMOUR, though it shares the slot', () => {
  /* Its `baseAc` is a BONUS where armour's replaces. Unflagged it would read as
     armour twice over: AC 2, and Unarmored Defense switched off — which the
     printed rule is explicit you keep while holding one. */
  const withShield = character({
    sheet: { ...BARE, features: [unarmoredRule(10, 'CON')] },
    equipped: { armor: armour({ name: 'Shield', baseAc: 2, isShield: true }) },
  })
  assert.equal(effectiveSheet(withShield).ac, 14, '10 + 1 DEX + 1 CON + 2 shield')
  const bd = effectiveSheet(withShield).acBreakdown!
  // Every modifier named: "10 Unarmored Defense + 1 DEX + 1 CON + 2 Shield".
  assert.equal(bd.base, 10)
  assert.equal(bd.source, 'Unarmored Defense')
  assert.deepEqual(bd.bonuses, [{ label: 'CON', value: 1 }, { label: 'Shield', value: 2 }])
})

test('a magic shield is ONE line, enchantment included', () => {
  /* A Shield (+2) gives 2 as a shield and 2 more as magic. Listed apart they
     printed the same item name twice with no way to tell which was which. */
  const c = character({
    sheet: BARE,
    equipped: { armor: armour({ id: 'sh', name: 'Shield (+2)', baseAc: 2, isShield: true, effects: { ac: 2 } }) },
  })
  const view = effectiveSheet(c)
  assert.equal(view.ac, 15, '10 + 1 DEX + 2 shield + 2 magic')
  assert.deepEqual(view.acBreakdown!.bonuses, [{ label: 'Shield (+2)', value: 4 }])
})

test('two unarmored rules take the BETTER, because 5e says you pick one', () => {
  const dexy = { ...BARE, abilities: { ...BASE.abilities, dex: 12, con: 20, wis: 11 } }
  const c = character({ sheet: { ...dexy, features: [
    unarmoredRule(10, 'CON'),                    // 10 + 1 + 5 = 16
    unarmoredRule(13, undefined, 'f-drac'),      // 13 + 1     = 14
  ] } })
  assert.equal(effectiveSheet(c).ac, 16)
})

test('the breakdown is the working, with Dex kept as its own term', () => {
  const c = character({
    sheet: BARE,
    equipped: { armor: armour({ name: 'Chain Shirt', baseAc: 13, acAddDex: true, acDexCap: 2 }), cloak },
  })
  const view = effectiveSheet(c)
  assert.equal(view.ac, 15, '13 + 1 DEX + 1 cloak')
  assert.deepEqual(view.acBreakdown, {
    // ONE LINE PER SOURCE, named: a lumped "+1 Effects" is a number the player
    // cannot check against anything.
    base: 13, source: 'Chain Shirt', dex: true, bonuses: [{ label: 'Cloak of Protection', value: 1 }],
  })
})

test('an authored ac overrides the BASE and keeps the magic bonuses', () => {
  /* Eating them too would silently lower every character wearing a Cloak of
     Protection — and the old arithmetic was exactly base + Σ effects.ac, so a
     sheet with `ac` set has to keep the number it has always shown. */
  const c = character({
    sheet: { ...BASE, ac: 15 },
    equipped: { cloak, armor: armour({ name: 'Chain Mail', baseAc: 16 }) },
  })
  assert.equal(effectiveSheet(c).ac, 16, '15 typed + 1 cloak, and the armour is ignored')
  assert.equal(effectiveSheet(c).acBreakdown!.source, undefined, 'nothing to name — the DM typed it')
})

// --- extra attacks ---------------------------------------------------------

const extraAttack = (n = 1, id = 'f-xa'): Feature => ({
  id, name: 'Extra Attack',
  graph: [{ id: 'g1', op: 'boost', label: 'Extra Attack', stat: 'Extra Attacks', value: String(n) }],
})

test('everyone gets ONE attack, and Extra Attack grants the extra', () => {
  // The base is the floor rather than the whole answer: a grant of 1 means one
  // EXTRA, so taking the feature away has to give the attack back.
  assert.equal(effectiveSheet(character({ sheet: BASE })).attacksPerAction, 1)
  assert.equal(effectiveSheet(character({ sheet: { ...BASE, features: [extraAttack()] } })).attacksPerAction, 2)
})

test('extra attacks SUM, across features and worn gear alike', () => {
  const c = character({
    sheet: { ...BASE, features: [extraAttack(), extraAttack(1, 'f-other')] },
    equipped: { neck: { id: 'i8', name: 'Band of Blows', slot: 'neck', effects: { extraAttacks: 1 } } },
  })
  assert.equal(effectiveSheet(c).attacksPerAction, 4, '1 base + 1 + 1 + 1')
  // …and unequipping takes one back, which is the whole reason it layers.
  assert.equal(effectiveSheet(character({ sheet: { ...BASE, features: [extraAttack(), extraAttack(1, 'f-other')] } })).attacksPerAction, 3)
})

test('an authored base is respected, not overwritten', () => {
  // `speed` has a base for the same reason: a character who simply starts with
  // two attacks is expressible without inventing a feature to carry it.
  const c = character({ sheet: { ...BASE, attacksPerAction: 2, features: [extraAttack()] } })
  assert.equal(effectiveSheet(c).attacksPerAction, 3)
})

// --- "to a maximum of" -----------------------------------------------------

/** Primal Champion: +4 STR and CON, to a maximum of 25. */
const champion = (cap = '25'): Feature => ({
  id: 'f-pc', name: 'Primal Champion',
  graph: [
    { id: 'g1', op: 'boost', label: 'Strength', stat: 'STR', value: '4', cap },
    { id: 'g2', op: 'boost', label: 'Constitution', stat: 'CON', value: '4', cap },
  ],
})

test('a capped boost stops at the ceiling instead of running past it', () => {
  const high = { ...BASE, abilities: { ...BASE.abilities, str: 22, con: 13 } }
  const view = effectiveSheet(character({ sheet: { ...high, features: [champion()] } }))
  assert.equal(view.abilities!.str, 25, '22 + 4 = 26, clamped to 25')
  assert.equal(view.abilities!.con, 17, 'under the ceiling, so untouched')
})

test('a cap NEVER lowers a score that was already past it', () => {
  // "To a maximum of 25" limits the increase, not the character. A Belt setting
  // STR to 27 must survive standing next to Primal Champion.
  const c = character({
    sheet: { ...BASE, features: [champion()] },
    equipped: { neck: { id: 'i9', name: 'Belt', slot: 'neck', effects: { abilitySet: { str: 27 } } } },
  })
  assert.equal(effectiveSheet(c).abilities!.str, 27)
})

test('the LOWEST cap wins — two ceilings both have to hold', () => {
  const c = character({ sheet: {
    ...BASE, abilities: { ...BASE.abilities, str: 20 },
    features: [champion('25'), { ...champion('22'), id: 'f-other' }],
  } })
  // 20 + 4 + 4 = 28; the tighter ceiling is the one that applies.
  assert.equal(effectiveSheet(c).abilities!.str, 22)
})

test('no cap authored leaves the old behaviour exactly as it was', () => {
  const c = character({ sheet: { ...BASE, abilities: { ...BASE.abilities, str: 22 }, features: [champion('')] } })
  assert.equal(effectiveSheet(c).abilities!.str, 26)
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

/* ---------- `use ability` authored on the ITEM ----------
   It was authorable in the item editor's Rules block and reached nothing: a
   weapon carried no fx at all, and worn gear carried only its compiled numeric
   `effects`. A DM who put "may use WIS" on a soul-bound blade got no WIS. */

const wisBlade = {
  id: 'w1', name: 'Sanctity', category: 'weapon' as const, hand: 'main' as const,
  ability: 'str' as const, damageDice: '1d8',
  graph: [{ id: 'g1', op: 'useability', ability: 'wis' }],
} as unknown as Parameters<typeof effectiveSheet>[0]['equipped'] extends never ? never : any

test('a weapon can grant use-ability from its own graph', () => {
  const c = character({
    sheet: { ...BASE, abilities: { ...BASE.abilities, wis: 20, str: 10 } },
    equipped: { weapons: [wisBlade] },
  } as Partial<CharacterRow>)
  assert.deepEqual(effectiveSheet(c).attackAbilities, ['wis'])
})

test('...and a weapon still cannot push a NUMBER onto the sheet', () => {
  // The reason the weapon source was fx-less to begin with: a magic sword's
  // to-hit must never become +1 AC. The narrowed type is what enforces it, and
  // this pins the behaviour so a future widening has to break a test.
  const plusOne = {
    id: 'w2', name: 'Sword +1', category: 'weapon', hand: 'main',
    effects: { ac: 5, saves: 5 },
    // A boost IN THE GRAPH, which is the thing that must not cross over: items
    // already reach numbers through `effects`, and a second path would be the
    // one-value-two-routes defect again.
    graph: [
      { id: 'g1', op: 'useability', ability: 'wis' },
      { id: 'g2', op: 'boost', stat: 'DEX', value: 6 },
    ],
  } as unknown as typeof wisBlade
  const c = character({ sheet: { ...BASE }, equipped: { weapons: [plusOne] } } as Partial<CharacterRow>)
  const eff = effectiveSheet(c)
  assert.equal(eff.ac, BASE.ac, 'a weapon must not move AC')
  assert.equal(eff.abilities?.dex, BASE.abilities.dex, 'nor an ability score, via a graph boost')
  assert.deepEqual(eff.attackAbilities, ['wis'], 'but the permission still lands')
})

test('worn gear grants it too, without gaining a second numeric path', () => {
  const amulet = {
    id: 'i9', name: 'Amulet of Judgement', slot: 'neck',
    effects: { ac: 1 },
    graph: [{ id: 'g1', op: 'useability', ability: 'cha' }],
  } as unknown as EquippedItem
  const c = character({ sheet: { ...BASE }, equipped: { neck: amulet } } as Partial<CharacterRow>)
  const eff = effectiveSheet(c)
  assert.deepEqual(eff.attackAbilities, ['cha'])
  assert.equal(eff.ac, BASE.ac + 1, 'its compiled effects still apply exactly once')
})
