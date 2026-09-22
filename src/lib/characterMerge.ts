/** Three-way merge for JSON character sections. Arrays are indivisible: merging
 * inventory or feature lists by index can duplicate or lose game resources. */
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (object(a) && object(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
  }
  return false
}

export class CharacterConflict extends Error {
  constructor(path: string) {
    super(`Another edit changed ${path || 'this character'}. Your change was not saved; review the latest values and try again.`)
  }
}

export function mergeCharacterValue(base: unknown, desired: unknown, current: unknown, path = ''): unknown {
  if (sameValue(base, desired)) return current
  if (sameValue(base, current)) return desired
  if (object(base) && object(desired) && object(current)) {
    const result = { ...current }
    for (const key of new Set([...Object.keys(base), ...Object.keys(desired)])) {
      const value = mergeCharacterValue(base[key], desired[key], current[key], path ? `${path}.${key}` : key)
      if (value === undefined) delete result[key]
      else result[key] = value
    }
    return result
  }
  throw new CharacterConflict(path)
}

export function mergeCharacterPatch<T extends object>(base: T, patch: Partial<T>, current: T): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined) continue
    result[key] = mergeCharacterValue(base[key], patch[key], current[key], String(key)) as T[keyof T]
  }
  return result
}
