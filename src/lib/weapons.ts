/**
 * Weapon math — pure SRD-ish rules for attack/damage, derived from the effective
 * sheet (so gear ability-boosts and magic +X flow through). Used by the Equipment
 * weapon list + roller AND the Stat Panel's Attacks widget — one source.
 *
 * Simplifications (homebrew tool; bake exceptions into the weapon data, or the DM
 * can): every weapon is treated as proficient (Ros is a Fighter) and one-handed
 * (no two-handed/versatile distinction); off-hand keeps its ability mod on damage
 * (RAW drops it). Crit handling lives in the roller (doubles dice, not modifier).
 */

import type { AbilityKey, CharacterSheet, EquippedWeapon, WeaponHand } from './database.types'
import { abilityMod, formatMod, proficiency } from './dnd'
import { parseDice, rollDice, rollDie } from './dice'

export function handLabel(hand?: WeaponHand): string {
  return hand === 'main' ? 'Main Hand' : hand === 'off' ? 'Off Hand' : 'Equipped'
}

/** Which ability actually drives this weapon (finesse → the better of STR/DEX). */
export function weaponAbilityKey(weapon: EquippedWeapon, sheet: CharacterSheet): AbilityKey {
  const ab = weapon.ability ?? 'str'
  if (ab !== 'finesse') return ab
  const str = sheet.abilities?.str ?? 10
  const dex = sheet.abilities?.dex ?? 10
  return dex > str ? 'dex' : 'str'
}

function abMod(weapon: EquippedWeapon, sheet: CharacterSheet): number {
  const key = weaponAbilityKey(weapon, sheet)
  return abilityMod(sheet.abilities?.[key] ?? 10)
}

/** To-hit bonus = ability mod + proficiency (assumed) + magic. */
export function weaponAttackBonus(weapon: EquippedWeapon, sheet: CharacterSheet): number {
  return abMod(weapon, sheet) + proficiency(sheet) + (weapon.effects?.attack ?? 0)
}

/** Flat damage bonus added to the dice = ability mod + magic. */
export function weaponDamageBonus(weapon: EquippedWeapon, sheet: CharacterSheet): number {
  return abMod(weapon, sheet) + (weapon.effects?.damage ?? 0)
}

/** Pretty damage string, e.g. "1d8 + 4". Derives from `damageDice` when present
 *  (so it tracks effective abilities); else falls back to the stored `damage`. */
export function weaponDamageString(weapon: EquippedWeapon, sheet: CharacterSheet): string {
  if (weapon.damageDice) {
    const bonus = weaponDamageBonus(weapon, sheet)
    return bonus === 0 ? weapon.damageDice : `${weapon.damageDice} ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}`
  }
  return weapon.damage ?? '—'
}

/* ---------- rolling (attack + damage as one action) ---------- */

export type AttackRoll = {
  d20: number
  bonus: number
  total: number
  crit: boolean
  fumble: boolean
  breakdown: string
}
export type DamageRoll = {
  diceExpr: string
  dice: number[]
  bonus: number
  total: number
  type?: string
  crit: boolean
  breakdown: string
}

/** Roll a weapon's attack AND damage together. A natural 20 doubles the damage
 *  DICE (not the modifier); a natural 1 flags a fumble. Damage is floored at 0. */
export function rollWeaponAttack(weapon: EquippedWeapon, sheet: CharacterSheet): {
  attack: AttackRoll; damage: DamageRoll
} {
  const atkBonus = weaponAttackBonus(weapon, sheet)
  const d20 = rollDie(20)
  const crit = d20 === 20
  const fumble = d20 === 1
  const attack: AttackRoll = {
    d20, bonus: atkBonus, total: d20 + atkBonus, crit, fumble,
    breakdown: `d20(${d20}) ${formatMod(atkBonus)}`,
  }

  const dmgBonus = weaponDamageBonus(weapon, sheet)
  const parsed = parseDice(weapon.damageDice ?? '')
  let dice: number[] = []
  let diceExpr = weapon.damageDice ?? '—'
  if (parsed) {
    const count = crit ? parsed.count * 2 : parsed.count
    dice = rollDice(count, parsed.sides)
    diceExpr = `${count}d${parsed.sides}`
  }
  const diceSum = dice.reduce((a, b) => a + b, 0)
  const damage: DamageRoll = {
    diceExpr, dice, bonus: dmgBonus, total: Math.max(0, diceSum + dmgBonus), type: weapon.type, crit,
    breakdown: `${diceExpr}(${dice.join(' + ') || 0}) ${formatMod(dmgBonus)}`,
  }
  return { attack, damage }
}
