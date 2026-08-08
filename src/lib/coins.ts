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
}
