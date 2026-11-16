/**
 * The small readers of a character's effects that are not rules: which gear is
 * worn, which temporary effects are applied, and a one-line summary of a bundle.
 *
 * The layering itself — effectiveSheet, activeSources, armour class — is in the
 * engine (src/lib/engine). Its result is derived, display-only, and must NEVER
 * be written back to the DB: write-paths always spread from `character.sheet`.
 */

import type { ActiveEffect, CharacterRow, EquippedItem, ItemEffects, ItemSlot } from './database.types.ts'
import { ITEM_SLOTS } from './equip.ts'

const GEAR_SLOT_KEYS: readonly ItemSlot[] = ITEM_SLOTS

/** The worn gear whose effects apply passively (the eight single-item slots).
 *  Weapon effects are per-attack, and a container grants storage rather than
 *  stats, so neither counts here. */
export function wornGear(character: CharacterRow): EquippedItem[] {
  const eq = (character.equipped ?? {}) as Record<string, EquippedItem | null>
  return GEAR_SLOT_KEYS.map(k => eq[k]).filter((i): i is EquippedItem => !!i)
}

/** Temporary player-applied effects (potions, etc.) stored in `resources`. */
export function activeEffects(character: CharacterRow): ActiveEffect[] {
  const r = character.resources as { activeEffects?: ActiveEffect[] } | undefined
  return r?.activeEffects ?? []
}

/** Short human summary of an effect bundle, e.g. "+2 STR, +1 AC". For status
 *  chips and the use-toast. */
export function summarizeEffects(e: ItemEffects): string {
  const parts: string[] = []
  const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`
  if (e.abilities) for (const [k, v] of Object.entries(e.abilities)) if (v) parts.push(`${signed(v)} ${k.toUpperCase()}`)
  if (e.abilitySet) for (const [k, v] of Object.entries(e.abilitySet)) if (v != null) parts.push(`${k.toUpperCase()} = ${v}`)
  if (e.ac) parts.push(`${signed(e.ac)} AC`)
  if (e.attack) parts.push(`${signed(e.attack)} atk`)
  if (e.extraAttacks) parts.push(`${signed(e.extraAttacks)} attack${Math.abs(e.extraAttacks) === 1 ? '' : 's'}`)
  if (e.damage) parts.push(`${signed(e.damage)} dmg`)
  if (e.speed) parts.push(`${signed(e.speed)} ft spd`)
  if (e.initiative) parts.push(`${signed(e.initiative)} init`)
  if (e.darkvision) parts.push(`darkvision ${e.darkvision} ft`)
  if (e.maxHp) parts.push(`${signed(e.maxHp)} Max HP`)
  if (typeof e.saves === 'number') { if (e.saves) parts.push(`${signed(e.saves)} saves`) }
  else if (e.saves) for (const [k, v] of Object.entries(e.saves)) if (v) parts.push(`${signed(v)} ${k.toUpperCase()} save`)
  if (e.skills) for (const [k, v] of Object.entries(e.skills)) if (v) parts.push(`${signed(v)} ${k}`)
  if (e.carryMult && e.carryMult !== 1) parts.push(`×${e.carryMult} carry`)
  return parts.join(', ') || 'effect'
}
