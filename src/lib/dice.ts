/** Dice primitives. Pure, side-effecting only via Math.random — call these from
 *  event handlers, never from render (StrictMode double-invokes render). */

/** Roll one die with `sides` faces → 1..sides. */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}

/** Parse a dice expression like "2d6", "d8", "3d4 + 3" or "-1d4" → { count,
 *  sides, mod }; null if invalid. `mod` is always present (0 when the expression
 *  has none) so callers that only destructure `{ count, sides }` are unaffected.
 *
 *  The leading sign is what makes Bane expressible: lib/graph.ts emits "-1d4" for
 *  a negative contribution, and the graph's only additive op is `add`, so there is
 *  no other spelling. A NEGATIVE `count` comes back — rollDice() floors at zero
 *  dice, so callers that ignore the sign roll nothing rather than misreporting;
 *  callers that subtract must use the sign themselves. */
export function parseDice(expr: string): { count: number; sides: number; mod: number } | null {
  const m = /^\s*(-?)\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(expr)
  if (!m) return null
  return {
    count: (m[1] ? -1 : 1) * (m[2] ? parseInt(m[2], 10) : 1),
    sides: parseInt(m[3], 10),
    mod: m[4] ? parseInt(m[4].replace(/\s/g, ''), 10) : 0,
  }
}

/** Roll `count` dice of `sides` faces; returns each individual result. */
export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => rollDie(sides))
}

/** Roll a heal/amount expression: a flat number, "2d4", or "2d4 + 2". Returns the
 *  total (floored at 0) and a human breakdown for the toast. */
export function rollHeal(amount: number | string): { total: number; breakdown: string } {
  if (typeof amount === 'number') return { total: Math.max(0, amount), breakdown: `${amount}` }
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(amount)
  if (!m) {
    const n = parseInt(amount, 10) || 0
    return { total: Math.max(0, n), breakdown: `${n}` }
  }
  const count = parseInt(m[1], 10)
  const sides = parseInt(m[2], 10)
  const mod = m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0
  const dice = rollDice(count, sides)
  const total = Math.max(0, dice.reduce((a, b) => a + b, 0) + mod)
  const modStr = mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)}` : ''
  return { total, breakdown: `${count}d${sides}(${dice.join(' + ')})${modStr}` }
}
