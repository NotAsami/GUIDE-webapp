/**
 * Item-effect layering. Worn gear AND slotted shards contribute numeric
 * `effects`/`mods` (lib/database types `ItemEffects`) that get layered over
 * the canonical base sheet to produce an `EffectiveSheet` — the values every
 * screen DISPLAYS.
 *
 * Hard rule: the result is derived, display-only. It must NEVER be written back
 * to the DB. Persisting an item-boosted score as the base would corrupt canon and
 * unequip couldn't undo it. Write-paths always spread from `character.sheet`.
 *
 * Order of operations for abilities: effective = max(base, highest "set") + Σ flat.
 * (A "set" floor like Belt of Giant Strength replaces your natural score; magic
 *  flat bonuses add on top of that.)
 *
 * `shardTrees` is the caller's shard catalog (lib/shards.ts `useShardCatalog`),
 * passed in rather than fetched here — effectiveSheet stays a pure function of
 * its arguments. Callers with no catalog in hand may omit it; the effective
 * sheet then simply carries no shard bonus (degrades safely, never throws).
 */

import type {
  AbilityKey, AbilityScores, ActiveEffect, CharacterRow, EffectiveSheet,
  EquippedItem, ItemEffects, ItemSlot, ShardTree,
} from './database.types'
import { ITEM_SLOTS } from './equip'
import { burdenTier, capacityForStr, currentBurden } from './burden'
import { shardEffects } from './shards'

const GEAR_SLOT_KEYS: readonly ItemSlot[] = ITEM_SLOTS
const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const ZERO: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }

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
  if (e.damage) parts.push(`${signed(e.damage)} dmg`)
  if (e.speed) parts.push(`${signed(e.speed)} ft spd`)
  if (e.initiative) parts.push(`${signed(e.initiative)} init`)
  if (e.darkvision) parts.push(`darkvision ${e.darkvision} ft`)
  if (e.maxHp) parts.push(`${signed(e.maxHp)} Max HP`)
  if (typeof e.saves === 'number') { if (e.saves) parts.push(`${signed(e.saves)} saves`) }
  else if (e.saves) for (const [k, v] of Object.entries(e.saves)) if (v) parts.push(`${signed(v)} ${k.toUpperCase()} save`)
  if (e.skills) for (const [k, v] of Object.entries(e.skills)) if (v) parts.push(`${signed(v)} ${k}`)
  return parts.join(', ') || 'effect'
}

function sum(fx: ItemEffects[], pick: (e: ItemEffects) => number | undefined): number {
  return fx.reduce((n, e) => n + (pick(e) ?? 0), 0)
}

/** Base sheet with all worn-gear + slotted-shard effects layered in. DERIVED,
 *  display-only. */
export function effectiveSheet(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): EffectiveSheet {
  const base = character.sheet ?? {}
  const fx = [
    ...wornGear(character).map(i => i.effects),
    ...activeEffects(character).map(e => e.effects),
    ...shardEffects(character, shardTrees),
  ].filter((e): e is ItemEffects => !!e)

  // Abilities: max(base, highest set) + Σ flat.
  const baseAb = base.abilities ?? ZERO
  const abilities: AbilityScores = { ...baseAb }
  for (const key of ABILITY_KEYS) {
    let setFloor = baseAb[key]
    let flat = 0
    for (const e of fx) {
      const s = e.abilitySet?.[key]
      if (s !== undefined) setFloor = Math.max(setFloor, s)
      const b = e.abilities?.[key]
      if (b !== undefined) flat += b
    }
    abilities[key] = setFloor + flat
  }

  // Flat scalar sums.
  const ac = (base.ac ?? 0) + sum(fx, e => e.ac)
  const initiative = (base.initiative ?? 0) + sum(fx, e => e.initiative)

  // Max HP: authored base + Σ shard maxHp. The authored `sheet.hp.max` stays
  // canon (levels + CON) — a rest/heal write path spreads `hp` from the base
  // sheet and must persist THIS max unchanged, only healing `current` up to
  // the effective ceiling computed here.
  const hpMax = (base.hp?.max ?? 0) + sum(fx, e => e.maxHp)
  const hp = base.hp ? { ...base.hp, max: hpMax } : undefined

  // Speed: gear bonuses first, then the SRD encumbrance penalty (−10 ft
  // encumbered, −20 ft heavy) — off the effective STR computed just above, so
  // a Belt of Giant Strength both raises capacity AND can lift the penalty in
  // the same pass. currentBurden/capacityForStr/burdenTier are the pure half
  // of lib/burden.ts (no effectiveSheet call), so this can't recurse back
  // into effectiveSheet the way burden()/maxBurden() do.
  const gearSpeed = (base.speed ?? 0) + sum(fx, e => e.speed)
  const tier = burdenTier(currentBurden(character), capacityForStr(abilities.str))
  const speedPenalty = tier === 'heavy' ? 20 : tier === 'encumbered' ? 10 : 0
  const speed = Math.max(0, gearSpeed - speedPenalty)

  // Darkvision: take the largest granted range.
  let darkvision = base.senses?.darkvision ?? 0
  for (const e of fx) if (e.darkvision !== undefined) darkvision = Math.max(darkvision, e.darkvision)

  // Save bonuses: number = all saves; object = per-ability. Merge over authored.
  const saveBonuses: Partial<Record<AbilityKey, number>> = { ...(base.saveBonuses ?? {}) }
  for (const e of fx) {
    if (e.saves === undefined) continue
    if (typeof e.saves === 'number') {
      for (const k of ABILITY_KEYS) saveBonuses[k] = (saveBonuses[k] ?? 0) + e.saves
    } else {
      for (const k of ABILITY_KEYS) {
        const v = e.saves[k]
        if (v !== undefined) saveBonuses[k] = (saveBonuses[k] ?? 0) + v
      }
    }
  }

  // Skill bonuses: merge over authored.
  const skillBonuses: Partial<Record<string, number>> = { ...(base.skillBonuses ?? {}) }
  for (const e of fx) {
    if (!e.skills) continue
    for (const [k, v] of Object.entries(e.skills)) {
      if (v !== undefined) skillBonuses[k] = (skillBonuses[k] ?? 0) + v
    }
  }

  return {
    ...base,
    abilities,
    ac,
    speed,
    initiative,
    hp,
    senses: { ...base.senses, darkvision },
    saveBonuses,
    skillBonuses,
    __effective: true,
  } as EffectiveSheet
}
