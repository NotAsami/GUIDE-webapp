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
/**
 * The canonical skill KEY for whatever an author wrote — a key, or a display
 * name, in any case.
 *
 * Needed because the catalogs disagree: a class stores `"insight"`, while the
 * SRD background import stored `"Insight"`, and `"Sleight of Hand"` for a key
 * that is `sleightOfHand`. Writing a display name into
 * `sheet.skillProficiencies` does not error — it simply never matches, so the
 * character silently reads as untrained in a skill their background granted.
 *
 * Null for anything unrecognised, and callers must REPORT that rather than drop
 * it: a skill that vanishes without a word is the same silent-wrong-value bug in
 * a different coat.
 */
export function skillKey(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  if (!v) return null
  return SKILLS.find(s => s.key.toLowerCase() === v || s.name.toLowerCase() === v)?.key ?? null
}

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

/* ---------- d20 checks: the named parts, and what they sum to ----------
 *
 * Split out of Character.tsx because it was untestable there and got two bugs
 * in a day. The screen rolls dice and renders; everything arithmetic lives here,
 * next to saveTotal/skillTotal so the two can be compared at a glance — and
 * dnd.test.ts pins that they agree, which is exactly what silently stopped being
 * true when the breakdown was split into separate terms and the sum was not.
 */

/** One named contribution to a d20 roll. */
export type CheckTerm = { label: string; value: number }

/** Advantage a feature grants and advantage the player asked for are the same
 *  request, so they OR together; one of each cancels, per 5e. The engine never
 *  overrides the player's toggle — it only adds a voice. */
export function effectiveMode(
  manual: 'normal' | 'adv' | 'dis', adv: boolean, dis: boolean,
): 'normal' | 'adv' | 'dis' {
  const a = manual === 'adv' || adv
  const d = manual === 'dis' || dis
  return a && !d ? 'adv' : d && !a ? 'dis' : 'normal'
}

/** The named parts of a saving throw, in breakdown order. MUST sum to
 *  saveTotal(). `MISC` is deliberately not called `SAVE`: the hex label `SAV`
 *  already means the whole save, so a term named the same thing reads as the
 *  total and invites exactly the wrong comparison. */
export function saveTerms(sheet: CharacterSheet, key: AbilityKey): CheckTerm[] {
  return [
    { label: ABILITY_ABBR[key].toUpperCase(), value: abilityMod(abilities(sheet)[key]) },
    { label: 'PROF', value: (sheet.saveProficiencies ?? []).includes(key) ? proficiency(sheet) : 0 },
    { label: 'MISC', value: sheet.saveBonuses?.[key] ?? 0 },
  ]
}

/** An ability check: the modifier alone — proficiency does not apply. */
export function abilityCheckTerms(sheet: CharacterSheet, key: AbilityKey): CheckTerm[] {
  return [{ label: ABILITY_ABBR[key].toUpperCase(), value: abilityMod(abilities(sheet)[key]) }]
}

/** The named parts of a skill check. MUST sum to skillTotal().mod. */
export function skillTerms(sheet: CharacterSheet, skill: Skill): CheckTerm[] {
  const expertise = (sheet.skillExpertise ?? []).includes(skill.key)
  const mult = expertise ? 2 : (sheet.skillProficiencies ?? []).includes(skill.key) ? 1 : 0
  return [
    { label: ABILITY_ABBR[skill.ability].toUpperCase(), value: abilityMod(abilities(sheet)[skill.ability]) },
    { label: expertise ? 'PROF x2' : 'PROF', value: proficiency(sheet) * mult },
    { label: 'MISC', value: sheet.skillBonuses?.[skill.key] ?? 0 },
  ]
}

export const sumTerms = (terms: CheckTerm[]): number => terms.reduce((n, t) => n + t.value, 0)

/** Total and breakdown from ONE list, so they cannot disagree. Zero-valued terms
 *  are hidden from the text but still summed — which is free, and is the whole
 *  reason this takes terms rather than a total plus a string. */
export function composeCheck(pick: number, terms: CheckTerm[], critFrom = 20): {
  total: number; breakdown: string; crit: boolean; fumble: boolean
} {
  return {
    total: pick + sumTerms(terms),
    breakdown: [String(pick), ...terms.filter(t => t.value !== 0).map(t => `${formatMod(t.value)} ${t.label}`)].join(' '),
    crit: pick >= critFrom,
    // A natural 1 is a fumble however low the crit range goes.
    fumble: pick === 1,
  }
}
