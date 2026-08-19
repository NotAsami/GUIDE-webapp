// Run: node --test src/lib/classes.test.ts
//
// The slot rows below are TRANSCRIBED FROM THE PRINTED SRD TABLES, not from
// casterSlots. That is the whole point: half and third casters are the full
// table read at ceil(L/2) and ceil(L/3), and the only way to know that identity
// holds is to check it against the tables it claims to reproduce.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogFeatureData, CharacterRow, ClassDef } from './database.types.ts'
import {
  CLASS_GRANT_PREFIX, assignClass, casterCap, casterSlots, casterSummary, castingNumbers,
  assignSubclass, castingRules, gateLevel, gateOpen, hitDieAverage, hitPointRules, hpForLevel,
  snapshotPaths, subclassGrants,
} from './classes.ts'

test('full caster slots match the printed table at every checked level', () => {
  assert.deepEqual(casterSlots('full', 1), [2, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('full', 5), [4, 3, 2, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('full', 11), [4, 3, 3, 3, 2, 1, 0, 0, 0])
  assert.deepEqual(casterSlots('full', 17), [4, 3, 3, 3, 2, 1, 1, 1, 1])
  assert.deepEqual(casterSlots('full', 20), [4, 3, 3, 3, 3, 2, 2, 1, 1])
})

test('half casters read the full table at ceil(L/2), and get nothing at level 1', () => {
  // A Paladin has no slots at all until 2nd level. ceil(1/2) is 1, so without
  // the FIRST_SLOT_AT floor this would hand out two 1st-level slots.
  assert.deepEqual(casterSlots('half', 1), [0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('half', 2), [2, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('half', 5), [4, 2, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('half', 9), [4, 3, 2, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('half', 11), [4, 3, 3, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('half', 20), [4, 3, 3, 3, 2, 0, 0, 0, 0])
})

test('third casters read the full table at ceil(L/3), and get nothing before level 3', () => {
  assert.deepEqual(casterSlots('third', 2), [0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('third', 3), [2, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('third', 7), [4, 2, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('third', 13), [4, 3, 2, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('third', 20), [4, 3, 3, 1, 0, 0, 0, 0, 0])
})

test('pact and non-casters never produce a slot ladder', () => {
  // Pact slots are one level and a count (lib/spells.ts), not nine numbers.
  // Folding them in here is exactly the crippled-slot-table the design rejects.
  assert.deepEqual(casterSlots('pact', 9), [0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(casterSlots('none', 20), [0, 0, 0, 0, 0, 0, 0, 0, 0])
})

test('casterSlots clamps past 20 rather than reading off the end of the table', () => {
  assert.deepEqual(casterSlots('full', 25), casterSlots('full', 20))
  assert.deepEqual(casterSlots('half', 40), casterSlots('half', 20))
})

test('casterCap names the ceiling and when it is reached', () => {
  assert.deepEqual(casterCap('full'), { level: 9, at: 17 })
  assert.deepEqual(casterCap('half'), { level: 5, at: 17 })
  assert.deepEqual(casterCap('third'), { level: 4, at: 19 })
  assert.equal(casterCap('none'), null)
})

test('casterSummary carries the whole shape, so the fold can stay closed', () => {
  // Short enough for the fold header, which truncates rather than wraps — and
  // it must not repeat the caster type, which the select above it already says.
  const s = casterSummary('full')
  assert.match(s, /First slot L1/)
  assert.match(s, /9th-level from L17/)
  assert.match(s, /22 at cap/)
  assert.ok(!/Full caster/.test(s), 'the select above already names the type')
  assert.ok(s.length <= 52, `summary is ${s.length} chars — the header truncates past ~52`)
  assert.ok(casterSummary('half').length <= 52)
  assert.ok(casterSummary('third').length <= 52)
  assert.ok(casterSummary('pact').length <= 52)
  assert.match(casterSummary('none'), /No spellcasting/)
})

test('gateLevel reads the level floor that groups the feature list', () => {
  assert.equal(gateLevel(undefined), 1)      // no condition = granted from the start
  assert.equal(gateLevel(''), 1)
  assert.equal(gateLevel('level >= 1'), 1)
  assert.equal(gateLevel('level>=3'), 3)
  assert.equal(gateLevel('level >= 11 && isRaging'), 11)
  assert.equal(gateLevel('level > 4'), 5)     // strictly greater floors one higher
  assert.equal(gateLevel('level == 6'), 6)
  assert.equal(gateLevel('level === 6'), 6)
})

test('gateLevel refuses anything it cannot read, rather than guessing', () => {
  // A negation inverts the meaning of the number inside it, so the number is not
  // the floor. Mis-sorting a row is worse than leaving it unsorted.
  assert.equal(gateLevel('!(level >= 3)'), null)
  assert.equal(gateLevel('isChampion'), null)
  assert.equal(gateLevel('prof >= 4'), null)
  assert.equal(gateLevel('shardsHeld > 2'), null)
})

test('gateOpen treats an unreadable gate as closed, never as open', () => {
  assert.equal(gateOpen(undefined, { level: 1 }), true)
  assert.equal(gateOpen('level >= 3', { level: 5 }), true)
  assert.equal(gateOpen('level >= 3', { level: 2 }), false)
  // Not a boolean, and an undeclared identifier: both must fail closed, or
  // assigning would grant something the author never asked for.
  assert.equal(gateOpen('level + 1', { level: 5 }), false)
  assert.equal(gateOpen('nonsense && level', { level: 5 }), false)
})

// ── hit points ──────────────────────────────────────────────────────────────

test('hitDieAverage is 5e\'s own "or N" shortcut', () => {
  assert.equal(hitDieAverage(6), 4)
  assert.equal(hitDieAverage(8), 5)
  assert.equal(hitDieAverage(10), 6)
  assert.equal(hitDieAverage(12), 7)
})

test('hpForLevel: full die at 1st, the average every level after', () => {
  // d10, CON +2: 12 at level 1, then +8 a level.
  assert.equal(hpForLevel(10, 2, 1), 12)
  assert.equal(hpForLevel(10, 2, 2), 20)
  assert.equal(hpForLevel(10, 2, 7), 60)
  // A negative modifier still applies every level, including the first.
  assert.equal(hpForLevel(6, -1, 3), 5 + 3 + 3)
  // Level 0 or below cannot subtract a level's worth.
  assert.equal(hpForLevel(8, 0, 0), 8)
})

test('castingRules states the formula the class decides, not a number', () => {
  // The class owns the FORMULA; the character supplies prof and the score. The
  // editor shows this, castingNumbers computes the values at assign, and the two
  // must describe the same rule.
  assert.deepEqual(castingRules('wis'), {
    dc: '8 + proficiency bonus + WIS',
    atk: 'proficiency bonus + WIS',
  })
  // No ability chosen yet — say so rather than printing a half-formula.
  assert.match(castingRules(undefined).dc, /your casting ability/)
})

test('the stated rule and the computed numbers agree', () => {
  // int 10 (+0), prof 2 -> DC 10, atk +2, which is 8+2+0 and 2+0.
  const n = castingNumbers({ abilities: { int: 10 } }, 'int')!
  assert.equal(n.saveDC, 8 + 2 + 0)
  assert.equal(n.attackBonus, 2 + 0)
  assert.match(castingRules('int').dc, /^8 \+ proficiency bonus \+ INT$/)
})

test('hitPointRules prints the two sentences a class book prints', () => {
  const r = hitPointRules(10)
  assert.equal(r.first, '10 + your Constitution modifier')
  assert.equal(r.higher, '1d10 (or 6) + your Constitution modifier per level after 1st')
})

// ── assignClass ─────────────────────────────────────────────────────────────

const FEAT = (name: string): CatalogFeatureData => ({ name, published: true } as CatalogFeatureData)

const ARBITER: ClassDef = {
  name: 'Arbiter', icon: 'fa-shield-halved', desc: 'A sworn adjudicator.',
  hitDie: 10, primaryAbility: 'str', saveProficiencies: ['str', 'con'],
  skillChoices: ['athletics', 'insight'], skillChooseN: 2,
  proficiencies: { armor: ['All armor', 'Shields'], weapons: ['Simple', 'Martial'] },
  startingEquipment: 'Chain mail, a martial weapon, a shield.',
  caster: 'none', features: [
    { feature_id: 'second_wind', when: 'level >= 1' },
    { feature_id: 'action_surge', when: 'level >= 2' },
    { feature_id: 'improved_crit', when: 'level >= 15' },
  ],
  tags: ['arbiter'], vars: [{ name: 'mercy', kind: 'stored', type: 'num', initial: 3 }], graph: [],
  published: true,
}

const FEATURES = new Map<string, CatalogFeatureData>([
  ['second_wind', FEAT('Second Wind')],
  ['action_surge', FEAT('Action Surge')],
  ['improved_crit', FEAT('Improved Critical')],
])

function char(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', user_id: 'u1', name: 'Test', identity: { level: 3 },
    sheet: { hp: { current: 20, max: 20 }, abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 } },
    ...over,
  } as CharacterRow
}

test('assignClass grants only the features whose gate is open at this level', () => {
  const r = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.deepEqual(r.granted, ['Second Wind', 'Action Surge'])
  assert.deepEqual(r.pending, [{ name: 'Improved Critical', when: 'level >= 15' }])
})

test('assignClass writes what the class decides and leaves the rest alone', () => {
  const r = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.equal(r.patch.identity?.class, 'Arbiter')
  assert.equal(r.patch.sheet?.hitDice?.die, 'd10')
  assert.deepEqual(r.patch.sheet?.saveProficiencies, ['str', 'con'])
  assert.deepEqual(r.patch.sheet?.proficiencies?.armor, ['All armor', 'Shields'])
  // The player picks their two skills; assigning a class must never pick for them.
  assert.equal(r.patch.sheet?.skillProficiencies, undefined)
  // Ability scores are untouched — the class says nothing about them.
  assert.deepEqual(r.patch.sheet?.abilities, char().sheet?.abilities)
})

test('the carrier feature is what makes a class variable reach the engine', () => {
  const r = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const carrier = r.patch.sheet?.features?.find(f => f.id === `${CLASS_GRANT_PREFIX}arbiter`)
  assert.ok(carrier, 'a class must put its vars and graph somewhere activeSources looks')
  assert.deepEqual(carrier?.vars, ARBITER.vars)
  assert.equal(carrier?.category, 'class')
})

test('re-assigning replaces the class grants instead of duplicating them', () => {
  const first = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const after = char({ sheet: { ...char().sheet, features: first.patch.sheet?.features } })
  const second = assignClass(after, 'arbiter', ARBITER, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate feature ids')
  assert.equal(ids.filter(i => i === `${CLASS_GRANT_PREFIX}arbiter`).length, 1)
})

test('switching class clears the previous class grants but keeps everything else', () => {
  const first = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const withFeat = [...(first.patch.sheet?.features ?? []), { id: 'racial-1', name: 'Darkvision' }]
  const after = char({ sheet: { ...char().sheet, features: withFeat } })

  const OTHER: ClassDef = { ...ARBITER, name: 'Cantor', hitDie: 6, caster: 'full', castingAbility: 'int', features: [] }
  const second = assignClass(after, 'cantor', OTHER, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)

  assert.ok(ids.includes('racial-1'), 'a non-class feature must survive a class change')
  assert.ok(!ids.some(i => i?.startsWith(`${CLASS_GRANT_PREFIX}arbiter`)), 'the old class must be gone')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}cantor`))
})

test('a caster class seeds the slot ladder; a martial class only clears the flag', () => {
  const martial = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.equal(martial.patch.spellbook?.spellcasting, false)
  assert.equal(martial.patch.spellbook?.slots, undefined, 'a martial class must not blank an existing ladder')

  const CANTOR: ClassDef = { ...ARBITER, name: 'Cantor', caster: 'full', castingAbility: 'int' }
  const caster = assignClass(char(), 'cantor', CANTOR, FEATURES)
  assert.equal(caster.patch.spellbook?.spellcasting, true)
  assert.equal(caster.patch.spellbook?.ability, 'int')
  assert.deepEqual(caster.patch.spellbook?.slots?.map(s => s.total), casterSlots('full', 3))
})

test('castingNumbers answers the two spellcasting numbers from the class ability', () => {
  // str 16 dex 12 con 14 int 10 wis 10 cha 10; proficiencyBonus defaults to 2.
  assert.deepEqual(castingNumbers({ abilities: { str: 16, int: 10 } }, 'str'), { saveDC: 13, attackBonus: 5 })
  assert.deepEqual(castingNumbers({ abilities: { int: 10 } }, 'int'), { saveDC: 10, attackBonus: 2 })
  assert.deepEqual(castingNumbers({ abilities: { cha: 18 }, proficiencyBonus: 3 }, 'cha'), { saveDC: 15, attackBonus: 7 })
})

test('castingNumbers refuses to guess rather than seeding a wrong number', () => {
  // 8 + prof + abilityMod(0) is -1, which looks like an answer. A sheet with no
  // scores has to produce nothing at all.
  assert.equal(castingNumbers({}, 'int'), null)
  assert.equal(castingNumbers({ abilities: { int: 14 } }, undefined), null)
  assert.equal(castingNumbers({ abilities: { int: 14 } }, 'cha'), null)
})

test('assigning a caster class seeds the save DC and the spell attack bonus', () => {
  const CANTOR: ClassDef = { ...ARBITER, name: 'Cantor', caster: 'full', castingAbility: 'int' }
  const r = assignClass(char(), 'cantor', CANTOR, FEATURES)
  // int 10 -> mod 0, prof 2.
  assert.equal(r.patch.spellbook?.saveDC, 10)
  assert.equal(r.patch.spellbook?.attackBonus, 2)
})

test('a martial class never touches the spellcasting numbers', () => {
  const c = char({ spellbook: { saveDC: 15, attackBonus: 7 } })
  const r = assignClass(c, 'arbiter', ARBITER, FEATURES)
  assert.equal(r.patch.spellbook?.saveDC, 15)
  assert.equal(r.patch.spellbook?.attackBonus, 7)
})

test('a pact class sets the flag and never writes a ladder', () => {
  const WARLOCK: ClassDef = { ...ARBITER, name: 'Pactbound', caster: 'pact', castingAbility: 'cha' }
  const r = assignClass(char(), 'pactbound', WARLOCK, FEATURES)
  assert.equal(r.patch.spellbook?.pactMagic, true)
  assert.equal(r.patch.spellbook?.slots, undefined)
})

test('expended slots survive a re-assign, clamped to the new total', () => {
  // A level-3 full caster holds 4/2 — so a 3rd-level slot the character used to
  // have is gone, and the spend recorded against it must not outlive it.
  const CANTOR: ClassDef = { ...ARBITER, name: 'Cantor', caster: 'full', castingAbility: 'int' }
  const c = char({ spellbook: { slots: [
    { level: 1, total: 4, expended: 3 },
    { level: 2, total: 3, expended: 2 },
    { level: 3, total: 2, expended: 1 },
  ] } })
  const r = assignClass(c, 'cantor', CANTOR, FEATURES)
  const slots = r.patch.spellbook?.slots ?? []
  assert.deepEqual(slots.slice(0, 3).map(s => s.total), [4, 2, 0])
  assert.equal(slots[0].expended, 3)          // 4 total, 3 spent still fits
  assert.equal(slots[1].expended, 2)          // 2 total, 2 spent still fits
  assert.equal(slots[2].expended, 0)          // the slot is gone, so the spend is too
  assert.ok(slots.every(s => s.expended <= s.total))
})

test('assign seeds HP on a sheet that has none', () => {
  // char() is level 3 with con 14 (+2) and no hp.max. d10 -> 12 + 2*8 = 28.
  const c = char({ sheet: { abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 } } })
  const r = assignClass(c, 'arbiter', ARBITER, FEATURES)
  assert.equal(r.hpFromClass, 28)
  assert.equal(r.hpSeeded, true)
  assert.equal(r.patch.sheet?.hp?.max, 28)
  assert.equal(r.patch.sheet?.hp?.current, 28)
})

test('assign NEVER overwrites HP a character already has', () => {
  // The seeded party is levelled and its HP was rolled, not averaged. Silently
  // recomputing it from the average throws that away — the whole reason this
  // is gated rather than always written.
  const r = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.equal(r.hpSeeded, false)
  assert.equal(r.patch.sheet?.hp?.max, 20, 'the sheet keeps its own number')
  assert.equal(r.hpFromClass, 28, 'but the console can still report what the class implies')
})

test('assign reports no HP suggestion at all without ability scores', () => {
  const c = char({ sheet: {} })
  const r = assignClass(c, 'arbiter', ARBITER, FEATURES)
  assert.equal(r.hpFromClass, null)
  assert.equal(r.hpSeeded, false)
})

test('hit dice track the character level and keep the class die', () => {
  const r = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.deepEqual(r.patch.sheet?.hitDice, { current: 3, max: 3, die: 'd10' })
})

// -- subclasses -------------------------------------------------------------

const EK: ClassDef = {
  ...ARBITER, name: 'Eldritch Knight', parent: 'arbiter',
  // The whole reason a path is a row: it changes the caster type of a class
  // that is not a caster.
  caster: 'third', castingAbility: 'int',
  features: [{ feature_id: 'improved_crit', when: 'level >= 1' }],
}

test('a path attaches WITHOUT wiping the class that offered it', () => {
  // Both clear their prior grants by id prefix. If a path cleared everything
  // under `cls:` the way a class assign does, picking one would delete the
  // class — which is the bug this prefix scheme exists to prevent.
  const base = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const withClass = char({ sheet: { ...char().sheet, ...base.patch.sheet } })

  const r = assignSubclass(withClass, 'ek', EK, FEATURES)
  const ids = (r.patch.sheet?.features ?? []).map(f => f.id)

  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}arbiter`), 'the class carrier survives')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}arbiter:second_wind`), 'and its granted features')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}ek`), 'and the path is on')
  assert.equal(r.patch.identity?.archetype, 'Eldritch Knight')
})

test('re-picking a path replaces only its own grants', () => {
  const base = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const c1 = char({ sheet: { ...char().sheet, ...base.patch.sheet } })
  const first = assignSubclass(c1, 'ek', EK, FEATURES)
  const c2 = char({ sheet: { ...char().sheet, ...first.patch.sheet } })

  const second = assignSubclass(c2, 'ek', EK, FEATURES)
  const ids = (second.patch.sheet?.features ?? []).map(f => f.id)
  assert.equal(new Set(ids).size, ids.length, 'no duplicates')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}arbiter`), 'the class is still there')
})

test('changing CLASS throws the path away too', () => {
  // A path belongs to its parent. Keeping an Eldritch Knight on a character who
  // is no longer that class would leave a carrier nothing owns.
  const base = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  const c1 = char({ sheet: { ...char().sheet, ...base.patch.sheet } })
  const withPath = assignSubclass(c1, 'ek', EK, FEATURES)
  const c2 = char({ sheet: { ...char().sheet, ...withPath.patch.sheet } })

  const OTHER: ClassDef = { ...ARBITER, name: 'Cantor' }
  const swapped = assignClass(c2, 'cantor', OTHER, FEATURES)
  const ids = (swapped.patch.sheet?.features ?? []).map(f => f.id)
  assert.ok(!ids.includes(`${CLASS_GRANT_PREFIX}ek`), 'the old path is gone')
  assert.ok(!ids.includes(`${CLASS_GRANT_PREFIX}arbiter`), 'and so is the old class')
  assert.ok(ids.includes(`${CLASS_GRANT_PREFIX}cantor`))
})

test('a casting path makes a martial class a caster', () => {
  const base = assignClass(char(), 'arbiter', ARBITER, FEATURES)
  assert.equal(base.patch.spellbook?.spellcasting, false, 'the class alone is martial')
  const c1 = char({ sheet: { ...char().sheet, ...base.patch.sheet }, spellbook: base.patch.spellbook })

  const r = assignSubclass(c1, 'ek', EK, FEATURES)
  assert.equal(r.patch.spellbook?.spellcasting, true)
  assert.equal(r.patch.spellbook?.ability, 'int')
  // Third caster at level 3 -> the full table read at ceil(3/3) = row 1.
  assert.deepEqual(r.patch.spellbook?.slots?.map(x => x.total), casterSlots('third', 3))
})

test('a non-casting path leaves the spellbook exactly as it was', () => {
  const champion: ClassDef = { ...EK, name: 'Champion', caster: 'none', castingAbility: undefined }
  const c = char({ spellbook: { spellcasting: true, saveDC: 15 } })
  const r = assignSubclass(c, 'champ', champion, FEATURES)
  assert.equal(r.patch.spellbook, undefined, 'no spellbook write at all')
})

test('a path never carries the class kit or its hit points', () => {
  const r = assignSubclass(char(), 'ek', EK, FEATURES)
  assert.equal(r.kitChoices, 0)
  assert.equal(r.kitGranted, 0)
  assert.equal(r.hpSeeded, false)
  assert.equal(r.patch.sheet?.hitDice, undefined, 'the die is the parent class\'s answer')
})

// -- the parked path choice -------------------------------------------------

const PATHS = [{ id: 'ek', data: EK }]
const OFFERS: ClassDef = { ...ARBITER, subclassLevel: 3, subclassLabel: 'Arbiter Path' }

test('assigning a class parks its paths for the player', () => {
  const r = assignClass(char(), 'arbiter', OFFERS, FEATURES, new Map(), {}, PATHS)
  const p = r.patch.sheet?.pendingPath
  assert.ok(p, 'the choice is parked')
  assert.equal(p!.label, 'Arbiter Path')
  assert.equal(p!.level, 3)
  assert.equal(p!.options.length, 1)
  assert.equal(p!.options[0].name, 'Eldritch Knight')
})

test('a parked option carries RESOLVED features, not references', () => {
  // class_catalog has no player policy, so a reference would render as an empty
  // list on the one screen that has to show it.
  const r = assignClass(char(), 'arbiter', OFFERS, FEATURES, new Map(), {}, PATHS)
  const op = r.patch.sheet!.pendingPath!.options[0]
  assert.ok(op.features.length >= 1, 'the carrier at least')
  assert.ok(op.features.every(f => typeof f.name === 'string' && f.name.length > 0))
  // And its caster profile, since a path can make a martial class a caster.
  assert.equal(op.spellbook?.spellcasting, true)
})

test('a path is parked BELOW its level too, so it can surface later', () => {
  // The character is level 3 here; park it for a level-1 character as well, or
  // reaching level 3 would need a level-up hook to notice.
  const low = char({ identity: { level: 1 } })
  const r = assignClass(low, 'arbiter', OFFERS, FEATURES, new Map(), {}, PATHS)
  assert.ok(r.patch.sheet?.pendingPath, 'parked even though they cannot take it yet')
  assert.equal(r.patch.sheet!.pendingPath!.level, 3)
})

test('a class with no paths, or that offers none, parks nothing', () => {
  // A prompt with an empty list is worse than no prompt.
  assert.equal(assignClass(char(), 'arbiter', OFFERS, FEATURES, new Map(), {}, []).patch.sheet?.pendingPath, undefined)
  assert.equal(assignClass(char(), 'arbiter', ARBITER, FEATURES, new Map(), {}, PATHS).patch.sheet?.pendingPath, undefined)
  assert.equal(snapshotPaths(char(), ARBITER, 'arbiter', PATHS, FEATURES), null)
})

test('subclassGrants is the one producer both paths of the code use', () => {
  // assignSubclass writes it directly; snapshotPaths bakes it into the prompt.
  // Two copies of "what does this path grant" would drift the first time a path
  // gained anything.
  const direct = assignSubclass(char(), 'ek', EK, FEATURES)
  const parked = snapshotPaths(char(), OFFERS, 'arbiter', PATHS, FEATURES)!.options[0]
  const g = subclassGrants(char(), 'ek', EK, FEATURES)
  assert.deepEqual(parked.features, g.features)
  assert.deepEqual(direct.patch.sheet!.features!.slice(0, g.features.length), g.features)
})

test('a reference to a feature that is not in the catalog is skipped, not crashed on', () => {
  const GHOST: ClassDef = { ...ARBITER, features: [{ feature_id: 'deleted_feature' }] }
  const r = assignClass(char(), 'arbiter', GHOST, FEATURES)
  assert.deepEqual(r.granted, [])
  assert.equal((r.patch.sheet?.features ?? []).length, 1, 'only the carrier')
})
