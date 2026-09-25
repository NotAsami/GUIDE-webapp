// The Journal's bounty board, as data. Pure so the bucketing is tested rather
// than eyeballed; the screen only lays it out.
import type { HandoutRow, QuestRow, SessionRow } from './database.types'

export interface Board {
  /** Open notices, by rank. Personal quests sit among them (flag: character_id). */
  main: QuestRow[]
  side: QuestRow[]
  /** Completed and failed — the pile stamped DONE. */
  closed: QuestRow[]
  /** Handouts clipped behind the quest they belong to, newest on top. */
  clipped: Map<string, HandoutRow[]>
  /** Handouts with no quest, or whose quest this reader cannot see. */
  loose: HandoutRow[]
}

const newest = (a: HandoutRow, b: HandoutRow) =>
  (b.pushed_at ?? b.created_at).localeCompare(a.pushed_at ?? a.created_at)

/** `quests` and `handouts` must already be what THIS player may see
 *  (useCampaign / the handout hook filter them) — the board adds no gating. */
export function boardOf(quests: QuestRow[], handouts: HandoutRow[]): Board {
  const open = quests.filter(q => q.status === 'active')
  const seen = new Set(quests.map(q => q.id))
  const clipped = new Map<string, HandoutRow[]>()
  const loose: HandoutRow[] = []
  for (const h of [...handouts].sort(newest)) {
    if (h.quest_id && seen.has(h.quest_id)) clipped.set(h.quest_id, [...(clipped.get(h.quest_id) ?? []), h])
    else loose.push(h)
  }
  return {
    main: open.filter(q => q.type === 'main'),
    side: open.filter(q => q.type === 'side'),
    closed: quests.filter(q => q.status !== 'active'),
    clipped,
    loose,
  }
}

/** ref (quest or handout id) → the sessions that moved it, oldest first.
 *  Derived from sessions.links, never stored on the quest. Sessions wrapped
 *  before 0028 carry no links, so they simply never appear here. */
export function sessionsByRef(sessions: SessionRow[]): Map<string, SessionRow[]> {
  const out = new Map<string, SessionRow[]>()
  for (const s of [...sessions].sort((a, b) => a.num - b.num)) {
    for (const l of s.links ?? []) {
      const list = out.get(l.ref) ?? []
      if (!list.includes(s)) out.set(l.ref, [...list, s])
    }
  }
  return out
}

/** Session numbers on the board read as a chronicle: I, II, … XIV. */
export function roman(n: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n)
  let out = ''
  for (const [v, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
    while (n >= v) { out += s; n -= v }
  }
  return out
}

/** How a notice hangs: a fixed tilt and edge per quest, from its id — never
 *  random, or every realtime refetch would reshuffle the board. */
export function hang(id: string): { rot: number; edge: 0 | 1 | 2 } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  h = Math.abs(h)
  return { rot: ((h % 25) - 12) / 10, edge: (h % 3) as 0 | 1 | 2 }
}
