/**
 * The loot roll.
 *
 * A table is a list of things that MIGHT be in a chest, on a corpse, on a
 * shelf — each with its own quantity range and its own chance:
 *
 *     Chainmail Boots     x1      30%
 *     Arrows              x1-10   50%
 *     silver              2-20    80%
 *
 * ROWS ROLL INDEPENDENTLY. This is the decision the whole file turns on: the
 * percentages in a real table sum well past 100, because "30% chance of boots"
 * has to keep meaning 30% no matter what else is on the list. A weighted
 * pick-one would normalise them, and adding a common row would quietly make
 * every rare row rarer. So: one coin flip per row, and a corpse can carry
 * everything or nothing.
 *
 * PURE, AND THE RNG IS AN ARGUMENT. A generator whose output cannot be pinned
 * cannot be tested, and "the loot felt wrong" is not a bug report anyone can
 * act on. The tests drive `rng` with a scripted sequence and assert exact
 * results; production passes nothing and gets Math.random.
 *
 * Nothing here writes. The caller previews the result, drops what it does not
 * want, and grants — see the Actions tab's LootCard.
 */

import type { CatalogItemData, LootRow, LootTable } from './database.types.ts'

/** One row's outcome. MISSES ARE KEPT: the preview shows what did not come up,
 *  which is the only way to see that a table is tuned wrong without doing the
 *  arithmetic yourself. */
export type LootOutcome = {
  row: LootRow
  hit: boolean
  /** Rolled quantity. 0 on a miss. */
  qty: number
  /** Resolved item name, for an item row that resolved. */
  name?: string
  /** Set when an item row points at an id the catalog no longer has. */
  missing?: boolean
}

export type LootResult = {
  outcomes: LootOutcome[]
  /** Only the hits, in table order — what Grant would actually write. */
  items: { item_id: string; data: CatalogItemData; qty: number }[]
  coins: { gold: number; silver: number; copper: number }
  /** Item rows whose id is not in the catalog. A broken table, not bad luck. */
  missing: string[]
}

export type Rng = () => number

/** Uniform integer in [min, max], inclusive at BOTH ends.
 *
 *  Inclusive because the table says "1-10" and a DM writing that means ten
 *  outcomes, not nine. `Math.floor(rng() * (max - min + 1))` is the whole
 *  reason the +1 is there, and dropping it is the classic off-by-one that
 *  silently makes the top result unreachable. */
export function rollQty(min: number, max: number, rng: Rng): number {
  const lo = Math.max(0, Math.floor(min))
  const hi = Math.max(lo, Math.floor(max))
  return lo + Math.floor(rng() * (hi - lo + 1))
}

/** Did this row come up? `rng() * 100 < chance`, so chance 0 never fires and
 *  chance 100 always does — the two ends a DM will actually type. */
export const rowHits = (chance: number, rng: Rng): boolean => rng() * 100 < chance

export function rollLoot(
  table: LootTable,
  catalog: Map<string, CatalogItemData>,
  rng: Rng = Math.random,
): LootResult {
  const outcomes: LootOutcome[] = []
  const items: LootResult['items'] = []
  const coins = { gold: 0, silver: 0, copper: 0 }
  const missing: string[] = []

  for (const row of table.rows ?? []) {
    /* The chance roll happens FIRST and ALWAYS, even for a row that will turn
       out to be broken — so the number of rng() calls depends only on the
       number of rows. A generator consumed conditionally is one whose sequence
       shifts when an unrelated row changes, and every test of it becomes a
       puzzle. */
    const hit = rowHits(row.chance, rng)
    if (!hit) {
      outcomes.push({ row, hit: false, qty: 0 })
      continue
    }
    const qty = rollQty(row.min, row.max, rng)

    if (row.kind === 'coin') {
      coins[row.coin] += qty
      outcomes.push({ row, hit: true, qty })
      continue
    }

    const data = catalog.get(row.item_id)
    if (!data) {
      // Reported, never silently dropped: the table is broken and the DM is
      // the only one who can fix it. Yielding less and saying nothing reads as
      // bad luck.
      missing.push(row.item_id)
      outcomes.push({ row, hit: true, qty, missing: true })
      continue
    }
    // A quantity of zero is a hit that yielded nothing — legal (a 0-2 range)
    // and worth showing in the preview, but not worth granting.
    if (qty > 0) items.push({ item_id: row.item_id, data, qty })
    outcomes.push({ row, hit: true, qty, name: data.name })
  }

  return { outcomes, items, coins, missing }
}

/**
 * What this table yields on average, per roll.
 *
 * `Σ chance × (min + max) / 2`. The one number that says whether a table is
 * tuned: five rows at 5% each reads as a full table and produces nothing four
 * times out of five, and that is invisible until you either do this arithmetic
 * or roll it twenty times.
 */
export function expectedYield(table: LootTable): {
  items: number
  coins: { gold: number; silver: number; copper: number }
} {
  let itemCount = 0
  const coins = { gold: 0, silver: 0, copper: 0 }
  for (const row of table.rows ?? []) {
    const p = Math.max(0, Math.min(100, row.chance)) / 100
    const mean = (Math.max(0, row.min) + Math.max(row.min, row.max)) / 2
    if (row.kind === 'coin') coins[row.coin] += p * mean
    else itemCount += p * mean
  }
  return { items: itemCount, coins }
}

/** The chance this table yields absolutely nothing — every row missing at once.
 *  Reads better than the expected yield for the "why is this chest always
 *  empty" question, which is the one a DM actually asks. */
export function chanceOfNothing(table: LootTable): number {
  let p = 1
  for (const row of table.rows ?? []) p *= 1 - Math.max(0, Math.min(100, row.chance)) / 100
  return p
}
