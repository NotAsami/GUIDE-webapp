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
  CharacterRow, CharacterSection, ContainerKind, EquippedGear, EquippedItem,
  EquippedWeapon, InventoryItem, ItemSlot, Json, WeaponHand,
} from './database.types.ts'
import { PERSON, place, routeItem } from './placement.ts'

export { PERSON }

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
/** Equipped containers as a flat list, in tab order. Keyed by `container.kind` in
 *  the JSONB — one per kind, which is what enforces "1 backpack, 1 bag of holding,
 *  1 sack, 1 quiver" without a slot enum to police. */
export function getContainers(gear: EquippedGear): EquippedItem[] {
  const byKind = gear.containers ?? {}
  return CONTAINER_KIND_ORDER
    .map(kind => byKind[kind])
    .filter((c): c is EquippedItem => !!c)
}

/** Every container kind, in the order they appear as rows in the storage sidebar.
 *  Includes the quiver — the sidebar lists ALL equipped containers. */
export const CONTAINER_KIND_ORDER: readonly ContainerKind[] = [
  'sack', 'backpack', 'bagOfHolding', 'quiver',
] as const

/** The kinds that claim a TAB on the Inventory screen, after ON PERSON. Fixed and
 *  deliberate: the bar shows one tab per SLOT, not per owned item, so a kind with
 *  nothing equipped renders locked rather than vanishing.
 *
 *  The quiver is deliberately ABSENT — it is an `inline` container whose contents
 *  are drawn by the weapon's ammo picker, never browsed as a page. Do not "fix"
 *  this by reusing CONTAINER_KIND_ORDER. See Inventory Refactor spec §3. */
export const TAB_KIND_ORDER: readonly ContainerKind[] = [
  'sack', 'backpack', 'bagOfHolding',
] as const

/** The eight worn gear slots, in gear-grid order (4 across, 2 down). Every place
 *  that walks the worn slots reads THIS — burden, effects, features and the
 *  Equipment grid each used to carry their own copy, which is why widening the
 *  enum broke four files at once. */
export const ITEM_SLOTS: readonly ItemSlot[] = [
  'helmet', 'armor', 'cloak', 'boots',
  'gloves', 'neck', 'ring1', 'ring2',
] as const

/* ---------- shape conversions ---------- */

/** Drop only the PLACEMENT when an item moves into an equipped slot — which
 *  container it was in and where in that container. The footprint (w/h) is
 *  intrinsic and rides along, so it's preserved when the item later returns to
 *  the bag (a 2×2 Chain Mail stays 2×2). */
function toEquipped(item: InventoryItem): EquippedItem {
  const { containerId: _ct, col: _c, row: _r, ...rest } = item
  return rest as EquippedItem
}

/** Fresh instance id for a bag item (same shape the DM grant mints). */
export function freshItemId(): string {
  return `inst-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

/** A displaced/unequipped item re-enters the bag through the ROUTING CHAIN, so it
 *  lands on person when there's room and overflows into a container when there
 *  isn't — an unequip can never fail for lack of space.
 *
 *  If the bag already holds an item with the same id (possible after a seed re-run
 *  restocked the bag while this copy sat equipped), the returning copy is re-keyed
 *  — every inventory operation (move/drop/use) targets items by id, so an id
 *  collision makes two tiles move and drop as one. */
function toCarried(item: EquippedItem, bag: InventoryItem[], gear: EquippedGear): InventoryItem {
  const carried = place({ ...item } as InventoryItem, routeItem(item, gear, bag))
  if (carried.id && bag.some(i => i.id === carried.id)) {
    return { ...carried, id: freshItemId() }
  }
  return carried
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
 *  displaced back to the bag so the slot never holds two.
 *
 *  Attunement is enforced HERE, not in each caller — Equipment and Inventory
 *  both reach a gear slot through this one function, and a check placed in
 *  only one of them (as this used to be, in Equipment's local `equip()`) is a
 *  bypass waiting to be found: Inventory's one-tap equip called
 *  `equipTargetPatch` → this function directly and skipped it entirely.
 *  Refusing here means every caller is guarded by construction.
 *
 *  Checked against the RESULTING gear, not "is this slot empty" — Inventory's
 *  one-tap equip can target an already-occupied slot (swap a worn item for a
 *  carried one) where the occupant itself may or may not have been consuming
 *  attunement. Simulating the swap and counting is the only way that's
 *  right for a net add, a like-for-like swap, and a swap that pushes the
 *  count up (e.g. plain boots -> an attuning pair) alike. */
export function equipGearPatch(
  item: InventoryItem, slot: ItemSlot, gear: EquippedGear, inventory: InventoryItem[],
  character: CharacterRow,
): Patch | null {
  const occupant = gear[slot] ?? null
  const nextGear = { ...gear, [slot]: toEquipped(item) }
  if (attunedCount(nextGear) > attunementCap(character)) return null
  const nextInv = inventory.filter(i => i.id !== item.id)
  if (occupant) nextInv.push(toCarried(occupant, nextInv, gear))
  return patch(nextGear, nextInv)
}

export function unequipGearPatch(
  slot: ItemSlot, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const item = gear[slot]
  if (!item) return null
  return patch({ ...gear, [slot]: null }, [...inventory, toCarried(item, inventory, gear)])
}

/* ---------- weapons ---------- */

/** Does this weapon need both hands?
 *
 *  Same shape as `isRanged`, and for the same reason: the flag is what the item
 *  form writes, and the free-text `properties` list is the fallback that keeps
 *  the 454 imported weapons carrying "Two-Handed" working without a migration.
 *
 *  VERSATILE IS NOT TWO-HANDED. A longsword's "Versatile" means it MAY be used
 *  in two hands for a bigger die — it does not stop you holding a shield — so
 *  matching it here would lock the off hand on half the martial weapons in the
 *  game. Only an explicit two-hander counts. */
export function isTwoHanded(w: Pick<EquippedWeapon, 'twoHanded' | 'properties'>): boolean {
  if (typeof w.twoHanded === 'boolean') return w.twoHanded
  return (w.properties ?? []).some(p => /two[\s-]?handed/i.test(p))
}

/** Why the off hand cannot take a weapon right now, or null when it can.
 *
 *  One producer, because three surfaces ask: the Equipment slot renders the
 *  reason, the inventory popup disables its Equip · Off action, and
 *  `equipWeaponPatch` refuses. Three copies of the rule is three chances for
 *  the button to be live while the write says no. */
export function offHandBlockedBy(gear: EquippedGear): EquippedWeapon | null {
  return getWeapons(gear).find(w => w.hand === 'main' && isTwoHanded(w)) ?? null
}

/** Equip a carried weapon into a hand; a weapon already in that hand is displaced
 *  back to the bag (one hand, one weapon).
 *
 *  TWO-HANDED WEAPONS CLAIM BOTH. Putting one in the main hand sends whatever is
 *  in the off hand back to the bag, and the off hand refuses a weapon while one
 *  is held — you cannot dual-wield claymores. Returns null on that refusal
 *  rather than writing a state the rules forbid; callers already handle a null
 *  from `unequipWeaponPatch`. */
export function equipWeaponPatch(
  item: InventoryItem, hand: WeaponHand, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const weapons = getWeapons(gear)
  if (hand === 'off' && (offHandBlockedBy(gear) || isTwoHanded(item))) return null
  const weaponItem = { ...toEquipped(item), category: 'weapon' as const, hand } as EquippedWeapon
  // A two-hander displaces the OFF hand as well as its own.
  const takesBoth = hand === 'main' && isTwoHanded(item)
  const displaced = weapons.filter(w => w.hand === hand || (takesBoth && w.hand === 'off'))
  const kept = weapons.filter(w => !displaced.includes(w))
  const nextGear = { ...gear, weapons: [...kept, weaponItem] }
  const nextInv = inventory.filter(i => i.id !== item.id)
  for (const w of displaced) nextInv.push(toCarried(w, nextInv, gear))
  return patch(nextGear, nextInv)
}

export function unequipWeaponPatch(
  hand: WeaponHand, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const weapons = getWeapons(gear)
  const w = weapons.find(wp => wp.hand === hand)
  if (!w) return null
  const nextGear = { ...gear, weapons: weapons.filter(wp => wp.hand !== hand) }
  return patch(nextGear, [...inventory, toCarried(w, inventory, gear)])
}

/* ---------- containers ---------- */

/** Equip a carried container into its kind's slot; a container already occupying
 *  that kind is displaced back to the bag.
 *
 *  CONTENTS ARE NOT TOUCHED, and that is the whole trick: an item's `containerId`
 *  points at the container's id whether the container is worn or not, so contents
 *  travel with it for free. Unequipping a backpack makes its 13 items unreachable
 *  (the tab locks) without moving a single one of them; re-equip and they are all
 *  exactly where they were. */
export function equipContainerPatch(
  item: InventoryItem, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const kind = item.container?.kind
  if (!kind) return null
  const byKind = { ...(gear.containers ?? {}) }
  const displaced = byKind[kind] ?? null
  byKind[kind] = toEquipped(item)
  const nextInv = inventory.filter(i => i.id !== item.id)
  if (displaced) nextInv.push(toCarried(displaced, nextInv, gear))
  return patch({ ...gear, containers: byKind }, nextInv)
}

/** Unequip the container occupying a kind. Its contents stay put in `inventory`
 *  under its id — they are in the bag, and the bag is now in your hands. */
export function unequipContainerPatch(
  kind: ContainerKind, gear: EquippedGear, inventory: InventoryItem[],
): Patch | null {
  const byKind = { ...(gear.containers ?? {}) }
  const item = byKind[kind]
  if (!item) return null
  delete byKind[kind]
  return patch({ ...gear, containers: byKind }, [...inventory, toCarried(item, inventory, gear)])
}

/** Does this item consume one of the three attunement slots?
 *
 *  `attune` is DM-authored free text, so it doubles as both the flag and the
 *  label ("Ring of Protection", "Required"). An explicit denial — "Not required",
 *  "None", "No" — means the item is magical but doesn't tie up a slot; anything
 *  else counts. Attunement is always DERIVED from what's worn, never stored. */
export function consumesAttunement(item: EquippedItem | null | undefined): boolean {
  const a = item?.attune?.trim()
  return !!a && !/^(not required|none|no|n\/a|-|—)$/i.test(a)
}

/** The `ATTUNED n / 3` readout. Counts worn gear only: weapons don't attune in
 *  this build, and a container grants storage rather than a magical bond. */
export function attunedCount(gear: EquippedGear): number {
  return ITEM_SLOTS.reduce((n, k) => n + (consumesAttunement(gear[k]) ? 1 : 0), 0)
}

/** SRD default when a character row doesn't say otherwise. */
export const ATTUNEMENT_CAP_DEFAULT = 3

/** How many items this character may attune to.
 *
 *  Read from `resources.attunement.capacity`, which the schema has carried since
 *  Phase 0 and nothing was using — a hardcoded 3 duplicated a value the database
 *  already owned. Reading it here means the DM can raise a single character's cap
 *  (a boon, a shard, an artifact) by editing one field, with no code change. */
export function attunementCap(character: CharacterRow): number {
  const att = (character.resources as { attunement?: { capacity?: number } } | undefined)?.attunement
  const cap = att?.capacity
  return typeof cap === 'number' && cap > 0 ? cap : ATTUNEMENT_CAP_DEFAULT
}

/** Containers the character owns but isn't wearing. They sit in the inventory
 *  like any other item; the sidebar lists them so "where did my backpack go" is
 *  never a question.
 *
 *  Only ON-PERSON containers count. A container found inside another container
 *  would mean nesting, which §10 forbids — if one ever appears (bad seed, a DM
 *  hand-edit), listing it as equippable would quietly bless the illegal state
 *  instead of leaving it visible as the anomaly it is. */
export function stowedContainers(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter(i => !!i.container && i.containerId === PERSON)
}

/** How many items are inside a container — the count its row and tab display, and
 *  what a non-empty-unequip confirmation asks about. */
export function containerContents(
  containerId: string | undefined, inventory: InventoryItem[],
): InventoryItem[] {
  if (!containerId) return []
  return inventory.filter(i => i.containerId === containerId)
}

/* ---------- equip-target resolution (Inventory's single "Equip" button) ---------- */

export type EquipTarget =
  | { kind: 'gear'; slot: ItemSlot }
  | { kind: 'weapon'; hand: WeaponHand }
  | { kind: 'container'; containerKind: ContainerKind }
  | { kind: 'none'; reason: string }

/** Rings are the one gear category with two interchangeable slots — same
 *  mechanical effect regardless of which finger wears it (no `type` or logic
 *  distinguishes ring1 from ring2 anywhere). Every caller that needs to treat
 *  them as one pool — equip resolution, Equipment's per-slot picker, carried-
 *  item labels — checks this instead of comparing against a specific key. */
export function isRingSlot(slot: ItemSlot): boolean {
  return slot === 'ring1' || slot === 'ring2'
}

/** Decide where a carried item equips, given the current loadout. Equipment's
 *  modal asks the player which slot/hand; Inventory equips in one tap, so it
 *  needs to resolve the destination itself: weapon → first free hand (else main,
 *  displacing); container → its kind's slot; gear → its declared slot — except
 *  a ring, which prefers whichever of the two ring slots is free rather than
 *  committing to the specific one it happened to be catalogued under (an item
 *  tagged ring1 must still be equippable into an empty Ring II, or a player
 *  wearing something in ring1 alone could never equip a "ring1" item at all).
 *
 *  Consumables are no longer an equip target at all — the quick-access pouch is
 *  gone and a potion is used from wherever it sits. */
export function resolveEquipTarget(item: InventoryItem, gear: EquippedGear): EquipTarget {
  const isWeapon = item.category === 'weapon' || !!item.damageDice || !!item.hand
  if (isWeapon) {
    const weapons = getWeapons(gear)
    const hasMain = weapons.some(w => w.hand === 'main')
    const hasOff = weapons.some(w => w.hand === 'off')
    const hand: WeaponHand = !hasMain ? 'main' : !hasOff ? 'off' : 'main'
    return { kind: 'weapon', hand }
  }
  if (item.container) return { kind: 'container', containerKind: item.container.kind }
  if (item.slot && isRingSlot(item.slot)) {
    const free = (['ring1', 'ring2'] as const).find(k => !gear[k])
    return { kind: 'gear', slot: free ?? item.slot }
  }
  if (item.slot) return { kind: 'gear', slot: item.slot }
  return { kind: 'none', reason: 'This item can’t be equipped' }
}

/** Build the patch for a resolved equip target (used by Inventory's one-tap equip). */
export function equipTargetPatch(
  item: InventoryItem, target: EquipTarget, gear: EquippedGear, inventory: InventoryItem[],
  character: CharacterRow,
): Patch | null {
  switch (target.kind) {
    case 'gear':      return equipGearPatch(item, target.slot, gear, inventory, character)
    case 'weapon':    return equipWeaponPatch(item, target.hand, gear, inventory)
    case 'container': return equipContainerPatch(item, gear, inventory)
    case 'none':      return null
  }
}
