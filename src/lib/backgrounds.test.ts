// Run: node --test src/lib/backgrounds.test.ts
//
// The skill normalisation is the reason this file exists. The SRD background
// import stored DISPLAY NAMES ("Sleight of Hand") in a field the sheet keys off
// (`sleightOfHand`), so a straight copy would mark the character proficient in
// something nothing reads — no error, no fallback, just a sheet that quietly
// disagrees with the background it says it has.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BackgroundDef, CatalogFeatureData, CharacterRow } from './database.types.ts'
import { BACKGROUND_GRANT_PREFIX, assignBackground } from './backgrounds.ts'
import { RACE_GRANT_PREFIX } from './races.ts'
import { skillKey } from './dnd.ts'

const FEATURES = new Map<string, CatalogFeatureData>([
  ['f_alert', { name: 'Alert', category: 'feat' }],
  ['f_late', { name: 'Veteran Contacts', category: 'background' }],
])

const SOLDIER: BackgroundDef = {
  name: 'Soldier', icon: 'fa-shield', desc: 'You served.',
  abilityOptions: ['str', 'dex', 'con'],
  // Display names, exactly as the SRD import wrote them.
  skills: ['Athletics', 'Intimidation'],
  skillChooseN: 0,
  proficiencies: { tools: ["Gaming Set"], languages: ['Orcish'] },
  features: [{ feature_id: 'f_alert' }, { feature_id: 'f_late', when: 'level >= 5' }],
  equipment: [],
  tags: [], vars: [], graph: [],
}

function char(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', owner: 'o', name: 'Ros',
    identity: { level: 1, background: null },
    sheet: {
      abilities: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
      skillProficiencies: ['perception'],
      proficiencies: { armor: ['Light Armor'], languages: ['Common'] },
      features: [{ id: `${RACE_GRANT_PREFIX}elf`, name: 'Elf' }],
    },
    resources: {}, inventory: [], equipped: {}, spellbook: {},
    ...over,
  } as CharacterRow
}

const run = (row = char(), bg = SOLDIER) => assignBackground(row, 'soldier', bg, FEATURES)

// ── the reason this module exists ───────────────────────────────────────────

test('skillKey maps a display name, a key, and odd casing to the same key', () => {
  assert.equal(skillKey('Sleight of Hand'), 'sleightOfHand')
  assert.equal(skillKey('sleightOfHand'), 'sleightOfHand')
  assert.equal(skillKey('  INSIGHT '), 'insight')
  assert.equal(skillKey('Basket Weaving'), null)
  assert.equal(skillKey(''), null)
})

test('DISPLAY NAMES become sheet keys, not literal names', () => {
  const p = run()
  const written = p.patch.sheet?.skillProficiencies ?? []
  assert.ok(written.includes('athletics'), 'Athletics must land as `athletics`')
  assert.ok(written.includes('intimidation'))
  assert.equal(written.includes('Athletics'), false, 'a display name on the sheet is the bug')
})

test('an unrecognised skill is REPORTED, never silently dropped', () => {
  const odd: BackgroundDef = { ...SOLDIER, skills: ['Athletics', 'Basket Weaving'] }
  const p = run(char(), odd)
  assert.deepEqual(p.unknownSkills, ['Basket Weaving'])
  assert.deepEqual(p.skillsGranted, ['Athletics'])
})

test('existing skill proficiencies survive — a class pick is not clobbered', () => {
  const p = run()
  assert.ok((p.patch.sheet?.skillProficiencies ?? []).includes('perception'))
})

test('a skill the character already has is not granted twice', () => {
  const row = char({ sheet: { ...char().sheet, skillProficiencies: ['athletics'] } })
  const p = run(row)
  assert.deepEqual(p.skillsGranted, ['Intimidation'])
  assert.equal((p.patch.sheet?.skillProficiencies ?? []).filter(k => k === 'athletics').length, 1)
})

// ── grants and the prefix ───────────────────────────────────────────────────

test('an open gate is granted under the bg: prefix; a closed one is pending', () => {
  const p = run()
  assert.deepEqual(p.granted, ['Alert'])
  assert.deepEqual(p.pending.map(x => x.name), ['Veteran Contacts'])
  const ids = (p.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(ids.includes('bg:soldier'), 'the carrier')
  assert.ok(ids.includes('bg:soldier:f_alert'))
  assert.equal(ids.includes('bg:soldier:f_late'), false)
})

test('re-assigning REPLACES its own grants rather than duplicating them', () => {
  const first = run()
  const after = char({ sheet: first.patch.sheet })
  const second = assignBackground(after, 'soldier', SOLDIER, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)
  assert.equal(ids.filter(i => i === 'bg:soldier').length, 1)
  assert.equal(ids.filter(i => i === 'bg:soldier:f_alert').length, 1)
})

test('SWITCHING background clears the old one and keeps the race', () => {
  const first = run()
  const after = char({ sheet: first.patch.sheet })
  const sage: BackgroundDef = { ...SOLDIER, name: 'Sage', skills: ['Arcana'], features: [] }
  const second = assignBackground(after, 'sage', sage, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)
  assert.equal(ids.some(i => i?.startsWith('bg:soldier')), false, 'the old background must go')
  assert.ok(ids.includes('bg:sage'))
  assert.ok(ids.includes(`${RACE_GRANT_PREFIX}elf`), 'the race must survive — the prefixes are separate')
})

test('the carrier carries the vars and graph, and no ability score is written', () => {
  const bg: BackgroundDef = { ...SOLDIER, graph: [{ id: 'g1', op: 'boost', stat: 'STR', value: 2 }] as never }
  const p = run(char(), bg)
  const carrier = (p.patch.sheet?.features ?? []).find(f => f.id === 'bg:soldier')
  assert.equal(carrier?.category, 'background')
  assert.equal((carrier?.graph ?? []).length, 1, 'the boost rides the carrier')
  // abilityOptions is display-only; a written score could not be un-written.
  assert.deepEqual(p.patch.sheet?.abilities, char().sheet.abilities)
})

// ── proficiencies ───────────────────────────────────────────────────────────

test('LANGUAGES UNION while other training replaces', () => {
  const p = run()
  const profs = p.patch.sheet?.proficiencies ?? {}
  assert.deepEqual(profs.languages, ['Common', 'Orcish'], 'a race-taught language must survive')
  assert.deepEqual(profs.tools, ['Gaming Set'])
  assert.deepEqual(profs.armor, ['Light Armor'], 'a key the background never states is untouched')
})

test('identity.background is the one identity field that moves', () => {
  const row = char({ identity: { level: 3, race: 'Elf', class: 'Arbiter', background: null } })
  const id = run(row).patch.identity
  assert.equal(id?.background, 'Soldier')
  assert.equal(id?.race, 'Elf')
  assert.equal(id?.class, 'Arbiter')
  assert.equal(id?.level, 3)
})

// ── parked choices ──────────────────────────────────────────────────────────

test('no skill choice means no prompt parked', () => {
  assert.equal(run().patch.sheet?.pendingSkills, undefined)
  assert.equal(run().skillPicks, 0)
})

test('a skill choice parks a prompt', () => {
  const p = run(char(), { ...SOLDIER, skillChooseN: 2 })
  assert.equal(p.skillPicks, 2)
  assert.equal(p.patch.sheet?.pendingSkills?.count, 2)
})

test('the prefix constant is distinct from the other two assigns', () => {
  assert.equal(BACKGROUND_GRANT_PREFIX, 'bg:')
  assert.notEqual(BACKGROUND_GRANT_PREFIX, RACE_GRANT_PREFIX)
})
