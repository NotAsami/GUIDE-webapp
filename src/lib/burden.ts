/**
 * Burden = how much the character is carrying, against their carrying capacity.
 *
 * Single source of truth for the topbar's ⚖ pill AND the Inventory screen's
 * readout: both call `burden(character)`. Carried weight is the sum of every
 * item's `weight × qty` across the bag (`inventory`) AND everything equipped
 * (gear slots, weapons, quick-access pouch, the G.U.I.D.E. shard) — equipping an
 * item doesn't make it weightless. Capacity is the SRD rule: STR × 15 lb, read
 * off the EFFECTIVE STR so a Belt of Giant Strength raises what you can haul too.
 *
 * Since the Inventory Refactor this is the ONLY capacity system: encumbrance slows
 * the character, it never blocks a pickup. There is no slot cap to run out of.
 */

import type { CharacterRow, EquippedItem, EquippedGear, InventoryItem, ShardTree } from './database.types'
import { ITEM_SLOTS, getGear, getInventory, getWeapons, getContainers } from './equip'
import { effectiveSheet } from './effects'

/** Per-stack weight: per-unit weight × quantity (both default sensibly). */
export function itemWeight(item: { weight?: number; qty?: number }): number {
  return (item.weight ?? 0) * (item.qty ?? 1)
}

/** Weight as a string, rounded to one decimal. Float dust is not hypothetical:
 *  twelve 0.05 lb arrows sum to 0.6000000000000001, which a raw render happily
 *  prints in full. Every surface that shows a weight goes through this. */
export function fmtWeight(lb: number): string {
  return (Math.round(lb * 10) / 10).toString()
}

/** Every weighable item the character has on them — carried + equipped.
 *
 *  Containers make this less obvious than it was. A container's OWN weight always
 *  counts (a bag of holding is 15 lb of bag), but the contents of a `weightless`
 *  container do not — that's the whole point of owning one. So the inventory is
 *  filtered by which container each item is in, rather than summed wholesale. */
function allHeldItems(character: CharacterRow): (EquippedItem | InventoryItem)[] {
  const gear: EquippedGear = getGear(character)
  const containers = getContainers(gear)
  const inventory = getInventory(character)

  /** Ids of every weightless container, whether it is worn or sitting in the bag
   *  itself. Weightlessness belongs to the container, not to its equipped state —
   *  unequipping a bag of holding must not make its 200 ft of chain suddenly weigh
   *  100 lb. */
  const weightlessIds = new Set(
    [...containers, ...inventory]
      .filter(c => c.container?.weightless)
      .map(c => c.id)
      .filter((id): id is string => !!id),
  )

  const items: (EquippedItem | InventoryItem)[] =
    inventory.filter(it => !weightlessIds.has(it.containerId))

  for (const k of ITEM_SLOTS) {
    const it = gear[k]
    if (it) items.push(it)
  }
  items.push(...getWeapons(gear))
  items.push(...containers)          // the bags themselves always weigh
  if (gear.guideShard) items.push(gear.guideShard)
  return items
}

/** Total carried weight in pounds (carried + equipped). */
export function currentBurden(character: CharacterRow): number {
  const total = allHeldItems(character).reduce((n, it) => n + itemWeight(it), 0)
  // Avoid float dust (0.1-lb arrows etc.) — round to one decimal.
  return Math.round(total * 10) / 10
}

/** Carrying capacity in pounds: SRD STR × 15. Pure — no effectiveSheet call —
 *  so effects.ts can use it while computing the effective sheet itself
 *  without a circular call back into effectiveSheet(). */
export function capacityForStr(str: number): number {
  return str * 15
}

/** Carrying capacity in pounds, off the EFFECTIVE STR so a Belt of Giant
 *  Strength (or a shard's STR node) raises what you can haul too. */
export function maxBurden(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): number {
  return capacityForStr(effectiveSheet(character, shardTrees).abilities?.str ?? 10)
}

/** Both numbers plus the encumbrance ratio, for the topbar pill and Inventory. */
export function burden(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): { current: number; max: number; ratio: number } {
  const current = currentBurden(character)
  const max = maxBurden(character, shardTrees)
  return { current, max, ratio: max > 0 ? current / max : 0 }
}

export type BurdenTier = 'none' | 'encumbered' | 'heavy'

/** SRD variant encumbrance tiers: encumbered at 1/3 capacity (STR×5), heavy at
 *  2/3 (STR×10). Weight is the only capacity system — these tiers slow the
 *  character, they never block a pickup. Shared by Inventory (the bar's tick
 *  marks + note), effects.ts (the speed penalty), and Stats.tsx (the
 *  disadvantage-on-checks readout) so the thresholds can't drift apart. */
export function burdenTier(current: number, max: number): BurdenTier {
  if (max <= 0) return 'none'
  if (current > (max * 2) / 3) return 'heavy'
  if (current > max / 3) return 'encumbered'
  return 'none'
}
