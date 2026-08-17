/**
 * Catalog list filtering — name and tag search for the DM's authoring indexes.
 *
 * Tags are the same free-text targeting tags an item already carries (they are
 * what `tag:` selectors resolve against), normalised through lib/graph.ts's
 * normalizeTag so a query matches however the tag was typed when authored.
 *
 * Two forms, matching the Feature Editor's search so the two behave alike:
 *
 *   fire            plain text — matches the NAME, or any tag
 *   tag:fire        narrows to tags only, for when a name would collide
 *
 * Plain text deliberately covers tags too: the point of the box is to find a
 * thing, and making someone remember which field a word lives in to find it
 * again is the annoyance the box exists to remove. `tag:` is there for when
 * that breadth is what's in the way.
 */

import { normalizeTag } from './graph.ts'

export type CatalogQuery =
  | { mode: 'all' }
  | { mode: 'text'; value: string }
  | { mode: 'tag'; value: string }

/** An empty or whitespace-only box matches everything, so the list is whole. */
export function parseCatalogQuery(raw: string): CatalogQuery {
  const trimmed = raw.trim()
  if (!trimmed) return { mode: 'all' }

  const m = /^tag:(.*)$/i.exec(trimmed)
  if (m) {
    const value = normalizeTag(m[1])
    // A bare "tag:" is still being typed — treat it as no filter rather than
    // blanking the list on every keystroke toward "tag:fire".
    return value ? { mode: 'tag', value } : { mode: 'all' }
  }
  return { mode: 'text', value: trimmed.toLowerCase() }
}

/** Does this catalog entry survive the query? Substring, not exact: typing
 *  "fir" should already be narrowing toward fire_damage. */
export function matchesCatalogQuery(
  entry: { name?: string; tags?: string[] }, q: CatalogQuery,
): boolean {
  if (q.mode === 'all') return true

  const tags = (entry.tags ?? []).map(normalizeTag)
  if (q.mode === 'tag') return tags.some(t => t.includes(q.value))

  const name = (entry.name ?? '').toLowerCase()
  return name.includes(q.value) || tags.some(t => t.includes(q.value))
}
