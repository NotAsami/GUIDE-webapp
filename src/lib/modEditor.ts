/**
 * Shared authoring model for `ItemEffects` — GUI modifier rows (pick a stat,
 * pick a number) compiled to/from the structured shape lib/effects.ts layers
 * onto the sheet. One definition so the item catalog form and the shard
 * lattice editor's effect widgets can never drift into two different stat
 * lists or two different "bonus vs. set" rules.
 */
import type { AbilityKey, ItemEffects, Mod } from './database.types'

export type { Mod }

/** The numeric modifiers the engine (lib/effects.ts) actually reads. `Note`
 *  and other descriptive perks are authored as Detail rows instead, not here. */
export const MOD_STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC', 'Attack', 'Damage', 'Saves', 'Speed', 'Initiative', 'Darkvision', 'Max HP', 'Carry Capacity ×'] as const

const ABIL_KEYS: Record<string, AbilityKey> = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' }
export const isAbility = (stat: string): boolean => stat in ABIL_KEYS

/** Compile the GUI modifier rows into the structured `effects`/`mods` the
 *  engine layers over the sheet. Abilities can be a flat bonus OR a "set to"
 *  floor (Giant Strength); everything else is a flat bonus. */
export function compileEffects(mods: Mod[]): ItemEffects | undefined {
  const eff: ItemEffects = {}
  for (const m of mods) {
    const n = m.amt
    if (!Number.isFinite(n)) continue
    const ak = ABIL_KEYS[m.stat]
    if (ak) { if (m.set) (eff.abilitySet ??= {})[ak] = n; else (eff.abilities ??= {})[ak] = n }
    else if (m.stat === 'AC') eff.ac = n
    else if (m.stat === 'Attack') eff.attack = n
    else if (m.stat === 'Damage') eff.damage = n
    else if (m.stat === 'Saves') eff.saves = n
    else if (m.stat === 'Speed') eff.speed = n
    else if (m.stat === 'Initiative') eff.initiative = n
    else if (m.stat === 'Darkvision') eff.darkvision = n
    else if (m.stat === 'Max HP') eff.maxHp = n
    else if (m.stat === 'Carry Capacity ×') eff.carryMult = n
  }
  return Object.keys(eff).length ? eff : undefined
}

/** Reverse of compileEffects, to seed the editor from an existing effects
 *  object. Object-form `saves` (per-ability) isn't round-tripped — nothing
 *  authors that shape yet; such a value keeps its structured form untouched. */
export function effectsToMods(eff?: ItemEffects): Mod[] {
  if (!eff) return []
  const mods: Mod[] = []
  const up = (k: string) => k.toUpperCase()
  for (const [k, v] of Object.entries(eff.abilities ?? {})) mods.push({ stat: up(k), amt: v as number })
  for (const [k, v] of Object.entries(eff.abilitySet ?? {})) mods.push({ stat: up(k), amt: v as number, set: true })
  if (eff.ac != null) mods.push({ stat: 'AC', amt: eff.ac })
  if (eff.attack != null) mods.push({ stat: 'Attack', amt: eff.attack })
  if (eff.damage != null) mods.push({ stat: 'Damage', amt: eff.damage })
  if (typeof eff.saves === 'number') mods.push({ stat: 'Saves', amt: eff.saves })
  if (eff.speed != null) mods.push({ stat: 'Speed', amt: eff.speed })
  if (eff.initiative != null) mods.push({ stat: 'Initiative', amt: eff.initiative })
  if (eff.darkvision != null) mods.push({ stat: 'Darkvision', amt: eff.darkvision })
  if (eff.maxHp != null) mods.push({ stat: 'Max HP', amt: eff.maxHp })
  if (eff.carryMult != null) mods.push({ stat: 'Carry Capacity ×', amt: eff.carryMult })
  return mods
}
