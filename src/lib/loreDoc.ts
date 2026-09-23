/** The Lore article, read as a document: `#` groups, `##` sections, generated
 *  cards, and the per-section integrity G.U.I.D.E. keeps. Pure — no React —
 *  so the screen and the tests read it the same way.
 *
 *  The article is the ONE source. Cards are derived from it, never stored: a
 *  section whose every paragraph reads `**Name** - text` is shown as cards, so
 *  the author writes it once and nothing is typed twice. */

import type { QuestRow } from './database.types.ts'

export interface LoreCard {
  name: string
  /** A parenthetical after the name — `**Mira Saltwhisper** (Guild Office) - …`. */
  note?: string
  text: string
  /** The `**Likes:**` / `**Dislikes:**` label the card sits under, if any. */
  label?: string
}
export interface LoreSection { name: string; id: string; body: string; cards: LoreCard[] | null }
export interface LoreGroup { name: string; id: string; sections: LoreSection[] }
/** `groups` is empty when the article has no headings at all — it is then just
 *  prose, and the screen shows no contents rail. */
export interface LoreDoc { intro: string; groups: LoreGroup[] }

const CARD_RE = /^\*\*([^*\n]+?)\*\*\s*(?:\(([^)\n]*)\))?\s+[-–—]\s+([\s\S]+)$/
const LABEL_RE = /^\*\*([^*\n]+?):\*\*$/

/** Cards for a section body, or null when it is prose. ALL-or-nothing: one
 *  matching line inside a prose section must not turn into a card, and two
 *  cards is the least that reads as a set. */
export function cardsOf(body: string): LoreCard[] | null {
  const cards: LoreCard[] = []
  let label: string | undefined
  for (const block of blocksOf(body)) {
    const l = LABEL_RE.exec(block)
    if (l) { label = l[1].trim(); continue }
    const m = CARD_RE.exec(block)
    if (!m) return null
    cards.push({ name: m[1].trim(), ...(m[2] ? { note: m[2].trim() } : {}), text: m[3].trim(), ...(label ? { label } : {}) })
  }
  return cards.length >= 2 ? cards : null
}

const blocksOf = (s: string) => s.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'

export function parseLore(md: string | undefined | null): LoreDoc {
  const doc: LoreDoc = { intro: '', groups: [] }
  const intro: string[] = []
  const used = new Set<string>()
  const uid = (name: string) => { let id = slug(name), n = 2; while (used.has(id)) id = `${slug(name)}-${n++}`; used.add(id); return id }
  let group: LoreGroup | null = null
  let section: { name: string; id: string; blocks: string[] } | null = null
  const close = () => {
    if (!section) return
    const body = section.blocks.join('\n\n')
    group!.sections.push({ name: section.name, id: section.id, body, cards: cardsOf(body) })
    section = null
  }
  for (const block of blocksOf(md ?? '')) {
    for (const piece of splitHeadings(block)) {
      const h1 = /^#\s+(.+)$/.exec(piece), h2 = /^##\s+(.+)$/.exec(piece)
      if (h1) { close(); group = { name: h1[1].trim(), id: uid(h1[1]), sections: [] }; doc.groups.push(group); continue }
      if (h2) {
        close()
        // A `##` before any `#` still gets a group, just an unnamed one.
        if (!group) { group = { name: '', id: uid('record'), sections: [] }; doc.groups.push(group) }
        section = { name: h2[1].trim(), id: uid(h2[1]), blocks: [] }
        continue
      }
      if (/^-{3,}$/.test(piece)) continue          // a divider between groups; the group heading already draws one
      if (section) section.blocks.push(piece)
      else if (group) {                              // prose directly under a `#`: an untitled first section
        section = { name: '', id: uid(`${group.name}-intro`), blocks: [piece] }
      } else intro.push(piece)
    }
  }
  close()
  doc.intro = intro.join('\n\n')
  return doc
}

/** A heading line starts its own piece even without a blank line around it,
 *  the same rule Prose follows. */
function splitHeadings(block: string): string[] {
  const out: string[] = []
  let para: string[] = []
  for (const line of block.split('\n')) {
    if (/^#{1,2}\s+/.test(line)) { if (para.length) out.push(para.join('\n')); para = []; out.push(line) }
    else para.push(line)
  }
  if (para.length) out.push(para.join('\n'))
  return out
}

/* ── Integrity: how much of a memory G.U.I.D.E. has left in ink ─────────────
   Stored as `lore.integrity[sectionName] = 0..100`, 100 when absent. Keyed by
   the heading text, so RENAMING a heading orphans its value — acceptable while
   the evolution system that will own these numbers is still being designed. */

export function integrityOf(map: Record<string, number> | undefined, name: string): number {
  const v = map?.[name]
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100
}

/** The record's overall integrity: sections weighted by how much they say. */
export function overallIntegrity(doc: LoreDoc, map: Record<string, number> | undefined): number {
  let total = 0, kept = 0
  for (const g of doc.groups) for (const s of g.sections) {
    const w = s.body.length
    total += w; kept += w * integrityOf(map, s.name) / 100
  }
  return total ? Math.round((kept / total) * 100) : 100
}

/* ── The creep: letters falling to 1s and 0s ────────────────────────────────
   Each letter has a fixed threshold in [0,1); it stays ink while the threshold
   is under what remains. Near that line the cut wobbles with the tick, so the
   frontier flickers — but 100% is ALWAYS all ink and 0% ALWAYS all bits. */

export interface CreepRun { t: string; bit: boolean; hot?: boolean }

const unit = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }
const bitAt = (i: number, tick: number) => ((i * 31 + tick * 7 + (i >> 2)) % 5 < 2 ? '1' : '0')

/** `start` is the index of the first letter, so a passage split into
 *  paragraphs keeps each letter's threshold wherever the breaks fall. */
export function creep(text: string, remaining: number, tick: number, start = 0): CreepRun[] {
  const r = Math.max(0, Math.min(100, remaining)) / 100
  const out: CreepRun[] = []
  let i = start
  for (const ch of text) {
    const idx = i++
    const cut = r >= 1 ? 1 : r <= 0 ? 0 : Math.min(1, Math.max(0, r + 0.035 * Math.sin(tick * 0.9 + idx)))
    const ink = /\s/.test(ch) || unit(idx) < cut
    const run: CreepRun = ink ? { t: ch, bit: false } : { t: bitAt(idx, tick), bit: true, ...(unit(idx + tick * 13) > 0.96 ? { hot: true } : {}) }
    const last = out[out.length - 1]
    if (last && last.bit === run.bit && !last.hot && !run.hot) last.t += run.t
    else out.push(run)
  }
  return out
}

/** Markdown down to the words a reader sees — the creep works on letters, and
 *  a `**` falling to a 1 would be a bit of syntax, not of memory. */
export function plainText(md: string): string {
  return md.replace(/\*\*\*|\*\*|\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\{[^}]*\}/g, '$1')
}

/* ── Places: derived, never authored (for now) ──────────────────────────────
   Every quest location, plus the character's homeland. A DM-written place
   description would need its own table; until then a place is what the quest
   log and the character sheet already say about it. */

export interface LorePlace { name: string; home: boolean; quests: Pick<QuestRow, 'id' | 'title' | 'status'>[]; people: string[] }

export function placesOf(quests: Pick<QuestRow, 'id' | 'title' | 'status' | 'location' | 'given_by'>[], homeland?: string | null): LorePlace[] {
  const by = new Map<string, LorePlace>()
  const at = (name: string) => {
    const k = name.trim().toLowerCase()
    let p = by.get(k)
    if (!p) { p = { name: name.trim(), home: false, quests: [], people: [] }; by.set(k, p) }
    return p
  }
  if (homeland?.trim()) at(homeland).home = true
  for (const q of quests) {
    if (!q.location?.trim()) continue
    const p = at(q.location)
    p.quests.push({ id: q.id, title: q.title, status: q.status })
    const giver = q.given_by?.trim()
    if (giver && !p.people.includes(giver)) p.people.push(giver)
  }
  return [...by.values()].sort((a, b) => Number(b.home) - Number(a.home) || b.quests.length - a.quests.length)
}
