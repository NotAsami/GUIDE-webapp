/**
 * Weapon math — pure SRD-ish rules for attack/damage, derived from the effective
 * sheet (so gear ability-boosts and magic +X flow through). Used by the Equipment
 * weapon list + roller AND the Stat Panel's Attacks widget — one source.
 *
 * Simplifications (homebrew tool; bake exceptions into the weapon data, or the DM
 * can): every weapon is treated as proficient (Ros is a Fighter) and one-handed
 * (versatile is not modelled — see isTwoHanded); off-hand keeps its ability mod on damage
 * (RAW drops it). Crit handling lives in the roller (doubles dice, not modifier).
 */

import type { AbilityKey, CharacterSheet, EquippedWeapon, WeaponHand } from './database.types'
import { abilityMod, formatMod, proficiency, type CheckTerm } from './dnd.ts'
import { parseDice, rolledDice, type RolledDie } from './dice.ts'
// Safe direction: graph.ts → effects.ts → equip/burden/shards, none of which
// reach back here, so this does not close a cycle.
import { rollResolution, type Resolution, type Rider } from './graph.ts'
/* Re-exported, not defined here: equip.ts owns the hand rules and this file
 * sits DOWNSTREAM of graph.ts -> effects.ts -> equip.ts. Defining it here and
 * importing it there closed that loop and every test in the repo failed to
 * load. See the direction note above. */
export { isTwoHanded } from './equip.ts'

/** Is this weapon fired rather than swung?
 *
 *  Three things hang off it — the refusal to attack with an empty quiver, the
 *  ammunition spend, and the `ranged` sub on both resolutions — so it is one
 *  predicate rather than three regexes.
 *
 *  The `properties` fallback is for data authored before the flag existed: the
 *  original rule was "the word ammunition appears somewhere in this free-text
 *  list", which nothing in the UI could write and nothing documented. New
 *  weapons set the flag; old ones keep firing. */
export function isRanged(w: Pick<EquippedWeapon, 'ranged' | 'properties'>): boolean {
  if (typeof w.ranged === 'boolean') return w.ranged
  return (w.properties ?? []).some(p => /ammunition/i.test(p))
}

/** The 2024 mastery properties, with the rule each one is.
 *
 *  A CLOSED LIST, like DAMAGE_TYPES and for the same reason: the name is matched
 *  against free text on 454 imported weapons, and `Vex`/`vex`/`Vexing` would all
 *  look right to an author while only one of them matched anything.
 *
 *  The prose is here rather than authored because it is the SRD's, not the DM's —
 *  a mastery is not a node anyone homebrews per campaign. What the DM authors is
 *  WHICH weapon has which, and which of them a character may use.
 *
 *  `engine` says how much of the rule this app can actually carry, because the
 *  honest answer is "most of it is yours to adjudicate". Only Vex is something
 *  the engine does: advantage on your next attack is an armed modifier, which
 *  §16 already built. */
export const MASTERIES: { name: string; rule: string; engine?: 'arms' }[] = [
  { name: 'Cleave', rule: 'On a hit with a melee weapon, make one attack roll against a second creature within 5 feet of the first that is also within your reach. On a hit it takes the weapon’s damage, without the ability modifier.' },
  { name: 'Graze', rule: 'On a MISS, the target still takes damage equal to your ability modifier — the one the attack used. No damage type bonus, and it cannot crit.' },
  { name: 'Nick', rule: 'The extra attack of the Light property is part of the Attack action rather than a Bonus Action, and only once per turn.' },
  { name: 'Push', rule: 'On a hit, you can push the target up to 10 feet straight away from you if it is Large or smaller.' },
  { name: 'Sap', rule: 'On a hit, the target has Disadvantage on its next attack roll before the start of your next turn.' },
  { name: 'Slow', rule: 'On a hit, the target’s Speed is reduced by 10 feet until the start of your next turn. A target can be affected by only one Slow at a time.' },
  { name: 'Topple', rule: 'On a hit, the target makes a Constitution saving throw against your save DC or has the Prone condition.' },
  { name: 'Vex', rule: 'On a hit, you have Advantage on your next attack roll against that same creature before the end of your next turn.', engine: 'arms' },
]

const MASTERY_BY_KEY = new Map(MASTERIES.map(m => [m.name.toLowerCase(), m]))

/** Which mastery this weapon has, or null.
 *
 *  The `properties` fallback is the whole reason nothing needed migrating: every
 *  imported weapon already lists its mastery in that free-text array, mixed in
 *  with Heavy and Two-Handed. Same shape as `isRanged` and `isTwoHanded`, and for
 *  the same reason — the list is data the item form cannot write, so a weapon
 *  authored through the UI sets the field instead. */
export function masteryOf(w: Pick<EquippedWeapon, 'mastery' | 'properties'>): { name: string; rule: string; engine?: 'arms' } | null {
  const named = w.mastery?.trim().toLowerCase()
  if (named) return MASTERY_BY_KEY.get(named) ?? null
  for (const p of w.properties ?? []) {
    const hit = MASTERY_BY_KEY.get(p.trim().toLowerCase())
    if (hit) return hit
  }
  return null
}

/** Is this weapon's mastery LIVE for this character — is its kind one they know?
 *
 *  Two separate facts, deliberately kept apart: the weapon has a mastery whatever
 *  you do, and you may use it only while it is one of yours. A weapon card that
 *  showed the property without saying which of the two it meant would be telling
 *  the player they have something they do not. */
export function masteryActive(
  w: Pick<EquippedWeapon, 'mastery' | 'properties'>,
  known: string[] | undefined,
): boolean {
  const m = masteryOf(w)
  if (!m) return false
  return (known ?? []).some(k => k.trim().toLowerCase() === m.name.toLowerCase())
}

export function handLabel(hand?: WeaponHand): string {
  return hand === 'main' ? 'Main Hand' : hand === 'off' ? 'Off Hand' : 'Equipped'
}

/**
 * Which ability actually drives this weapon — the BEST score among everything
 * allowed to swing it.
 *
 * Finesse was always this: "the better of STR/DEX" is a best-of over a set of
 * two. A `useability` rule ("you may use Wisdom") widens that set rather than
 * introducing a second idea, which is what makes it a MAY and not a swap: an
 * Arbiter with WIS 18 / STR 10 attacks on Wisdom, and the same character with
 * STR 20 keeps Strength without anyone choosing.
 *
 * Reads `sheet.attackAbilities`, which effectiveSheet unions from every active
 * source — so the grant arrives here with no threading, and leaves the moment
 * the feature does.
 *
 * ONE CHOKEPOINT: abMod() below calls this, and both weaponAttackBonus and
 * weaponDamageBonus call abMod, so attack and damage cannot disagree.
 */
export function weaponAbilityKey(weapon: EquippedWeapon, sheet: CharacterSheet): AbilityKey {
  const ab = weapon.ability ?? 'str'
  const allowed: AbilityKey[] = ab === 'finesse' ? ['str', 'dex'] : [ab]
  for (const k of sheet.attackAbilities ?? []) {
    if (!allowed.includes(k)) allowed.push(k)
  }
  if (allowed.length === 1) return allowed[0]
  // Ties keep the earlier entry, so the weapon's own ability wins a draw and a
  // granted one never silently displaces an equal score.
  let best = allowed[0]
  for (const k of allowed) {
    if ((sheet.abilities?.[k] ?? 10) > (sheet.abilities?.[best] ?? 10)) best = k
  }
  return best
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
  /** The named parts of `bonus`. The panel's modifier read-out is the only place
   *  an itemised breakdown exists, and a lump sum cannot be checked. MUST sum to
   *  `bonus`. */
  terms?: CheckTerm[]
  /** Every d20 rolled — two under adv/dis, one otherwise. `d20` says which one
   *  was kept, so the panel can strike the loser through. The pair was always
   *  rolled and the loser discarded; keeping it costs nothing and is the only
   *  way a weapon attack renders the same die chips a check already can. */
  rolls: RolledDie[]
  mode: 'normal' | 'adv' | 'dis'
  bonus: number
  total: number
  crit: boolean
  fumble: boolean
  breakdown: string
}
export type DamageRoll = {
  diceExpr: string
  dice: RolledDie[]
  bonus: number
  /** Named parts of `bonus`, as on AttackRoll. */
  terms?: CheckTerm[]
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
 *  `graph` carries the feature engine's contributions for this weapon. Every
 *  rider EXCEPT a `manual` one is applied here — a rider the player still has to
 *  decide on is deliberately not pre-rolled, because showing a value before they
 *  choose puts a thumb on the decision (§7). The panel adds those, and adds only
 *  those; between the two halves each rider lands exactly once.
 *
 *  The riders come back out ANNOTATED: rollResolution keeps each contribution's
 *  faces on the contribution, so the panel can show what a +1d6 actually rolled
 *  instead of asking the player to trust a number they cannot check.
 *
 *  Absent `graph` means "no engine", which resolves identically to "a character
 *  with nothing authored" — both add zero. */
export function rollWeaponAttack(
  weapon: EquippedWeapon, sheet: CharacterSheet, ammo?: AmmoBonus | null,
  graph?: { attack?: Resolution; damage?: Resolution },
): { attack: AttackRoll; damage: DamageRoll; riders: { attack: Rider[]; damage: Rider[] } } {
  const atkRes = graph?.attack
  // adv/dis from the graph decide the d20 set. Both at once cancel, which is
  // the 5e rule and not something the engine should be opinionated about.
  const advantage = !!atkRes?.adv && !atkRes?.dis
  const disadvantage = !!atkRes?.dis && !atkRes?.adv
  // Graph dice on an ATTACK (Bless's 1d4) are rolled now: the d20 total is one
  // number and there is nowhere for an unrolled term to live.
  const atkGraph = atkRes ? rollResolution(atkRes) : { flat: 0, riders: [] as Rider[] }
  const atkBonus = weaponAttackBonus(weapon, sheet) + atkGraph.flat

  const pair = rolledDice(2, 20)
  const faces = pair.map(d => d.v)
  const d20 = advantage ? Math.max(...faces) : disadvantage ? Math.min(...faces) : faces[0]
  // Threshold from the graph, else the printed 20. Fumble stays a natural 1.
  const crit = d20 >= (atkRes?.critFrom ?? 20)
  const fumble = d20 === 1
  const mode = advantage ? 'adv' as const : disadvantage ? 'dis' as const : 'normal' as const
  const attack: AttackRoll = {
    d20,
    terms: [
      { label: weaponAbilityKey(weapon, sheet).toUpperCase(), value: abMod(weapon, sheet) },
      { label: 'PROF', value: proficiency(sheet) },
      { label: 'MAGIC', value: weapon.effects?.attack ?? 0 },
      { label: 'FEAT', value: atkGraph.flat },
    ],
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
  let dice: RolledDie[] = []
  let diceExpr = weapon.damageDice ?? '—'
  if (parsed) {
    const count = crit ? parsed.count * 2 : parsed.count
    // The doubled half is marked, not just counted: "2d12" on a 1d12 weapon is
    // only explicable if the panel can point at which dice the crit added.
    dice = rolledDice(count, parsed.sides)
      .map((d, i) => (crit && i >= parsed.count ? { ...d, crit: true } : d))
    diceExpr = `${count}d${parsed.sides}`
  }
  const diceSum = dice.reduce((a, b) => a + b.v, 0)

  // Ammunition contributes a FLAT damage bonus, named in the breakdown so the
  // number stays checkable — "+1 (Silvered Arrows)" rather than a total that
  // silently disagrees with the weapon's printed damage. Dice-valued and
  // conditional ammunition is deliberately out of scope; that is the features
  // engine's roll-contribution mechanism (see the refactor doc §17).
  const ammoBonus = ammo?.damage ?? 0

  // Graph damage. Its dice ride WITH the weapon's, so a crit doubles them too —
  // which is why resolve() hands them over unrolled and `crit` is passed here.
  const dmgGraph = graph?.damage ? rollResolution(graph.damage, crit) : { flat: 0, riders: [] as Rider[] }

  const totalDmg = Math.max(0, diceSum + dmgBonus + ammoBonus + dmgGraph.flat)
  const damage: DamageRoll = {
    diceExpr, dice, bonus: dmgBonus + ammoBonus + dmgGraph.flat,
    terms: [
      { label: weaponAbilityKey(weapon, sheet).toUpperCase(), value: abMod(weapon, sheet) },
      { label: 'MAGIC', value: weapon.effects?.damage ?? 0 },
      { label: (ammo?.label ?? 'AMMO').toUpperCase(), value: ammoBonus },
      { label: 'FEAT', value: dmgGraph.flat },
    ],
    total: totalDmg, type: weapon.type, crit,
    breakdown: `${diceExpr}(${dice.map(d => d.v).join(' + ') || 0}) ${formatMod(dmgBonus)}`
      + (ammoBonus ? ` ${formatMod(ammoBonus)} (${ammo!.label})` : '')
      + (dmgGraph.flat ? ` ${formatMod(dmgGraph.flat)}` : ''),
  }
  return { attack, damage, riders: { attack: atkGraph.riders, damage: dmgGraph.riders } }
}

