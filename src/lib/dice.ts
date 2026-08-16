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

/** One die as it sits in a roll record.
 *
 *  `sides` travels WITH the die rather than being recovered from the expression
 *  that produced it — a d20 pair and a 2d6 damage roll end up in the same
 *  renderer, and asking it to re-parse "2d6" to learn what a chip means is how
 *  a 6 gets drawn as a maximum roll on a d8.
 *
 *  `orig` is the FIRST face this die showed, written once. Rerolling twice must
 *  still be able to say what it originally was, so a reroll never overwrites an
 *  `orig` that is already set.
 *
 *  `crit` marks a die that exists ONLY because the attack critted — the extra
 *  half of a doubled damage roll. The panel paints those apart so "why is this
 *  2d12" answers itself. */
export type RolledDie = {
  v: number; sides: number
  orig?: number; rerolled?: boolean
  crit?: boolean
}

export const rolledDice = (count: number, sides: number): RolledDie[] =>
  rollDice(count, sides).map(v => ({ v, sides }))

/** Reroll one die, preserving the face it first showed. */
export const rerollDie = (d: RolledDie): RolledDie =>
  ({ ...d, v: rollDie(d.sides), orig: d.orig ?? d.v, rerolled: true })

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

/** Roll a list of graph dice terms ("1d4", "-1d4") to individual results.
 *
 *  The sign is the subtle part and the reason this is shared rather than
 *  written per caller: parseDice returns a SIGNED count, so Bane's "-1d4" comes
 *  back as negative numbers and subtracts when summed. A caller that took
 *  Math.abs would silently turn a penalty into a bonus.
 *
 *  `double` re-rolls the same count again, for damage dice on a critical hit. */
export function rollDiceTerms(exprs: string[], double = false): number[] {
  return exprs.flatMap(expr => {
    const p = parseDice(expr)
    if (!p) return []
    const sign = p.count < 0 ? -1 : 1
    const rolled = rollDice(Math.abs(p.count) * (double ? 2 : 1), p.sides).map(v => v * sign)
    return p.mod ? [...rolled, p.mod] : rolled
  })
}

/** The same roll, as dice that remember what they are — for anything a player
 *  will SEE as chips (rider results) rather than just add up.
 *
 *  A term's trailing `mod` is dropped rather than rendered as a die, because it
 *  isn't one. Graph dice never carry one: lib/expr.ts splits a formula into a
 *  flat part and dice terms before this ever sees it, and the flat part rides on
 *  the rider itself. */
export function rolledDiceTerms(exprs: string[], double = false): RolledDie[] {
  return exprs.flatMap(expr => {
    const p = parseDice(expr)
    if (!p) return []
    const sign = p.count < 0 ? -1 : 1
    return rollDice(Math.abs(p.count) * (double ? 2 : 1), p.sides)
      .map(v => ({ v: v * sign, sides: p.sides }))
  })
}
