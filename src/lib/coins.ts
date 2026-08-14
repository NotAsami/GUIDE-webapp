/**
 * Coin-purse math (1gp = 10sp = 100cp). Display/affordability only — `shop_buy`
 * (migration 0009) does the authoritative spend server-side and re-splits the
 * remainder the same way, so this has to match its rounding exactly.
 */
import type { CharacterSheet } from './database.types'

export type Coins = NonNullable<CharacterSheet['coins']>

export function toCopper(coins: Coins | undefined): number {
  return (coins?.gold ?? 0) * 100 + (coins?.silver ?? 0) * 10 + (coins?.copper ?? 0)
}

/** Re-split into the fewest denominations — mirrors shop_buy's make-change. */
export function fromCopper(cp: number): Coins {
  const rem = Math.max(0, Math.trunc(cp))
  return { gold: Math.trunc(rem / 100), silver: Math.trunc((rem % 100) / 10), copper: rem % 10 }
}

export function canAfford(coins: Coins | undefined, priceGp: number): boolean {
  return toCopper(coins) >= priceGp * 100
}

export type PriceUnit = 'gp' | 'sp' | 'cp'

/** cp-per-unit — MUST match `shop_buy`'s (migration 0009/0012) multiplier
 *  exactly, or the client's "can I afford this" preview drifts from what the
 *  server actually charges. */
const UNIT_CP: Record<PriceUnit, number> = { gp: 100, sp: 10, cp: 1 }

/** A shop/catalog `price` + `unit` pair, flattened to copper. */
export function priceCp(price: number, unit: PriceUnit | undefined): number {
  return price * UNIT_CP[unit ?? 'gp']
}

/** Player-facing "12 gp" / "5 sp" — unit defaults to gp, same as priceCp. */
export function formatPrice(price: number, unit: PriceUnit | undefined): string {
  return `${price.toLocaleString()} ${unit ?? 'gp'}`
}

// Dev-only self-check (no test runner in this repo — see CLAUDE.md) so a
// broken round-trip or off-by-one in the split shows up in the console the
// next time anyone runs `npm run dev`, not silently at the table.
if (import.meta.env?.DEV) {
  console.assert(toCopper({ gold: 1, silver: 2, copper: 3 }) === 123, 'coins: toCopper')
  console.assert(toCopper(undefined) === 0, 'coins: toCopper undefined')
  const back = fromCopper(toCopper({ gold: 3, silver: 4, copper: 5 }))
  console.assert(back.gold === 3 && back.silver === 4 && back.copper === 5, 'coins: round-trip')
  console.assert(canAfford({ gold: 0, silver: 9, copper: 10 }, 1), 'coins: exact afford')
  console.assert(!canAfford({ gold: 0, silver: 9, copper: 9 }, 1), 'coins: short by 1cp')
  console.assert(priceCp(5, 'gp') === 500, 'coins: priceCp gp')
  console.assert(priceCp(5, 'sp') === 50, 'coins: priceCp sp')
  console.assert(priceCp(5, 'cp') === 5, 'coins: priceCp cp')
  console.assert(priceCp(5, undefined) === 500, 'coins: priceCp defaults to gp')
}
