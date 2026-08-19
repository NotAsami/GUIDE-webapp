// Run: node --test src/lib/races.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogFeatureData, CharacterRow, ClassDef, RaceDef } from './database.types.ts'
import { RACE_GRANT_PREFIX, assignRace } from './races.ts'
import { CLASS_GRANT_PREFIX, assignClass } from './classes.ts'
import { effectiveSheet } from './effects.ts'

const FEAT = (name: string): CatalogFeatureData => ({ name, published: true } as CatalogFeatureData)

const FEATURES = new Map<string, CatalogFeatureData>([
  ['darkvision', FEAT('Darkvision')],
  ['fey_ancestry', FEAT('Fey Ancestry')],
  ['trance', FEAT('Trance')],
])

const ELF: RaceDef = {
  name: 'Elf', icon: 'fa-leaf', desc: 'Graceful and long-lived.',
  skillChoices: ['perception'], skillChooseN: 1,
  languages: ['Common', 'Elvish'], languageChooseN: 0,
  proficiencies: { weapons: ['Longsword', 'Shortbow'] },
  features: [
    { feature_id: 'darkvision', when: 'level >= 1' },
    { feature_id: 'fey_ancestry', when: 'level >= 1' },
    { feature_id: 'trance', when: 'level >= 5' },
  ],
  tags: ['elf'], vars: [],
  // Numbers are RULES, never fields — see migration 0017.
  graph: [
    { id: 'b1', op: 'boost', label: 'Elven Grace', stat: 'DEX', value: '2' },
    { id: 'b2', op: 'boost', label: 'Darkvision', stat: 'Darkvision', value: '60' },
  ],
  published: true,
}

const ARBITER: ClassDef = {
  name: 'Arbiter', icon: 'fa-shield-halved', desc: '',
  hitDie: 10, primaryAbility: 'str', saveProficiencies: ['str', 'con'],
  skillChoices: [], skillChooseN: 0,
  proficiencies: { armor: ['All armor'] },
  startingEquipment: [], caster: 'none',
  features: [], tags: [], vars: [], graph: [], published: true,
}

function char(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', user_id: 'u1', name: 'Test', identity: { level: 3 },
    sheet: { abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 }, hp: { current: 20, max: 20 } },
    ...over,
  } as CharacterRow
}

test('assignRace grants only the features whose gate is open at this level', () => {
  const r = assignRace(char(), 'elf', ELF, FEATURES)
  assert.deepEqual(r.granted, ['Darkvision', 'Fey Ancestry'])
  assert.deepEqual(r.pending, [{ name: 'Trance', when: 'level >= 5' }])
})

test('a race writes its name, training and languages, and nothing else', () => {
  const r = assignRace(char(), 'elf', ELF, FEATURES)
  assert.equal(r.patch.identity?.race, 'Elf')
  assert.deepEqual(r.patch.sheet?.proficiencies?.weapons, ['Longsword', 'Shortbow'])
  assert.deepEqual(r.patch.sheet?.proficiencies?.languages, ['Common', 'Elvish'])
  // The pick is the player's; assigning must never make it for them.
  assert.equal(r.patch.sheet?.skillProficiencies, undefined)
  // And the +2 DEX is NOT written into the score.
  assert.deepEqual(r.patch.sheet?.abilities, char().sheet?.abilities)
})

test('the racial +2 DEX arrives through the carrier, and leaves with it', () => {
  // The whole reason it is a boost rule and not a field: changing race gives
  // the points back, and effectiveSheet can say where they came from.
  const r = assignRace(char(), 'elf', ELF, FEATURES)
  const after = char({ sheet: { ...char().sheet, ...r.patch.sheet } })
  const view = effectiveSheet(after)
  assert.equal(view.abilities!.dex, 14, '12 base + 2 from the race')
  assert.equal(view.senses!.darkvision, 60)
  assert.equal(effectiveSheet(char()).abilities!.dex, 12, 'and the base sheet still says 12')
})

test('languages are unioned, never replaced', () => {
  // A background may have granted one before the race did.
  const c = char({ sheet: { ...char().sheet, proficiencies: { languages: ['Dwarvish'] } } })
  const r = assignRace(c, 'elf', ELF, FEATURES)
  assert.deepEqual(r.patch.sheet?.proficiencies?.languages, ['Dwarvish', 'Common', 'Elvish'])
})

test('re-assigning the same race replaces its grants instead of duplicating', () => {
  const first = assignRace(char(), 'elf', ELF, FEATURES)
  const after = char({ sheet: { ...char().sheet, features: first.patch.sheet?.features } })
  const second = assignRace(after, 'elf', ELF, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.filter(i => i === `${RACE_GRANT_PREFIX}elf`).length, 1)
})

test('A RACE AND A CLASS NEVER EAT EACH OTHER — the prefixes are separate', () => {
  // Both assigns clear their own prior grants by id prefix. Sharing one prefix
  // would make assigning a class silently delete the racial features, and on a
  // fresh character the two happen minutes apart.
  const withRace = assignRace(char(), 'elf', ELF, FEATURES)
  const c1 = char({ sheet: { ...char().sheet, ...withRace.patch.sheet } })

  const withClass = assignClass(c1, 'arbiter', ARBITER, FEATURES)
  const ids = (withClass.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}elf`), 'the race carrier survives a class assign')
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}elf:darkvision`), 'and so do its granted features')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}arbiter`))

  // And the other order.
  const c2 = char({ sheet: { ...char().sheet, ...assignClass(char(), 'arbiter', ARBITER, FEATURES).patch.sheet } })
  const raceAfter = assignRace(c2, 'elf', ELF, FEATURES)
  const ids2 = (raceAfter.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(ids2.includes(`${CLASS_GRANT_PREFIX}arbiter`), 'the class carrier survives a race assign')
  assert.ok(ids2.includes(`${RACE_GRANT_PREFIX}elf`))
})

test('a class and a race both keep their own training', () => {
  const withRace = assignRace(char(), 'elf', ELF, FEATURES)
  const c1 = char({ sheet: { ...char().sheet, ...withRace.patch.sheet } })
  const withClass = assignClass(c1, 'arbiter', ARBITER, FEATURES)
  assert.deepEqual(withClass.patch.sheet?.proficiencies?.weapons, ['Longsword', 'Shortbow'], 'race weapons kept')
  assert.deepEqual(withClass.patch.sheet?.proficiencies?.armor, ['All armor'], 'class armour added')
})

test('a race with skill choices parks them for the player', () => {
  const r = assignRace(char(), 'elf', ELF, FEATURES)
  assert.equal(r.skillPicks, 1)
  assert.equal(r.patch.sheet?.pendingSkills?.count, 1)
  assert.deepEqual(r.patch.sheet?.pendingSkills?.from, ['perception'])
})

test('a race offering no skills parks no prompt', () => {
  const plain: RaceDef = { ...ELF, skillChoices: [], skillChooseN: 0 }
  const r = assignRace(char(), 'elf', plain, FEATURES)
  assert.equal(r.skillPicks, 0)
  assert.equal(r.patch.sheet?.pendingSkills, undefined)
})

// -- subraces ---------------------------------------------------------------

const HIGH_ELF: RaceDef = {
  ...ELF, name: 'High Elf', parent: 'elf',
  languages: ['Draconic'], languageChooseN: 0,
  proficiencies: { tools: ["Calligrapher's supplies"] },
  features: [{ feature_id: 'trance', when: 'level >= 1' }],
  skillChoices: [], skillChooseN: 0,
  graph: [{ id: 'b3', op: 'boost', label: 'Elven Mind', stat: 'INT', value: '1' }],
}

test('a subrace rides in the SAME patch as its race', () => {
  // It is chosen at level 1 alongside the race, with the DM in the room — one
  // action, one write, unlike a class path taken levels later.
  const r = assignRace(char(), 'elf', ELF, FEATURES, {}, { id: 'high_elf', data: HIGH_ELF })
  assert.equal(r.patch.identity?.race, 'Elf')
  assert.equal(r.patch.identity?.subrace, 'High Elf')
  const ids = (r.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}elf`), 'the race carrier')
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}high_elf`), 'and the subrace carrier')
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}high_elf:trance`), 'and what it grants')
})

test('both sets of numbers layer, and both leave together', () => {
  const r = assignRace(char(), 'elf', ELF, FEATURES, {}, { id: 'high_elf', data: HIGH_ELF })
  // Carry the IDENTITY patch too, or the stale-subrace case below is never
  // actually exercised — the character would start with no subrace to go stale.
  const after = char({ identity: r.patch.identity, sheet: { ...char().sheet, ...r.patch.sheet } })
  assert.equal(after.identity?.subrace, 'High Elf', 'the fixture really carries one')
  const view = effectiveSheet(after)
  assert.equal(view.abilities!.dex, 14, '+2 from the race')
  assert.equal(view.abilities!.int, 11, '+1 from the subrace')

  // Re-assigning the race without a subrace clears the subrace entirely.
  const plain = assignRace(after, 'elf', ELF, FEATURES)
  assert.equal(plain.patch.identity?.subrace, undefined)
  const ids = (plain.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(!ids.includes(`${RACE_GRANT_PREFIX}high_elf`))
})

test('a subrace unions its languages and training with its parent race', () => {
  const r = assignRace(char(), 'elf', ELF, FEATURES, {}, { id: 'high_elf', data: HIGH_ELF })
  assert.deepEqual(r.patch.sheet?.proficiencies?.languages, ['Common', 'Elvish', 'Draconic'])
  assert.deepEqual(r.patch.sheet?.proficiencies?.weapons, ['Longsword', 'Shortbow'], 'race weapons kept')
  assert.deepEqual(r.patch.sheet?.proficiencies?.tools, ["Calligrapher's supplies"], 'subrace tools added')
})

test('a reference to a feature that is not in the catalog is skipped, not crashed on', () => {
  const ghost: RaceDef = { ...ELF, features: [{ feature_id: 'deleted' }] }
  const r = assignRace(char(), 'elf', ghost, FEATURES)
  assert.deepEqual(r.granted, [])
  assert.equal((r.patch.sheet?.features ?? []).length, 1, 'only the carrier')
})
