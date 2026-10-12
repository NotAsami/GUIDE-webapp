/**
 * RENAMES — "at level 7, Fire Bolt is a Fire Beam".
 *
 * A `rename` graph effect changes what a spell, item or feature is CALLED while
 * its `when` holds. It is a display change and must never become a stored one:
 * drop the feature and the old name has to come back. So it is applied in
 * exactly two places, mirror images of each other:
 *
 *   applyRenames  — Layout runs it on the row every player screen reads, so
 *                   every render path shows the new name with nothing to opt in.
 *   stripRenames  — lib/character.ts runs it on every patch before the write,
 *                   so a screen that spreads a renamed spell back into its
 *                   section cannot persist the new name.
 *
 * A renamed object carries its original under `__baseName` (and where the name
 * came from), which is what strip restores and what name-keyed lookups
 * (`has<Feature>` in graph.ts, prerequisites in feats.ts) read instead.
 */
import type { CharacterRow, EquippedGear, EquippedItem, Feature, InventoryItem, ShardTree, Spell } from './database.types.ts'
import { buildContext, gid, normalizeTag, type GidKind, type GraphContext } from './graph.ts'
import { evalExpr, interpolate } from './expr.ts'
import { ITEM_SLOTS } from './equip.ts'

/** What a renamed copy carries beside its new `name`. */
export type RenameMark = {
  /** The stored name. Present (possibly undefined) on every renamed copy. */
  __baseName?: string
  /** The feature / item / shard node the rename is authored on. */
  __renamedBy?: string
  /** The rename's "What changed" sentence, interpolated, when it has one. */
  __renameText?: string
}
const MARKS = ['__baseName', '__renamedBy', '__renameText'] as const

/** The name to MATCH on — the stored one, whatever the object is shown as. */
export const baseName = (o: { name?: string } & RenameMark): string | undefined =>
  '__baseName' in o ? o.__baseName : o.name

type Named = { name?: string; tags?: string[]; feature_id?: string; spell_id?: string; item_id?: string; id?: string }

function renameFor(ctx: GraphContext, kinds: GidKind[], obj: Named): { to: string; by: string; text?: string } | null {
  const keys = [...kinds.map(k => gid(k, obj)), ...(obj.tags ?? []).map(t => `tag:${normalizeTag(t)}`)]
  for (const k of keys) {
    for (const { eff, from } of ctx.index.get(k) ?? []) {
      if (eff.op !== 'rename' || !eff.to?.trim()) continue
      if (eff.when?.trim()) {
        const v = evalExpr(eff.when, ctx.scope)
        if (!v || v.t !== 'bool' || !v.v) continue
      }
      return {
        to: interpolate(eff.to, ctx.scope).text.trim(),
        by: from.obj.name,
        text: eff.text?.trim() ? interpolate(eff.text, ctx.scope).text : undefined,
      }
    }
  }
  return null
}

/** The row with every active rename applied. Returns the SAME object when
 *  nothing is renamed, so a character with no renames re-renders nothing. */
export function applyRenames(row: CharacterRow, shardTrees: Record<string, ShardTree> = {}): CharacterRow {
  const ctx = buildContext(row, shardTrees)
  let any = false
  for (const list of ctx.index.values()) if (list.some(e => e.eff.op === 'rename')) { any = true; break }
  if (!any) return row

  let changed = false
  const mark = <T extends Named>(o: T | null | undefined, kinds: GidKind[]): T | null | undefined => {
    if (!o) return o
    const r = renameFor(ctx, kinds, o)
    if (!r || !r.to || r.to === o.name) return o
    changed = true
    const out: T & RenameMark = { ...o, name: r.to, __baseName: o.name, __renamedBy: r.by }
    if (r.text) out.__renameText = r.text
    return out
  }

  const spells = row.spellbook?.spells?.map(s => mark(s, ['spell']) as Spell)
  const features = row.sheet?.features?.map(f => mark(f, ['feature']) as Feature)
  const inventory = (row.inventory as unknown as InventoryItem[] | null)?.map(i => mark(i, ['item']) as InventoryItem)
  const gear = { ...((row.equipped ?? {}) as EquippedGear) }
  for (const k of ITEM_SLOTS) if (gear[k]) gear[k] = mark(gear[k], ['item']) as EquippedItem
  if (gear.weapons) gear.weapons = gear.weapons.map(w => mark(w, ['weapon', 'item'])!)
  if (gear.containers) {
    gear.containers = Object.fromEntries(Object.entries(gear.containers).map(([k, c]) => [k, mark(c, ['item'])])) as EquippedGear['containers']
  }

  if (!changed) return row
  return {
    ...row,
    sheet: row.sheet ? { ...row.sheet, features } : row.sheet,
    spellbook: row.spellbook ? { ...row.spellbook, spells } : row.spellbook,
    inventory: inventory as unknown as CharacterRow['inventory'],
    equipped: gear as CharacterRow['equipped'],
  }
}

/** A patch with every rename undone: renamed copies get their stored name back
 *  and lose the marks. Untouched values come back as the same objects. */
export function stripRenames<T>(v: T): T {
  if (Array.isArray(v)) {
    let ch = false
    const out = v.map(x => { const y = stripRenames(x); if (y !== x) ch = true; return y })
    return (ch ? out : v) as T
  }
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    let ch = false
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(src)) {
      if ((MARKS as readonly string[]).includes(k)) { ch = true; continue }
      const y = stripRenames(x)
      if (y !== x) ch = true
      out[k] = y
    }
    if ('__baseName' in src) {
      if (src.__baseName === undefined) delete out.name
      else out.name = src.__baseName
    }
    return (ch ? out : v) as T
  }
  return v
}
