/**
 * The inventory ↔ equipped move, in ONE place.
 *
 * Equipment (the loadout view) and Inventory (equip-in-place) both move items
 * between `inventory` and `equipped`. Per the non-negotiable "one owner per
 * operation", that move math lives here as pure patch builders: each returns the
 * `{ equipped, inventory }` section patch to hand to `updateSections` so the item
 * is never in both places (or neither) on a partial failure. Neither screen
 * reimplements the math — they only decide WHEN to call and own their own UI state.
 */

import type {
  CharacterRow, CharacterSection, EquippedGear, EquippedItem, EquippedWeapon,
  InventoryItem, ItemSlot, Json, WeaponHand,
} from './database.types'

type Patch = Partial<Pick<CharacterRow, CharacterSection>>

/* ---------- reads (typed views onto the JSONB) ---------- */

export function getGear(character: CharacterRow): EquippedGear {
  return (character.equipped ?? {}) as EquippedGear
}
export function getInventory(character: CharacterRow): InventoryItem[] {
  return (character.inventory as unknown as InventoryItem[]) ?? []
}
export function getWeapons(gear: EquippedGear): EquippedWeapon[] {
  return gear.weapons ?? []
}
export function getQuickAccess(gear: EquippedGear): (EquippedItem | null)[] {
  return [gear.quickAccess?.[0] ?? null, gear.quickAccess?.[1] ?? null]
}

/* ---------- shape conversions ---------- */

/** Drop only the grid POSITION when an item moves into an equipped slot — the
 *  footprint (w/h) is intrinsic and rides along so it's preserved when the item
 *  later returns to the bag (a 2×2 Chain Mail stays 2×2). */
function toEquipped(item: InventoryItem): EquippedItem {
  const { col: _c, row: _r, ...rest } = item
  return rest as EquippedItem
}

/** A displaced/unequipped item re-enters the bag with no grid position, so the
 *  Inventory grid auto-packs it into the first free cells. */
function toCarried(item: EquippedItem): InventoryItem {
  return item as InventoryItem
}

/** Cast helpers — the JSONB columns are typed loosely (Json), so the patch values
 *  need a single narrow cast each. Centralised here so the screens stay clean. */
function patch(equipped: EquippedGear, inventory: InventoryItem[]): Patch {
  return {
    equipped: equipped as unknown as CharacterRow['equipped'],
    inventory: inventory as unknown as Json[],
  }
}

/* ---------- gear slots ---------- */

/** Equip a carried item into a single-item gear slot. Any current occupant is
 *  displaced back to the bag so the slot never holds two. */
export function equipGearPatch(
  item: InventoryItem, slot: ItemSlot, gear: EquippedGear, inventory: InventoryItem[],
): Patch {
  const occupant = gear[slot] ?? null
  const nextGear = { ...gear, [slot]: toEquipped(item) }
  const nextInv = inventory.filter(i => i.id !== item.id)
  if (occupant) nextInv.push(toCarried(occupant))
  return patch(nextGear, nextInv)
}

export function unequipGearPatch(
  slot: ItemSlot, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const item = gear[slot]
  if (!item) return null
  return patch({ ...gear, [slot]: null }, [...inventory, toCarried(item)])
}

/* ---------- weapons ---------- */

/** Equip a carried weapon into a hand; a weapon already in that hand is displaced
 *  back to the bag (one hand, one weapon). */
export function equipWeaponPatch(
  item: InventoryItem, hand: WeaponHand, gear: EquippedGear, inventory: InventoryItem[],
): Patch {
  const weapons = getWeapons(gear)
  const weaponItem = { ...toEquipped(item), category: 'weapon' as const, hand } as EquippedWeapon
  const displaced = weapons.filter(w => w.hand === hand)
  const kept = weapons.filter(w => w.hand !== hand)
  const nextGear = { ...gear, weapons: [...kept, weaponItem] }
  const nextInv = [
    ...inventory.filter(i => i.id !== item.id),
    ...displaced.map(w => toCarried(w)),
  ]
  return patch(nextGear, nextInv)
}

export function unequipWeaponPatch(
  hand: WeaponHand, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const weapons = getWeapons(gear)
  const w = weapons.find(wp => wp.hand === hand)
  if (!w) return null
  const nextGear = { ...gear, weapons: weapons.filter(wp => wp.hand !== hand) }
  return patch(nextGear, [...inventory, toCarried(w)])
}

/* ---------- quick-access pouch (consumables) ---------- */

/** Move a carried consumable into a quick-access sub-slot (0 or 1). */
export function addQuickPatch(
  item: InventoryItem, index: number, gear: EquippedGear, inventory: InventoryItem[],
): Patch {
  const qa = getQuickAccess(gear)
  qa[index] = toEquipped(item)
  const nextInv = inventory.filter(i => i.id !== item.id)
  return patch({ ...gear, quickAccess: qa }, nextInv)
}

export function unequipQuickPatch(
  index: number, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const qa = getQuickAccess(gear)
  const item = qa[index]
  if (!item) return null
  qa[index] = null
  return patch({ ...gear, quickAccess: qa }, [...inventory, toCarried(item)])
}

/* ---------- equip-target resolution (Inventory's single "Equip" button) ---------- */

export type EquipTarget =
  | { kind: 'gear'; slot: ItemSlot }
  | { kind: 'weapon'; hand: WeaponHand }
  | { kind: 'quick'; index: number }
  | { kind: 'none'; reason: string }

/** Decide where a carried item equips, given the current loadout. Equipment's
 *  modal asks the player which slot/hand; Inventory equips in one tap, so it
 *  needs to resolve the destination itself: gear → its declared slot; weapon →
 *  first free hand (else main, displacing); consumable → first free quick slot. */
export function resolveEquipTarget(item: InventoryItem, gear: EquippedGear): EquipTarget {
  const isWeapon = item.category === 'weapon' || !!item.damageDice || !!item.hand
  if (isWeapon) {
    const weapons = getWeapons(gear)
    const hasMain = weapons.some(w => w.hand === 'main')
    const hasOff = weapons.some(w => w.hand === 'off')
    const hand: WeaponHand = !hasMain ? 'main' : !hasOff ? 'off' : 'main'
    return { kind: 'weapon', hand }
  }
  if (item.category === 'consumable') {
    const qa = getQuickAccess(gear)
    const index = qa[0] == null ? 0 : qa[1] == null ? 1 : -1
    return index < 0
      ? { kind: 'none', reason: 'Quick-access pouch is full' }
      : { kind: 'quick', index }
  }
  if (item.slot) return { kind: 'gear', slot: item.slot }
  return { kind: 'none', reason: 'This item can’t be equipped' }
}

/** Build the patch for a resolved equip target (used by Inventory's one-tap equip). */
export function equipTargetPatch(
  item: InventoryItem, target: EquipTarget, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  switch (target.kind) {
    case 'gear':   return equipGearPatch(item, target.slot, gear, inventory)
    case 'weapon': return equipWeaponPatch(item, target.hand, gear, inventory)
    case 'quick':  return addQuickPatch(item, target.index, gear, inventory)
    case 'none':   return null
  }
}
