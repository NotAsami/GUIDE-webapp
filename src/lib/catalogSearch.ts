/**
 * Catalog list filtering — name and tag search for the DM's authoring indexes,
 * and the query language behind every "pick items by description" surface:
 * starting-kit pools, loot table pool rows, and shop stock generation.
 *
 * Tags are the same free-text targeting tags an item already carries (they are
 * what `tag:` selectors resolve against), normalised through lib/graph.ts's
 * normalizeTag so a query matches however the tag was typed when authored.
 *
 * ## The grammar
 *
 *   fire                  plain term — matches the NAME, or any tag
 *   tag:fire              narrows to tags only, for when a name would collide
 *   !relic     !tag:cursed    either form, negated
 *
 * Terms are separated by spaces and **AND** together: every positive term must
 * match, and no negative term may. So `tag:martial !relic` is "martial weapons,
 * but not the relics among them" — which is the case this grammar was widened
 * for. OR is deliberately absent: two loot rows, or two pools, already express
 * it, and a precedence rule between `!` and an `or` keyword is a language.
 *
 * Plain terms deliberately cover tags too: the point of the box is to find a
 * thing, and making someone remember which field a word lives in to find it
 * again is the annoyance the box exists to remove. `tag:` is there for when
 * that breadth is what's in the way.
 *
 * ## Why splitting on spaces did not break `tag:fire damage`
 *
 * Before terms existed, everything after `tag:` was one value, so a tag could be
 * typed with the space it reads with. Splitting turns that into `tag:fire` AND
 * `damage` — and it still matches, because the second term is a plain one and
 * plain terms match tags. Authored tags never contain a space anyway
 * (normalizeTag folds them to underscores), so the only thing lost is a form
 * that resolved to the same answer by a different route.
 */

import { normalizeTag } from './graph.ts'

export type QueryTerm = {
  /** `!` prefix — the entry must NOT match this term. */
  neg: boolean
  /** `tag:` restricts to tags; `any` matches the name or any tag. */
  field: 'any' | 'tag'
  value: string
}

export type CatalogQuery =
  | { mode: 'all' }
  | { mode: 'terms'; terms: QueryTerm[] }

/** One whitespace-separated token → a term, or null if it carries no filter
 *  yet. A bare `tag:`, a lone `!`, or `!tag:` is mid-typing: dropping it beats
 *  blanking the list on the keystroke before the useful one arrives. */
function parseTerm(token: string): QueryTerm | null {
  let rest = token
  let neg = false
  if (rest.startsWith('!')) { neg = true; rest = rest.slice(1) }

  const m = /^tag:(.*)$/i.exec(rest)
  if (m) {
    const value = normalizeTag(m[1])
    return value ? { neg, field: 'tag', value } : null
  }
  const value = rest.trim().toLowerCase()
  return value ? { neg, field: 'any', value } : null
}

/** An empty or whitespace-only box matches everything, so the list is whole. */
export function parseCatalogQuery(raw: string): CatalogQuery {
  const terms = raw.trim().split(/\s+/).map(parseTerm).filter((t): t is QueryTerm => t !== null)
  return terms.length ? { mode: 'terms', terms } : { mode: 'all' }
}

/** Does one term match, ignoring its `neg` flag? Substring, not exact: typing
 *  "fir" should already be narrowing toward fire_damage. */
function termHits(term: QueryTerm, name: string, tags: string[]): boolean {
  if (term.field === 'tag') return tags.some(t => t.includes(term.value))
  return name.includes(term.value) || tags.some(t => t.includes(term.value))
}

/** Does this catalog entry survive the query? Every positive term must hit and
 *  no negative one may — an entry is kept only if it is everything asked for
 *  and nothing ruled out. */
export function matchesCatalogQuery(
  entry: { name?: string; tags?: string[] }, q: CatalogQuery,
): boolean {
  if (q.mode === 'all') return true

  const tags = (entry.tags ?? []).map(normalizeTag)
  const name = (entry.name ?? '').toLowerCase()

  for (const term of q.terms) {
    if (termHits(term, name, tags) === term.neg) return false
  }
  return true
}

/**
 * Does the query say anything about what to INCLUDE?
 *
 * `!relic` alone is a legitimate thing to type in a search box — "everything
 * except the relics" — and a mistake in a pool, where it means "every item in
 * the game, minus a few". The surfaces that resolve a query into a stored list
 * use this to say so; the search boxes ignore it.
 */
export const hasPositiveTerm = (q: CatalogQuery): boolean =>
  q.mode === 'terms' && q.terms.some(t => !t.neg)
