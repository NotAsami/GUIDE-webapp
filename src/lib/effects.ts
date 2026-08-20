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
  EquippedItem, EquippedWeapon, Feature, ItemEffects, ItemSlot, ShardNode, ShardTree, Spell,
} from './database.types.ts'
import { ITEM_SLOTS, getGear, getWeapons } from './equip.ts'
import { isPrepared } from './spells.ts'
import { burdenTier, capacityForStr, currentBurden } from './burden.ts'
import { shardFeatures, shardSlots } from './shards.ts'
import { sheetEffects } from './modEditor.ts'

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

/** Features granted by EQUIPPED items (worn gear slots + wielded weapons + the
 *  bound shard) — the derived Gear Features group. Copies live ON the item and
 *  travel with it, so this is read-only derivation: unequip and they vanish.
 *  `uses` counters are stripped — use-tracking writes to `sheet.features`,
 *  where these don't live (the `usage` text still tells the story).
 *
 *  Note the slot list is deliberately WIDER than wornGear()'s: a weapon and the
 *  guide shard grant features even though their `effects` are not passive. */
export function gearFeatures(character: CharacterRow): Feature[] {
  const eq = getGear(character)
  const slots: (EquippedItem | null | undefined)[] = [
    ...ITEM_SLOTS.map(k => eq[k]),
    ...(eq.weapons ?? []), eq.guideShard,
  ]
  return slots
    .filter((i): i is EquippedItem => !!i)
    .flatMap(item => (item.features ?? []).map((f, idx) => ({
      ...f,
      // Namespace the id per item instance so two copies of the same item
      // can't collide as React keys; never written back anywhere.
      id: `gear-${item.id ?? item.name}-${f.id ?? idx}`,
      uses: undefined,
      kind: f.kind ?? 'equipment',
      source: f.source ?? item.name,
    })))
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
  if (e.carryMult && e.carryMult !== 1) parts.push(`×${e.carryMult} carry`)
  return parts.join(', ') || 'effect'
}

function sum(fx: ItemEffects[], pick: (e: ItemEffects) => number | undefined): number {
  return fx.reduce((n, e) => n + (pick(e) ?? 0), 0)
}

/** One entity that exists on this character right now. `fx` is the effect bundle
 *  it contributes PASSIVELY — set only where a bundle applies without a roll.
 *
 *  `fx?: never` on the kinds that contribute nothing passively is the gate, not a
 *  formality: it makes `{ kind: 'weapon', …, fx }` a compile error, so a magic
 *  weapon's to-hit bonus cannot be wired into the effective sheet by accident. */
export type ActiveSource =
  | { kind: 'feature'; obj: Feature; fx?: ItemEffects }
  | { kind: 'shard'; obj: ShardTree; fx?: ItemEffects }
  /** `shardId` because a node's own id is unique only WITHIN its tree — every
   *  shard is seeded with a node called `core`, so two slotted shards would
   *  otherwise share one graph id. See nodeGid(). */
  | { kind: 'shardnode'; obj: ShardNode; shardId: string; fx?: ItemEffects }
  | { kind: 'spell'; obj: Spell; fx?: never }
  | { kind: 'weapon'; obj: EquippedWeapon; fx?: never }
  | { kind: 'item'; obj: EquippedItem; fx?: ItemEffects }
  | { kind: 'effect'; obj: ActiveEffect; fx: ItemEffects }

/** Everything active on this character, as objects — the single answer to "what
 *  exists for targeting/effect purposes right now". Unequipped items and their
 *  features are absent by construction, not by a filter downstream.
 *
 *  ORDER IS LOAD-BEARING: sheet features → gear → shards → spells. Two active
 *  sources declaring the same variable name resolve to the FIRST in this order,
 *  so a collision stays deterministic while it is broken.
 *
 *  `fx` is set for exactly three groups — slotted shards, worn gear, and applied
 *  effects — which is what effectiveSheet() layers. A weapon and the guide shard
 *  carry real `effects` bundles that are per-attack, never passive, so they are
 *  sources WITHOUT `fx`. Collecting the effect list by "has an effects field"
 *  instead of by kind would silently apply every magic weapon's to-hit bonus to
 *  AC, saves and skills.
 *
 *  ponytail: rebuilt per call, and effectiveSheet() is called unmemoized from
 *  ~11 render paths. Memoize per character row when the resolver lands — it
 *  needs the same list and is the first thing to make the cost visible. */
export function activeSources(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): ActiveSource[] {
  const out: ActiveSource[] = []

  /* `fx` on a feature is what lets a RACE or CLASS grant a flat number. Both
     reach the sheet as a carrier feature (lib/classes.ts assignClass), and a
     race's +2 DEX has to layer the way a worn item's does — reversibly, and
     visibly sourced. Features used to be pushed with no fx at all, so nothing
     a feature granted could ever change an ability score. */
  for (const obj of character.sheet?.features ?? []) out.push({ kind: 'feature', obj, fx: sheetEffects(obj.graph) })
  for (const obj of gearFeatures(character)) out.push({ kind: 'feature', obj, fx: sheetEffects(obj.graph) })
  for (const obj of shardFeatures(character, shardTrees)) out.push({ kind: 'feature', obj, fx: sheetEffects(obj.graph) })

  // Slotted shards: the tree's base grant, then every attuned node.
  //
  // A CONCEALED, UNREVEALED node contributes nothing. On a player's client this
  // is already true by construction — a concealed node arrives as bare geometry,
  // its mechanics living in shard_tree_secrets, which has no player policy. The
  // check exists for the DM, whose copy HAS the secrets merged: without it the
  // operator console would simulate contributions the player's sheet cannot
  // have, and the two would quietly disagree.
  //
  // shards.ts already gates perks and features exactly this way; slice 6a is
  // what first let a node's graph into the index, so this is the same rule
  // catching up.
  for (const slot of Object.values(shardSlots(character))) {
    if (!slot.shardId) continue
    const tree = shardTrees[slot.shardId]
    if (!tree) continue
    out.push({ kind: 'shard', obj: tree, fx: tree.baseMods })
    for (const id of slot.attuned) {
      const node = tree.nodes.find(n => n.id === id)
      if (!node || (node.concealed && !slot.revealed?.[id])) continue
      out.push({ kind: 'shardnode', obj: node, shardId: slot.shardId, fx: node.mods })
    }
  }

  // READY spells only. A spell you know but have not prepared is not a thing you
  // are carrying — its contributions should no more apply than an unequipped
  // item's do, which is the rule one line below.
  //
  // isPrepared() is the one place that decides this, and it is why: cantrips are
  // always ready, and a KNOWN-style caster (a Warlock's pact magic, or any
  // caster with preparesSpells false) prepares nothing at all — reading
  // `spell.prepared` directly would silence every spell they own.
  const sb = character.spellbook
  for (const obj of sb?.spells ?? []) if (isPrepared(obj, sb)) out.push({ kind: 'spell', obj })
  for (const obj of getWeapons(getGear(character))) out.push({ kind: 'weapon', obj })
  for (const obj of wornGear(character)) out.push({ kind: 'item', obj, fx: obj.effects })
  for (const obj of activeEffects(character)) out.push({ kind: 'effect', obj, fx: obj.effects })

  return out
}

/** The passive effect bundles out of `activeSources()`, in that order. Every
 *  fold over this list is commutative (max / sum), so the order costs nothing
 *  here — it exists for the variable-collision rule above. */
function passiveEffects(character: CharacterRow, shardTrees: Record<string, ShardTree>): ItemEffects[] {
  return activeSources(character, shardTrees).flatMap(s => s.fx ?? [])
}

/** Carrying-capacity multiplier (Powerful Build-style nodes). Takes the
 *  largest granted value rather than summing/multiplying across sources —
 *  5e's Powerful Build doesn't stack with itself, so two "doubled" sources
 *  still just double, not quadruple. */
export function carryMultiplier(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): number {
  return passiveEffects(character, shardTrees).reduce((m, e) => Math.max(m, e.carryMult ?? 1), 1)
}

/** Base sheet with all worn-gear + slotted-shard effects layered in. DERIVED,
 *  display-only. */
export function effectiveSheet(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): EffectiveSheet {
  const base = character.sheet ?? {}
  const fx = passiveEffects(character, shardTrees)

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

  /* UNIONED, not summed — the one non-numeric thing an ItemEffects carries.
     `useability` grants a permission ("attacks may use WIS"), and two features
     granting the same one grant it once. Base first so an authored value, if
     one ever exists, is not lost. */
  const attackAbilities: AbilityKey[] = [...(base.attackAbilities ?? [])]
  for (const e of fx) {
    for (const k of e.attackAbilities ?? []) {
      if (!attackAbilities.includes(k)) attackAbilities.push(k)
    }
  }

  // Flat scalar sums.
  const ac = (base.ac ?? 0) + sum(fx, e => e.ac)
  const initiative = (base.initiative ?? 0) + sum(fx, e => e.initiative)

  // Max HP: authored base + Σ shard maxHp. The authored `sheet.hp.max` stays
  // canon (levels + CON) — a rest/heal write path spreads `hp` from the base
  // sheet and must persist THIS max unchanged, only healing `current` up to
  // the effective ceiling computed here.
  const hpMax = (base.hp?.max ?? 0) + sum(fx, e => e.maxHp)
  // CLAMPED ON READ, not on write. Losing a +maxHp source (unequipping the item,
  // unslotting the shard) leaves a stored `current` above the new ceiling, and
  // the stored value must not be rewritten to fix it: re-equipping has to give
  // the hit points back, which it cannot do if the drop was persisted. So the
  // sheet reads honestly and `sheet.hp.current` stays canon underneath.
  const hp = base.hp
    ? { ...base.hp, max: hpMax, current: Math.min(base.hp.current ?? 0, hpMax) }
    : undefined

  // Speed: gear bonuses first, then the SRD encumbrance penalty (−10 ft
  // encumbered, −20 ft heavy) — off the effective STR computed just above, so
  // a Belt of Giant Strength both raises capacity AND can lift the penalty in
  // the same pass; carryMultiplier() folds in too, so a Powerful Build node
  // that doubles capacity also pushes the encumbrance thresholds out, not
  // just the Inventory/Topbar bar's displayed max. currentBurden/
  // capacityForStr/burdenTier/carryMultiplier are the pure half of lib/
  // burden.ts + passiveEffects() (no effectiveSheet call), so this can't
  // recurse back into effectiveSheet the way burden()/maxBurden() do.
  const gearSpeed = (base.speed ?? 0) + sum(fx, e => e.speed)
  const carryMult = fx.reduce((m, e) => Math.max(m, e.carryMult ?? 1), 1)
  const tier = burdenTier(currentBurden(character), capacityForStr(abilities.str) * carryMult)
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

  /* Granted skill proficiency and expertise: a UNION with what the character
     already has, never a replacement — a ring that grants Stealth must not take
     away the Perception a class gave you. Nothing downstream needed changing for
     this: lib/dnd.ts skillRow already reads both lists off the sheet, and Stats
     and Character both work from THIS sheet, so the pip, the bonus and the check
     roll all follow from the union. */
  const skillProficiencies = [...new Set([
    ...(base.skillProficiencies ?? []),
    ...fx.flatMap(e => e.skillProficiencies ?? []),
    // Expertise implies proficiency, so a grant of one is a grant of both.
    ...fx.flatMap(e => e.skillExpertise ?? []),
  ])]
  const skillExpertise = [...new Set([
    ...(base.skillExpertise ?? []),
    ...fx.flatMap(e => e.skillExpertise ?? []),
  ])]

  return {
    ...base,
    abilities,
    ac,
    speed,
    initiative,
    hp,
    senses: { ...base.senses, darkvision },
    attackAbilities,
    saveBonuses,
    skillBonuses,
    skillProficiencies,
    skillExpertise,
    __effective: true,
  } as EffectiveSheet
}
