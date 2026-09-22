/**
 * The console's handout verbs as pure patches, and the two reads the player
 * side makes of a row. Split from handouts.ts so node --test can load it
 * without the Supabase client. See handouts.ts for what each verb means.
 */
import type { HandoutRow, HandoutUpdate } from './database.types'

type Held = Pick<HandoutRow, 'recipients' | 'on_screen'>

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])]

/** Replaces `on_screen` rather than adding to it: "push to PC 2" means PC 2's
 *  screen now, not Ros's as well because Ros was shown it an hour ago. */
export function pushPatch(h: Held, ids: string[], at = new Date().toISOString()): HandoutUpdate {
  return { recipients: union(h.recipients, ids), on_screen: [...new Set(ids)], pushed_at: at }
}
export function filePatch(h: Held, ids: string[]): HandoutUpdate {
  return { recipients: union(h.recipients, ids) }
}
export const RECALL: HandoutUpdate = { on_screen: [] }
/** Both arrays, because the table holds on_screen ⊆ recipients — dropping
 *  someone from recipients alone would fail the check constraint. */
export function takeBackPatch(h: Held, ids: string[]): HandoutUpdate {
  const out = (x: string) => !ids.includes(x)
  return { recipients: h.recipients.filter(out), on_screen: h.on_screen.filter(out) }
}

export type HandoutState = 'draft' | 'filed' | 'live'
export const stateOf = (h: Held): HandoutState =>
  h.on_screen.length ? 'live' : h.recipients.length ? 'filed' : 'draft'

/** The handout that should be open on this character's screen: their LATEST
 *  push, unless they dismissed that push. It never falls through to an older
 *  one — closing the newest handout must not pop up last hour's because the DM
 *  never recalled it. */
export function liveFor(handouts: HandoutRow[], charId: string, dismissed: Set<string>): HandoutRow | null {
  let latest: HandoutRow | null = null
  for (const h of handouts) {
    if (!h.pushed_at || !h.on_screen.includes(charId)) continue
    if (!latest || h.pushed_at > latest.pushed_at!) latest = h
  }
  return latest && !dismissed.has(pushKey(latest)) ? latest : null
}
/** A dismissal is of ONE push. The next push has a new pushed_at, so it opens. */
export const pushKey = (h: Pick<HandoutRow, 'id' | 'pushed_at'>) => `${h.id}@${h.pushed_at}`

