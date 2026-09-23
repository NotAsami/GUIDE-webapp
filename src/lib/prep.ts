/**
 * The session prep board's own logic, tested in prep.test.ts: what a card's
 * button says, where a dragged card lands, and the line a fired card writes
 * into the session log.
 *
 * Everything a card DOES belongs to the system that already owns it — a shop
 * opens through useDmShops, a handout through pushPatch, a quest through its
 * `visible` flag (0026). A card holds a reference and a time, nothing else.
 */
import type { PlanCardKind, PlanCardRow } from './database.types.ts'

/** What the button on a staged card says. A quest that the party can already
 *  see has nothing left to reveal, so the card closes it instead. */
export function fireLabel(kind: PlanCardKind, opts: { questVisible?: boolean } = {}): string {
  switch (kind) {
    case 'shop': return 'Open'
    case 'loot': return 'Roll'
    case 'handout': return 'Push'
    case 'npc': return 'Reveal'
    case 'quest': return opts.questVisible ? 'Complete' : 'Reveal'
    case 'note': return 'Mark played'
  }
}

/** Past tense, for the played column. A quest card is told what it DID —
 *  `questClosed` — not what the quest looks like now: after a reveal the quest
 *  is visible, so reading visibility here called every reveal a closure. */
export function firedLabel(kind: PlanCardKind, opts: { questClosed?: boolean } = {}): string {
  switch (kind) {
    case 'shop': return 'Opened'
    case 'loot': return 'Rolled and pushed'
    case 'handout': return 'Pushed'
    case 'npc': return 'Revealed'
    case 'quest': return opts.questClosed ? 'Closed' : 'Revealed'
    case 'note': return 'Played'
  }
}

/** Who a card is aimed at, in words. Empty target = the whole party, which is
 *  what every one of these mechanisms means by "no one named". */
export function targetNames(target: string[], names: Map<string, string>): string {
  if (!target.length) return 'the party'
  const list = target.map(id => names.get(id) ?? 'someone')
  return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** The line a fired card offers for the session log. The DM edits these — they
 *  are a first draft of what happened, not a record of what the app did. */
export function eventText(card: Pick<PlanCardRow, 'kind' | 'title' | 'target'>, names: Map<string, string>): string {
  const who = targetNames(card.target, names)
  const title = card.title.trim() || 'Something'
  switch (card.kind) {
    case 'shop': return `${title} opened for ${who}.`
    case 'loot': return `${who === 'the party' ? 'The party' : who} searched ${title}.`
    case 'handout': return `${title} reached ${who}.`
    case 'npc': return `${who === 'the party' ? 'The party' : who} learned of ${title}.`
    case 'quest': return `${title} began.`
    case 'note': return title.endsWith('.') ? title : `${title}.`
  }
}

/** A quest card that closes a quest rather than revealing it says so instead. */
export const questClosedText = (title: string) => `${title.trim() || 'A quest'} was closed.`

/** The events a wrap offers, in the order they were played. `questClosed` asks
 *  whether that card's quest ended, not whether it is visible. */
export function planEvents(cards: PlanCardRow[], names: Map<string, string>, questClosed: (ref: string | null) => boolean): string[] {
  return cards
    .filter(c => c.fired_at)
    .sort((a, b) => (a.fired_at! < b.fired_at! ? -1 : 1))
    .map(c => (c.kind === 'quest' && questClosed(c.ref) ? questClosedText(c.title) : eventText(c, names)))
}

/* ---- hand ordering ---- */

/** Where a card dropped between two others sits. Fractional, so moving one card
 *  writes ONE row: renumbering the whole list on every drag is how a run sheet
 *  ends up fighting the DM mid-session. */
export function sortBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** The new sort for `id` moved to index `to` in the current order. */
export function moveTo(cards: Pick<PlanCardRow, 'id' | 'sort'>[], id: string, to: number): number | null {
  const list = [...cards].sort((a, b) => a.sort - b.sort)
  const from = list.findIndex(c => c.id === id)
  if (from < 0) return null
  const without = list.filter(c => c.id !== id)
  const at = Math.max(0, Math.min(to, without.length))
  const sort = sortBetween(without[at - 1]?.sort, without[at]?.sort)
  return sort === list[from]!.sort ? null : sort
}

/** Staged first in the DM's order, then what has been played, newest last. */
export function split(cards: PlanCardRow[]): { staged: PlanCardRow[]; played: PlanCardRow[] } {
  return {
    staged: cards.filter(c => !c.fired_at).sort((a, b) => a.sort - b.sort),
    played: cards.filter(c => c.fired_at).sort((a, b) => (a.fired_at! < b.fired_at! ? 1 : -1)),
  }
}
