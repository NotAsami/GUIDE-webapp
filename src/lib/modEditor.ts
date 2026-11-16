/**
 * Shared authoring model for `ItemEffects` — GUI modifier rows (pick a stat,
 * pick a number) compiled to/from the structured shape lib/effects.ts layers
 * onto the sheet. One definition so the item catalog form and the shard
 * lattice editor's effect widgets can never drift into two different stat
 * lists or two different "bonus vs. set" rules.
 */
import type { AbilityKey, ItemEffects, Mod } from './database.types'
import { SKILLS } from './dnd.ts'

export type { Mod }

/** The numeric modifiers the engine (lib/effects.ts) actually reads. `Note`
 *  and other descriptive perks are authored as Detail rows instead, not here. */
/* `Attack` is the TO-HIT bonus and `Extra Attacks` is how many swings one Attack
   action buys — two different questions that a shorter name for the second would
   blur. The plural is doing work: a grant of 1 means one EXTRA. */
export const MOD_STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC', 'Attack', 'Extra Attacks', 'Damage', 'Saves', 'Speed', 'Initiative', 'Darkvision', 'Max HP', 'Carry Capacity ×'] as const

/** Per-skill bonuses, as modifier rows.
 *
 *  `ItemEffects.skills` was readable by the engine and writable only by editing
 *  JSON by hand — a field with no control, which is this project's most repeated
 *  bug. A skill bonus IS a stat and a number, so it belongs in the row UI that
 *  already exists rather than in a second editor beside it; the select groups
 *  them so eighteen entries do not bury the fifteen above.
 *
 *  Labelled by NAME and stored by KEY, both from lib/dnd.ts, so this list cannot
 *  drift from the one the Stats screen renders and skillRow scores. */
export const SKILL_STATS: readonly string[] = SKILLS.map(s => s.name)

const ABIL_KEYS: Record<string, AbilityKey> = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' }
export const isAbility = (stat: string): boolean => stat in ABIL_KEYS

/** Every stat a modifier row (or a `boost` op) may name. One set, so the audit
 *  and the compiler cannot disagree about what is spellable. */
export const MOD_STAT_SET: ReadonlySet<string> = new Set<string>([...MOD_STATS, ...SKILL_STATS])

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
  if (eff.extraAttacks != null) mods.push({ stat: 'Extra Attacks', amt: eff.extraAttacks })
  if (eff.damage != null) mods.push({ stat: 'Damage', amt: eff.damage })
  if (typeof eff.saves === 'number') mods.push({ stat: 'Saves', amt: eff.saves })
  if (eff.speed != null) mods.push({ stat: 'Speed', amt: eff.speed })
  if (eff.initiative != null) mods.push({ stat: 'Initiative', amt: eff.initiative })
  if (eff.darkvision != null) mods.push({ stat: 'Darkvision', amt: eff.darkvision })
  if (eff.maxHp != null) mods.push({ stat: 'Max HP', amt: eff.maxHp })
  if (eff.carryMult != null) mods.push({ stat: 'Carry Capacity ×', amt: eff.carryMult })
  // Keyed by skill key; the row shows the NAME, so map back through SKILLS.
  for (const [k, v] of Object.entries(eff.skills ?? {})) {
    const name = SKILLS.find(sk => sk.key === k)?.name
    if (name && v != null) mods.push({ stat: name, amt: v as number })
  }
  return mods
}
