/** Spellbook math — pure functions over a `CharacterSpellbook` + `Spell`. No
 *  DOM, no React; call `rollSpellDamage` from event handlers only (StrictMode
 *  double-invokes render). Mirrors the logic in the Spellbook mockup
 *  (guide-hud/project/G.U.I.D.E. Spellbook.html) with ONE deliberate change:
 *  cantrips scale by CHARACTER level, not by a chosen cast level (CLAUDE.md
 *  canon; the mockup's upcast stepper is dropped for cantrips). */

import type { CharacterSpellbook, Spell, SpellSlot } from './database.types.ts'
import { parseDice, rollDice } from './dice.ts'

/** A caster is anyone flagged `spellcasting` with at least one known spell —
 *  a caster with an empty spell list still renders the empty state, exactly
 *  like the mockup's `isCaster()`. */
export function isCaster(sb: CharacterSpellbook | undefined | null): boolean {
  return !!sb?.spellcasting && !!sb.spells && sb.spells.length > 0
}

/** Whether this caster uses the PREPARED style (Wizard/Cleric/Druid/Paladin —
 *  a daily subset of known spells is readied) vs. the KNOWN style (Sorcerer/
 *  Bard/Ranger/Warlock/… — every known spell is always ready, no prep step).
 *  Absent = `true`, matching the original Wizard-only behavior. A Pact Magic
 *  caster is ALWAYS Known-style — Warlock is the only pact caster in 5e, and
 *  it has no prep step, so this overrides the `preparesSpells` field. */
export function preparesSpells(sb: CharacterSpellbook | undefined | null): boolean {
  if (sb?.pactMagic) return false
  return sb?.preparesSpells !== false
}

/** A spell's EFFECTIVE prepared/ready state. Cantrips and every spell owned
 *  by a KNOWN-style caster are always ready; a PREPARED-style caster's
 *  levelled spells read the stored per-spell flag. Read this everywhere a
 *  screen needs to know if a spell can be readied/cast — never `spell.prepared`
 *  directly, or a Warlock's grimoire shows spells as "not prepared" forever. */
export function isPrepared(sp: Spell, sb: CharacterSpellbook | undefined | null): boolean {
  if (sp.level === 0) return true
  if (!preparesSpells(sb)) return true
  return !!sp.prepared
}

/** Prepared count is DERIVED — never stored — by counting non-cantrip spells
 *  flagged prepared. Cantrips never consume the prepared cap. Meaningless for
 *  a KNOWN-style caster (no cap to track); callers should hide the stat
 *  rather than call this when `!preparesSpells(sb)`. */
export function preparedUsed(sb: CharacterSpellbook | undefined | null): number {
  return (sb?.spells ?? []).filter(s => s.level > 0 && s.prepared).length
}

export function slotFor(sb: CharacterSpellbook | undefined | null, level: number): SpellSlot | undefined {
  return sb?.slots?.find(s => s.level === level)
}

/** Highest spell level the caster actually owns a slot for (total > 0). 0 if none. */
export function maxSlotLevel(sb: CharacterSpellbook | undefined | null): number {
  return (sb?.slots ?? []).reduce((m, s) => (s.total > 0 ? Math.max(m, s.level) : m), 0)
}

/** Lowest level a spell can be cast at: its own level (cantrips are always level 0). */
export function minCastLevel(sp: Spell): number {
  return sp.level
}

/** Upcast ceiling for a levelled spell: capped by owned slots, never below its
 *  own level. Cantrips don't upcast (no stepper) — callers shouldn't call this
 *  for cantrips, but it degenerates to `sp.level` (0) harmlessly if they do.
 *
 *  Two authored overrides, both from the catalog form:
 *   - `canUpcast === false` pins the ceiling to the spell's own level — the
 *     caller (Spellbook.tsx) reads this to drop the stepper entirely, not
 *     just disable it.
 *   - `maxUpcastLevel` caps the ceiling further (e.g. a DM-imposed level 4/5
 *     cap), but never below the spell's own level even if authored wrong. */
export function maxCastLevel(sp: Spell, sb: CharacterSpellbook | undefined | null): number {
  if (sp.level === 0) return 0
  if (sp.canUpcast === false) return sp.level
  let ceiling = Math.max(sp.level, maxSlotLevel(sb))
  if (sp.maxUpcastLevel != null) ceiling = Math.min(ceiling, Math.max(sp.level, sp.maxUpcastLevel))
  return ceiling
}

/** Cantrip damage/scaling tier by CHARACTER level — the standard 5e tiers
 *  (1 / 5 / 11 / 17). Tier 1 = no bonus dice yet (0 extra applications). */
export function cantripTier(charLevel: number): 1 | 2 | 3 | 4 {
  if (charLevel >= 17) return 4
  if (charLevel >= 11) return 3
  if (charLevel >= 5) return 2
  return 1
}

/** Warlock Pact Magic slot COUNT by character level — a separate, much
 *  smaller table than the standard full-caster progression: 1/1/2/2..2/3..
 *  3/4.. (breakpoints at 1, 2, 11, 17). Caps at 4 slots total, forever —
 *  nothing past level 17 adds more. */
export function pactSlotCount(charLevel: number): number {
  if (charLevel >= 17) return 4
  if (charLevel >= 11) return 3
  if (charLevel >= 2) return 2
  return 1
}

/** Warlock Pact Magic slot LEVEL by character level — every pact slot is
 *  ALWAYS this one level; there is no ladder like the standard caster's
 *  `slots[]`. Climbs 1st→5th, reaching 5th at level 9 and staying there for
 *  the rest of the character's career. Levels 6-9 never appear here — those
 *  come from Mystic Arcanum (a separate once/day feature), out of scope. */
export function pactSlotLevel(charLevel: number): number {
  if (charLevel >= 9) return 5
  if (charLevel >= 7) return 4
  if (charLevel >= 5) return 3
  if (charLevel >= 3) return 2
  return 1
}

/** How many of the character's derived Pact Magic slots are still available.
 *  `total`/`level` are pure functions of character level (never authored);
 *  `pactExpended` is the only mutable state. */
export function pactSlotsAvail(sb: CharacterSpellbook | undefined | null, charLevel: number): number {
  return Math.max(0, pactSlotCount(charLevel) - (sb?.pactExpended ?? 0))
}

export type DamageInfo = { count: number; sides: number; mod: number; type: string; expr: string }

function fmtExpr(count: number, sides: number, mod: number): string {
  return `${count}d${sides}${mod > 0 ? ' + ' + mod : mod < 0 ? ' - ' + Math.abs(mod) : ''}`
}

/** Resolve a spell's damage dice at a given cast level, applying `scaling`:
 *   - levelled spell: `scaling` applied once per level above the spell's own level
 *   - cantrip: `scaling` applied once per tier above tier 1 (character level, not `castLevel`)
 *  Returns null when the spell has no damage or `dice` doesn't parse — the
 *  panel shows the raw text with the roll disabled rather than throwing. */
export function damageAt(sp: Spell, castLevel: number, charLevel: number): DamageInfo | null {
  if (!sp.hasDamage || !sp.dice) return null
  const base = parseDice(sp.dice)
  if (!base) return null
  const per = sp.scaling ? parseDice(sp.scaling) : null

  const extra = sp.level === 0
    ? cantripTier(charLevel) - 1
    : Math.max(0, castLevel - sp.level)

  const count = base.count + (per?.count ?? 0) * extra
  const mod = base.mod + (per?.mod ?? 0) * extra
  return { count, sides: base.sides, mod, type: sp.dmgType ?? '', expr: fmtExpr(count, base.sides, mod) }
}

export type SpellRoll = {
  rolls: number[]
  sides: number
  mod: number
  total: number
  expr: string
  type: string
  level: number
  cantrip: boolean
  stamp: string
}

function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Roll a spell's damage at the given cast level. Returns null under the same
 *  conditions as `damageAt` (no damage, or an unparseable `dice` string). */
export function rollSpellDamage(sp: Spell, castLevel: number, charLevel: number): SpellRoll | null {
  const info = damageAt(sp, castLevel, charLevel)
  if (!info) return null
  const rolls = rollDice(info.count, info.sides)
  const total = Math.max(0, rolls.reduce((a, b) => a + b, 0) + info.mod)
  return {
    rolls, sides: info.sides, mod: info.mod, total, expr: info.expr, type: info.type,
    level: castLevel, cantrip: sp.level === 0, stamp: nowStamp(),
  }
}
