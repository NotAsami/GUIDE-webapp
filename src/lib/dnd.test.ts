// Run: node --test src/lib/dnd.test.ts
//
// These exist because of a real bug: the breakdown shown to the player and the
// total added to the roll were computed separately, so splitting the save bonus
// into its own named term made the breakdown say "+1 MISC" while the total
// ignored it. The roll was one lower than the sheet said it should be.
//
// The invariant that would have caught it, and the one these pin, is the
// obvious one: THE NAMED PARTS MUST SUM TO THE NUMBER THE SHEET SHOWS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AbilityKey, CharacterSheet } from './database.types.ts'
import { SKILLS } from './dnd.ts'
import {
  abilityCheckTerms, composeCheck, effectiveMode, saveTerms, saveTotal,
  skillTerms, skillTotal, sumTerms, usesProficiency,
} from './dnd.ts'

/** STR 16 (+3), DEX 14 (+2). Proficient in STR saves, +1 elsewhere from gear. */
const SHEET: CharacterSheet = {
  abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 13, cha: 8 },
  proficiencyBonus: 4,
  saveProficiencies: ['str'],
  saveBonuses: { str: 1, dex: 2 },
  skillProficiencies: ['athletics'],
  skillExpertise: ['stealth'],
  skillBonuses: { athletics: 1 },
} as CharacterSheet

const skill = (key: string) => SKILLS.find(s => s.key === key)!

test('save terms sum to saveTotal, for every ability', () => {
  // The exact failure: STR is proficient AND carries a +1, so the two used to be
  // folded into one PROF label. Split apart, the sum must not change.
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[]) {
    assert.equal(sumTerms(saveTerms(SHEET, key)), saveTotal(SHEET, key), `save mismatch on ${key}`)
  }
  // Pin the shape too, so a relabel does not quietly become a re-sum.
  assert.deepEqual(saveTerms(SHEET, 'str'), [
    { label: 'STR', value: 3 }, { label: 'PROF', value: 4, prof: true }, { label: 'MISC', value: 1 },
  ])
  // Not proficient, but still carries gear: PROF is 0 and MISC survives.
  assert.deepEqual(saveTerms(SHEET, 'dex'), [
    { label: 'DEX', value: 2 }, { label: 'PROF', value: 0, prof: true }, { label: 'MISC', value: 2 },
  ])
})

test('skill terms sum to skillTotal, including expertise', () => {
  for (const s of SKILLS) {
    assert.equal(sumTerms(skillTerms(SHEET, s)), skillTotal(SHEET, s).mod, `skill mismatch on ${s.key}`)
  }
  assert.equal(skillTerms(SHEET, skill('stealth'))[1].label, 'PROF x2')
  assert.equal(skillTerms(SHEET, skill('stealth'))[1].value, 8)
})

test('an ability check gets the modifier and nothing else', () => {
  // Proficiency does not apply to a raw ability check, however proficient the
  // save is — STR is proficient above and must not leak in here.
  assert.deepEqual(abilityCheckTerms(SHEET, 'str'), [{ label: 'STR', value: 3 }])
})

test('the total and the breakdown cannot disagree — they come from one list', () => {
  const terms = [
    { label: 'STR', value: 3 }, { label: 'PROF', value: 4 },
    { label: 'MISC', value: 1 }, { label: 'FEAT', value: 0 },
  ]
  const { total, breakdown } = composeCheck(14, terms)
  assert.equal(total, 22)
  // A zero term is hidden but still summed — the display filters, the sum does
  // not, which is exactly the asymmetry that used to be a bug.
  assert.equal(breakdown, '14 +3 STR +4 PROF +1 MISC')
  assert.equal(total, 14 + sumTerms(terms))
})

test('crit reads the threshold; a natural 1 is a fumble however low it goes', () => {
  assert.equal(composeCheck(20, []).crit, true)
  assert.equal(composeCheck(19, []).crit, false)
  assert.equal(composeCheck(19, [], 19).crit, true)
  const nat1 = composeCheck(1, [], 19)
  assert.equal(nat1.fumble, true)
  assert.equal(nat1.crit, false)
})

test('a feature and the player asking for advantage are one request, and cancel', () => {
  assert.equal(effectiveMode('normal', true, false), 'adv')
  assert.equal(effectiveMode('normal', false, true), 'dis')
  assert.equal(effectiveMode('adv', false, false), 'adv')
  // The player asked for disadvantage; a feature grants advantage on all saves.
  // One of each cancels — the engine adds a voice, it never overrides.
  assert.equal(effectiveMode('dis', true, false), 'normal')
  assert.equal(effectiveMode('adv', false, true), 'normal')
  assert.equal(effectiveMode('normal', true, true), 'normal')
})

test('usesProficiency reads the roll, not the character', () => {
  // Jack of All Trades' exact question. A PROF term worth zero is what a
  // non-proficient save looks like, and counting it would say every save in the
  // game already uses proficiency — silently switching the feature off forever.
  assert.equal(usesProficiency(saveTerms(SHEET, 'str')), true)   // proficient
  assert.equal(usesProficiency(saveTerms(SHEET, 'dex')), false)  // PROF term, value 0
  assert.equal(usesProficiency(skillTerms(SHEET, skill('stealth'))), true)  // expertise counts
  assert.equal(usesProficiency(abilityCheckTerms(SHEET, 'str')), false)     // no PROF term at all
  // Every skill agrees with skillTotal's own answer — one rule, two readers.
  for (const s of SKILLS) {
    assert.equal(usesProficiency(skillTerms(SHEET, s)), skillTotal(SHEET, s).proficient, s.key)
  }
})
