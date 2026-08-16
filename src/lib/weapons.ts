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
import { abilityMod, formatMod, proficiency } from './dnd.ts'
import { parseDice, rollDice, rollDiceTerms, rollDie } from './dice.ts'
// Safe direction: graph.ts → effects.ts → equip/burden/shards, none of which
// reach back here, so this does not close a cycle.
import { total, type Resolution } from './graph.ts'

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
  /** Every d20 rolled — two under adv/dis, one otherwise. `d20` says which one
   *  was kept, so the panel can strike the loser through. The pair was always
   *  rolled and the loser discarded; keeping it costs nothing and is the only
   *  way a weapon attack renders the same die chips a check already can. */
  rolls: number[]
  mode: 'normal' | 'adv' | 'dis'
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

/** A nocked ammunition stack's contribution to one attack. Flat only, by
 *  design — see the note in rollWeaponAttack. */
export type AmmoBonus = { damage: number; label: string }

/** Roll a weapon's attack AND damage together. A natural 20 doubles the damage
 *  DICE (not the modifier); a natural 1 flags a fumble. Damage is floored at 0.
 *  Nocked ammunition adds a flat, named bonus to the damage.
 *
 *  `graph` carries the feature engine's contributions for this weapon. Only the
 *  UNCONDITIONAL fold (`flat`/`dice`) is applied here — a rider the player still
 *  has to decide on is deliberately NOT pre-rolled, because showing a value
 *  before they choose puts a thumb on the decision. Riders travel on the
 *  RollEntry for the panel to render; see §7's pre-roll rule.
 *
 *  Absent `graph` means "no engine", which resolves identically to "a character
 *  with nothing authored" — both add zero. */
export function rollWeaponAttack(
  weapon: EquippedWeapon, sheet: CharacterSheet, ammo?: AmmoBonus | null,
  graph?: { attack?: Resolution; damage?: Resolution },
): { attack: AttackRoll; damage: DamageRoll } {
  const atkRes = graph?.attack
  // adv/dis from the graph decide the d20 set. Both at once cancel, which is
  // the 5e rule and not something the engine should be opinionated about.
  const advantage = !!atkRes?.adv && !atkRes?.dis
  const disadvantage = !!atkRes?.dis && !atkRes?.adv
  const atkGraph = atkRes ? total(atkRes) : { flat: 0, dice: [] as string[] }
  // Graph dice on an ATTACK (Bless's 1d4) are rolled now: the d20 total is one
  // number and there is nowhere for an unrolled term to live.
  const atkDice = rollDiceTerms(atkGraph.dice)
  const atkDiceSum = atkDice.reduce((a, b) => a + b, 0)
  const atkBonus = weaponAttackBonus(weapon, sheet) + atkGraph.flat + atkDiceSum

  const pair = [rollDie(20), rollDie(20)]
  const d20 = advantage ? Math.max(...pair) : disadvantage ? Math.min(...pair) : pair[0]
  // Threshold from the graph, else the printed 20. Fumble stays a natural 1.
  const crit = d20 >= (atkRes?.critFrom ?? 20)
  const fumble = d20 === 1
  const mode = advantage ? 'adv' as const : disadvantage ? 'dis' as const : 'normal' as const
  const attack: AttackRoll = {
    d20,
    // Only keep the second die when it was actually contested — otherwise the
    // panel would render a phantom "dropped" chip for a die nobody rolled against.
    rolls: mode === 'normal' ? [pair[0]] : pair,
    mode,
    bonus: atkBonus, total: d20 + atkBonus, crit, fumble,
    breakdown: `d20(${d20}) ${formatMod(atkBonus)}`
      + (advantage ? ' adv' : disadvantage ? ' dis' : ''),
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

  // Ammunition contributes a FLAT damage bonus, named in the breakdown so the
  // number stays checkable — "+1 (Silvered Arrows)" rather than a total that
  // silently disagrees with the weapon's printed damage. Dice-valued and
  // conditional ammunition is deliberately out of scope; that is the features
  // engine's roll-contribution mechanism (see the refactor doc §17).
  const ammoBonus = ammo?.damage ?? 0

  // Graph damage. Its dice ride WITH the weapon's, so a crit doubles them too —
  // which is why resolve() returns them unrolled instead of a number.
  const dmgGraph = graph?.damage ? total(graph.damage) : { flat: 0, dice: [] as string[] }
  const graphDice = rollDiceTerms(dmgGraph.dice, crit)
  const graphDiceSum = graphDice.reduce((a, b) => a + b, 0)

  const totalDmg = Math.max(0, diceSum + dmgBonus + ammoBonus + dmgGraph.flat + graphDiceSum)
  const damage: DamageRoll = {
    diceExpr, dice, bonus: dmgBonus + ammoBonus + dmgGraph.flat + graphDiceSum,
    total: totalDmg, type: weapon.type, crit,
    breakdown: `${diceExpr}(${dice.join(' + ') || 0}) ${formatMod(dmgBonus)}`
      + (ammoBonus ? ` ${formatMod(ammoBonus)} (${ammo!.label})` : '')
      + (dmgGraph.flat ? ` ${formatMod(dmgGraph.flat)}` : '')
      + (graphDice.length ? ` + ${dmgGraph.dice.join(' + ')}(${graphDice.join(' + ')})` : ''),
  }
  return { attack, damage }
}

