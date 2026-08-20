/**
 * Shared authoring model for `ItemEffects` — GUI modifier rows (pick a stat,
 * pick a number) compiled to/from the structured shape lib/effects.ts layers
 * onto the sheet. One definition so the item catalog form and the shard
 * lattice editor's effect widgets can never drift into two different stat
 * lists or two different "bonus vs. set" rules.
 */
import type { AbilityKey, EffectDef, GraphEffect, ItemEffects, Mod } from './database.types'
import { SKILLS } from './dnd.ts'

/* Declared here rather than imported from effects.ts: that module imports THIS
   one (effects.ts:29), and reaching back would make the cycle. Six constants. */
const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

export type { Mod }

/** The numeric modifiers the engine (lib/effects.ts) actually reads. `Note`
 *  and other descriptive perks are authored as Detail rows instead, not here. */
export const MOD_STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC', 'Attack', 'Damage', 'Saves', 'Speed', 'Initiative', 'Darkvision', 'Max HP', 'Carry Capacity ×'] as const

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
const SKILL_KEY: Record<string, string> = Object.fromEntries(SKILLS.map(s => [s.name, s.key]))

const ABIL_KEYS: Record<string, AbilityKey> = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' }
export const isAbility = (stat: string): boolean => stat in ABIL_KEYS

/** Compile the GUI modifier rows into the structured `effects`/`mods` the
 *  engine layers over the sheet. Abilities can be a flat bonus OR a "set to"
 *  floor (Giant Strength); everything else is a flat bonus. */
export function compileEffects(mods: Mod[], skills?: Pick<EffectDef, 'skillProficiencies' | 'skillExpertise'>[]): ItemEffects | undefined {
  const eff: ItemEffects = {}
  /* Skill proficiency rides along rather than living in its own compile step,
     because `effects` is a single compiled cache — two compilers writing the same
     field is how one of them silently wins. Unioned across every referenced
     effect, so two rings granting different skills grant both. */
  const profs = [...new Set((skills ?? []).flatMap(s => s.skillProficiencies ?? []))]
  const exp = [...new Set((skills ?? []).flatMap(s => s.skillExpertise ?? []))]
  if (profs.length) eff.skillProficiencies = profs
  if (exp.length) eff.skillExpertise = exp
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
    else if (SKILL_KEY[m.stat]) (eff.skills ??= {})[SKILL_KEY[m.stat]] = n
  }
  return Object.keys(eff).length ? eff : undefined
}

/** Every stat a modifier row (or a `boost` op) may name. One set, so the audit
 *  and the compiler cannot disagree about what is spellable. */
export const MOD_STAT_SET: ReadonlySet<string> = new Set<string>([...MOD_STATS, ...SKILL_STATS])

/**
 * The sheet layer a node's graph declares — its `boost` ops, compiled.
 *
 * Compiled ON READ rather than cached on save. A cache would be a second copy
 * of something the graph already says, and this project has deleted enough of
 * those; the graph travels with the node (it is snapshotted onto the character
 * like everything else), so there is nothing to look up and nothing to drift.
 *
 * `when` is deliberately NOT honoured: effectiveSheet is a pure function of the
 * sheet with no expression scope, and a condition that silently never fires is
 * worse than one the audit refuses. auditNode says so at author time.
 *
 * ponytail: walks the graph on every effectiveSheet call. Graphs are a handful
 * of rows; memoize on the character row if a profile ever says otherwise.
 */
export function sheetEffects(graph?: GraphEffect[]): ItemEffects | undefined {
  if (!graph?.length) return undefined
  const mods: Mod[] = []
  /* `useability` is the one sheet op that is NOT a number, so it cannot go
     through compileEffects with the rest — it is a set of permissions, collected
     separately and unioned onto the compiled result. */
  const attackAbilities: AbilityKey[] = []
  for (const g of graph) {
    if (g.op === 'useability') {
      const key = (g.ability ?? '').toLowerCase() as AbilityKey
      if (ABILITY_KEYS.includes(key) && !attackAbilities.includes(key)) attackAbilities.push(key)
      continue
    }
    if (g.op !== 'boost' || !g.stat) continue
    const amt = Number(g.value)
    if (!Number.isFinite(amt)) continue
    mods.push({ stat: g.stat, amt })
  }
  if (!mods.length && !attackAbilities.length) return undefined
  const out: ItemEffects = mods.length ? (compileEffects(mods) ?? {}) : {}
  if (attackAbilities.length) out.attackAbilities = attackAbilities
  return out
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
  // Keyed by skill key; the row shows the NAME, so map back through SKILLS.
  for (const [k, v] of Object.entries(eff.skills ?? {})) {
    const name = SKILLS.find(sk => sk.key === k)?.name
    if (name && v != null) mods.push({ stat: name, amt: v as number })
  }
  return mods
}
