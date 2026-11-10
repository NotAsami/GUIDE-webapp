/**
 * "The same answer", for the side-by-side harness and shadow mode.
 *
 * Stricter than assert.deepEqual where the engines could quietly disagree, and
 * looser where a difference cannot be observed:
 *
 *   - numbers compare with Object.is, so -0 is not 0 and NaN is NaN
 *   - arrays, Maps and Sets compare IN ORDER
 *   - a key holding `undefined` equals a missing key (a Rider carries several,
 *     and neither JSON nor Postgres can tell the two apart)
 *   - object key order is ignored (jsonb reorders keys anyway)
 */
export function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b)
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => same(x, b[i]))
  }
  if (a instanceof Map || b instanceof Map) {
    return a instanceof Map && b instanceof Map && same([...a], [...b])
  }
  if (a instanceof Set || b instanceof Set) {
    return a instanceof Set && b instanceof Set && same([...a], [...b])
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (!same(x[k], y[k])) return false
  }
  return true
}

/** A call's outcome: what it returned, or that it threw. Two throws are the same
 *  outcome whatever they said — the engines word their errors differently. */
export type Outcome<T> = { ok: T } | { threw: unknown }

export function attempt<T>(f: () => T): Outcome<T> {
  try { return { ok: f() } } catch (threw) { return { threw } }
}

export const sameOutcome = (a: Outcome<unknown>, b: Outcome<unknown>): boolean =>
  'threw' in a || 'threw' in b ? 'threw' in a && 'threw' in b : same(a.ok, b.ok)
