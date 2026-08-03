/**
 * Where an item goes — the ON PERSON grid geometry and the routing chain.
 *
 * Two jobs that used to live inside the Inventory screen and now have to be
 * shared, because unequipping (lib/equip) and DM grants (Operator Console) both
 * need to decide where an item lands:
 *
 *   1. GEOMETRY  — packing footprints into the fixed 5x4 on-person grid.
 *   2. ROUTING   — the §7 chain that guarantees a pickup can never fail.
 *
 * COORDINATES ARE 1-INDEXED. `col` 1..5, `row` 1..4, naming the item's top-left
 * cell — matching CSS grid, the seed data and the design mockup. (The pre-refactor
 * screen was 0-indexed internally and added +1 at render; that fudge is gone, and
 * mixing the two conventions silently shifts every item one cell.)
 */

import type { EquippedGear, EquippedItem, InventoryItem } from './database.types'

/** The on-person loadout. Fixed on every platform: placements are coordinates, so
 *  a grid 10 wide on desktop and 5 on mobile would strand items in columns that
 *  don't exist. ~44px touch targets at a 412px phone width allow five columns, so
 *  five columns everywhere. */
export const GRID_COLS = 5
export const GRID_ROWS = 4
export const GRID_CELLS = GRID_COLS * GRID_ROWS

/** The on-person grid's container id. */
export const PERSON = 'person'

export interface Cell { col: number; row: number }
export interface Placed { item: InventoryItem; col: number; row: number; w: number; h: number }

/** An item's footprint, clamped to the grid so bad data can never break layout. */
export function footprint(item: { w?: number; h?: number }): { w: number; h: number } {
  return {
    w: Math.min(GRID_COLS, Math.max(1, item.w ?? 1)),
    h: Math.min(GRID_ROWS, Math.max(1, item.h ?? 1)),
  }
}

/** Occupancy set keyed "row,col" — the shared primitive for fits/claim. */
type Occ = Set<string>
const key = (col: number, row: number) => `${row},${col}`

function fits(occ: Occ, col: number, row: number, w: number, h: number): boolean {
  if (col < 1 || row < 1 || col + w - 1 > GRID_COLS || row + h - 1 > GRID_ROWS) return false
  for (let r = row; r < row + h; r++)
    for (let c = col; c < col + w; c++)
      if (occ.has(key(c, r))) return false
  return true
}

function claim(occ: Occ, col: number, row: number, w: number, h: number): void {
  for (let r = row; r < row + h; r++)
    for (let c = col; c < col + w; c++) occ.add(key(c, r))
}

/** Items currently on person. */
export function onPerson(inventory: InventoryItem[]): InventoryItem[] {
  return inventory.filter(i => i.containerId === PERSON)
}

/**
 * Pack the on-person items into the grid: honour each item's stored `col`/`row`
 * when it fits and doesn't collide, then auto-place the rest into the first free
 * rectangle (row-major). Deterministic, so the layout is stable across renders.
 */
export function packPerson(inventory: InventoryItem[]): Placed[] {
  const occ: Occ = new Set()
  const placed: Placed[] = []
  const pending: { item: InventoryItem; w: number; h: number }[] = []

  for (const item of onPerson(inventory)) {
    const { w, h } = footprint(item)
    if (item.col != null && item.row != null && fits(occ, item.col, item.row, w, h)) {
      claim(occ, item.col, item.row, w, h)
      placed.push({ item, col: item.col, row: item.row, w, h })
    } else {
      pending.push({ item, w, h })
    }
  }

  for (const { item, w, h } of pending) {
    const cell = firstFree(occ, w, h)
    if (!cell) continue        // grid full — the item is carried but unplaced
    claim(occ, cell.col, cell.row, w, h)
    placed.push({ item, col: cell.col, row: cell.row, w, h })
  }
  return placed
}

/** First free rectangle that fits a w×h footprint, scanning row-major. */
function firstFree(occ: Occ, w: number, h: number): Cell | null {
  for (let row = 1; row <= GRID_ROWS - h + 1; row++)
    for (let col = 1; col <= GRID_COLS - w + 1; col++)
      if (fits(occ, col, row, w, h)) return { col, row }
  return null
}

/**
 * Is there room on person for this footprint? Footprint-aware, which is the whole
 * point — a 2x1 crossbow needs two ADJACENT free cells, so "two cells are free"
 * is not the same question as "this item fits".
 */
export function freeCellFor(
  inventory: InventoryItem[], item: { w?: number; h?: number },
): Cell | null {
  const occ: Occ = new Set()
  for (const p of packPerson(inventory)) claim(occ, p.col, p.row, p.w, p.h)
  const { w, h } = footprint(item)
  return firstFree(occ, w, h)
}

/** Cells covered by no item — the lattice backdrop. */
export function emptyCells(placed: Placed[]): Cell[] {
  const occ: Occ = new Set()
  for (const p of placed) claim(occ, p.col, p.row, p.w, p.h)
  const out: Cell[] = []
  for (let row = 1; row <= GRID_ROWS; row++)
    for (let col = 1; col <= GRID_COLS; col++)
      if (!occ.has(key(col, row))) out.push({ col, row })
  return out
}

/* ---------- routing ---------- */

/** Where an item landed: a container id, plus a grid cell when that's on person. */
export type Destination = { containerId: string; col?: number; row?: number }

function containerOf(gear: EquippedGear, kind: string): EquippedItem | undefined {
  return gear.containers?.[kind] ?? undefined
}

/** Units held, not row count — a merged "Arrows ×20" stack is ONE inventory
 *  entry but fills 20 of a quiver's capacity, same as 20 separate qty:1
 *  entries would. Counting `.length` here would let a stack grow unbounded
 *  the moment two grants merge into one row instead of two. */
function contentCount(inventory: InventoryItem[], containerId: string | undefined): number {
  if (!containerId) return 0
  return inventory.filter(i => i.containerId === containerId).reduce((n, i) => n + (i.qty ?? 1), 0)
}

/**
 * THE ROUTING CHAIN (spec §7). Decides where a newly acquired item goes:
 *
 *   1. the first equipped container whose `allowedCategories` match  (arrows → quiver)
 *   2. ON PERSON, if a footprint-sized space is free
 *   3. BAG OF HOLDING if equipped, otherwise BACKPACK
 *
 * Each step falls through when it can't take the item — a container at `capacity`
 * fails step 1, a grid with no room fails step 2. Step 3 is unbounded, so **a
 * pickup can never fail**: the character just takes the weight. This is what
 * removed "inventory full" as a state, and what retired the DM's grant-destination
 * picker.
 *
 * The last resort when literally nothing is equipped is ON PERSON with no cell —
 * carried but unplaced. Still better than refusing the item.
 */
export function routeItem(
  item: InventoryItem | EquippedItem, gear: EquippedGear, inventory: InventoryItem[],
): Destination {
  const cat = item.category

  // 1. A container that specifically accepts this category.
  for (const c of Object.values(gear.containers ?? {})) {
    if (!c?.container || !c.id) continue
    const allowed = c.container.allowedCategories
    if (!allowed?.length || !cat || !allowed.includes(cat)) continue
    const cap = c.container.capacity
    if (cap != null && contentCount(inventory, c.id) >= cap) continue   // full → fall through
    return { containerId: c.id }
  }

  // 2. On person, if the footprint actually fits.
  const cell = freeCellFor(inventory, item)
  if (cell) return { containerId: PERSON, col: cell.col, row: cell.row }

  // 3. Overflow — weightless first, because that's the kinder default.
  const overflow = containerOf(gear, 'bagOfHolding') ?? containerOf(gear, 'backpack')
  if (overflow?.id) return { containerId: overflow.id }

  return { containerId: PERSON }
}

/** Apply a routing decision to an item, clearing any stale position. */
export function place<T extends InventoryItem>(item: T, dest: Destination): T {
  const next = { ...item, containerId: dest.containerId } as T
  if (dest.col != null && dest.row != null) {
    next.col = dest.col
    next.row = dest.row
  } else {
    delete next.col
    delete next.row
  }
  return next
}
