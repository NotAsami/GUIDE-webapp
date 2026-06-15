/**
 * SRD 5e rules math — pure functions. This is *rules*, not lore: it derives
 * modifiers, saving-throw totals, skill totals and passive scores from the
 * canonical ability scores. It must always compute from `sheet.abilities`,
 * never from a mockup's pre-baked numbers (those came from a different,
 * non-canon ability set — see docs §5).
 */

import type { AbilityKey, AbilityScores, CharacterSheet } from './database.types'

export const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

export const ABILITY_ABBR: Record<AbilityKey, string> = {
  str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha',
}

/** The 18 standard skills, in the column order the Stat Panel mockup uses
 *  (read top-to-bottom within each of the 3 columns). */
export type Skill = { key: string; name: string; ability: AbilityKey }

export const SKILLS: Skill[] = [
  { key: 'acrobatics',     name: 'Acrobatics',      ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana',         name: 'Arcana',          ability: 'int' },
  { key: 'athletics',      name: 'Athletics',       ability: 'str' },
  { key: 'deception',      name: 'Deception',       ability: 'cha' },
  { key: 'history',        name: 'History',         ability: 'int' },
  { key: 'insight',        name: 'Insight',         ability: 'wis' },
  { key: 'intimidation',   name: 'Intimidation',    ability: 'cha' },
  { key: 'investigation',  name: 'Investigation',   ability: 'int' },
  { key: 'medicine',       name: 'Medicine',        ability: 'wis' },
  { key: 'nature',         name: 'Nature',          ability: 'int' },
  { key: 'perception',     name: 'Perception',      ability: 'wis' },
  { key: 'performance',    name: 'Performance',     ability: 'cha' },
  { key: 'persuasion',     name: 'Persuasion',      ability: 'cha' },
  { key: 'religion',       name: 'Religion',        ability: 'int' },
  { key: 'sleightOfHand',  name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth',        name: 'Stealth',         ability: 'dex' },
  { key: 'survival',       name: 'Survival',        ability: 'wis' },
]

/** D&D ability modifier: floor((score - 10) / 2). */
export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2)
}

/** "+3" / "+0" / "−1" — always signed, with a real minus glyph. */
export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `−${Math.abs(mod)}`
}

const ZERO_SCORES: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }

export function abilities(sheet: CharacterSheet): AbilityScores {
  return sheet.abilities ?? ZERO_SCORES
}

export function proficiency(sheet: CharacterSheet): number {
  return sheet.proficiencyBonus ?? 2
}

/** Saving-throw total for one ability = mod + (proficiency if proficient) + flat
 *  bonuses (authored or layered in from gear effects via effectiveSheet). */
export function saveTotal(sheet: CharacterSheet, key: AbilityKey): number {
  const mod = abilityMod(abilities(sheet)[key])
  const prof = (sheet.saveProficiencies ?? []).includes(key) ? proficiency(sheet) : 0
  const bonus = sheet.saveBonuses?.[key] ?? 0
  return mod + prof + bonus
}

export type SkillTotal = {
  skill: Skill
  mod: number
  proficient: boolean
  expertise: boolean
}

/** Skill total = ability mod + (proficiency × {0 | 1 | 2 for expertise}). */
export function skillTotal(sheet: CharacterSheet, skill: Skill): SkillTotal {
  const proficient = (sheet.skillProficiencies ?? []).includes(skill.key)
  const expertise = (sheet.skillExpertise ?? []).includes(skill.key)
  const mult = expertise ? 2 : proficient ? 1 : 0
  const bonus = sheet.skillBonuses?.[skill.key] ?? 0
  const mod = abilityMod(abilities(sheet)[skill.ability]) + proficiency(sheet) * mult + bonus
  return { skill, mod, proficient: proficient || expertise, expertise }
}

export function allSkillTotals(sheet: CharacterSheet): SkillTotal[] {
  return SKILLS.map(s => skillTotal(sheet, s))
}

/** Passive score = 10 + the skill's total modifier. */
export function passiveScore(sheet: CharacterSheet, skillKey: string): number {
  const skill = SKILLS.find(s => s.key === skillKey)
  if (!skill) return 10
  return 10 + skillTotal(sheet, skill).mod
}

export function proficientSkillCount(sheet: CharacterSheet): number {
  const set = new Set([...(sheet.skillProficiencies ?? []), ...(sheet.skillExpertise ?? [])])
  return set.size
}
