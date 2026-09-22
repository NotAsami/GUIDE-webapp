/**
 * The NPC web — who knows whom — as pure functions, tested in npcWeb.test.ts.
 *
 *   derive()     three sources → one graph. PC relations (characters.lore),
 *                quest givers and quest mentions (quests), and the only stored
 *                ties, NPC ↔ NPC (npc_links). Everything matches by NAME,
 *                trimmed and case-insensitive, because every one of those
 *                sources has always named an NPC in free text.
 *   layout()     the orbit: the party at the centre, ring 1 = NPCs the party is
 *                tied to, ring 2 = NPCs known only through another NPC, sectors
 *                by location. Nothing about it is stored — no positions, no
 *                dragging — so adding an NPC can never leave the drawing stale.
 *   fitView() / focusView()   the one transform the screen applies.
 *
 * The overlap guard in the test uses nodeBox(), which is built from the same
 * constants the screen renders with, so the guard tracks the CSS rather than a
 * number somebody picked once.
 */
import type { CharacterRow, NpcLinkRow, NpcRow, QuestRow, RelatedTag, Relation } from './database.types.ts'

/** Relation vocabulary, shared with the Lore editor. "System · Bonded" is the
 *  one value with the amber G.U.I.D.E. styling. */
export const SYSTEM_TYPE = 'System · Bonded'
export const REL_TYPES = ['Ally', 'Mentor', 'Rival', 'Enigma', SYSTEM_TYPE]
/** NPC ↔ NPC ties use the same words, minus the one that only G.U.I.D.E. has. */
export const LINK_TYPES = REL_TYPES.filter(t => t !== SYSTEM_TYPE)
/** Click-to-cycle order for an attitude dot. Unset lands on 'friendly' first. */
export const ATTITUDE_CYCLE = ['friendly', 'neutral', 'wary', 'hostile'] as const
export const ATTITUDE_LABEL: Record<string, string> = { friendly: 'Friendly', neutral: 'Neutral', wary: 'Wary', hostile: 'Hostile' }

export const nameKey = (s: string | undefined | null) => (s ?? '').trim().toLowerCase()

/** The edge endpoint for ties that belong to the whole party (quests). */
export const PARTY = 'party'

export type TieKind = 'relation' | 'quest' | 'mention' | 'link'
export interface WebNode {
  id: string
  name: string
  /** The NPC record, or null for a name the app only knows from free text. */
  record: NpcRow | null
  ring: 1 | 2
  sector: string
  system: boolean
}
export interface WebEdge {
  id: string
  /** A PC id, PARTY, or a node id. */
  from: string
  to: string
  kind: TieKind
  label: string
  attitude?: string | null
  /** Quest ties: the quest is closed. */
  done?: boolean
  /** Link ties: the npc_links row. */
  linkId?: string
  /** Relation ties: the PC's own words about them (lore.relations[].desc, markdown). */
  desc?: string
}
export interface WebPc { id: string; name: string }
export interface Web { nodes: WebNode[]; edges: WebEdge[]; pcs: WebPc[] }

type PartyRow = Pick<CharacterRow, 'id' | 'name' | 'lore'>
type QuestLike = Pick<QuestRow, 'id' | 'title' | 'status' | 'location' | 'given_by' | 'related'>

export function derive(npcs: NpcRow[], links: NpcLinkRow[], party: PartyRow[], quests: QuestLike[]): Web {
  const records = new Map<string, NpcRow>()
  for (const r of npcs) {
    const k = nameKey(r.name)
    if (k && !records.has(k)) records.set(k, r)
  }
  const nodes = new Map<string, WebNode>()
  const givenAt = new Map<string, string>()
  const node = (name: string): WebNode => {
    const k = nameKey(name)
    let n = nodes.get(k)
    if (!n) {
      const record = records.get(k) ?? null
      n = { id: record ? `npc:${record.id}` : `name:${k}`, name: record?.name.trim() || name.trim(), record, ring: 2, sector: 'Unplaced', system: false }
      nodes.set(k, n)
    }
    return n
  }
  const edges: WebEdge[] = []

  for (const pc of party) {
    const rels = ((pc.lore ?? {}) as { relations?: Relation[] }).relations ?? []
    rels.forEach((r, i) => {
      if (!nameKey(r.name)) return
      const n = node(r.name)
      n.ring = 1
      if (r.type === SYSTEM_TYPE) n.system = true
      edges.push({ id: `rel:${pc.id}:${i}`, from: pc.id, to: n.id, kind: 'relation', label: r.type, attitude: r.attitude ?? null, desc: r.desc })
    })
  }

  for (const q of quests) {
    const done = q.status !== 'active'
    const tied = new Set<string>()
    if (nameKey(q.given_by)) {
      const n = node(q.given_by)
      n.ring = 1
      tied.add(n.id)
      const k = nameKey(q.given_by)
      if (q.location.trim() && !givenAt.has(k)) givenAt.set(k, q.location.trim())
      edges.push({ id: `quest:${q.id}`, from: PARTY, to: n.id, kind: 'quest', label: q.title, done })
    }
    for (const t of (q.related ?? []) as (RelatedTag | string)[]) {
      const name = typeof t === 'string' ? t : t.name
      // Related tags hold PLACES as often as people (Brettany, Castella). Only a
      // tag that names a recorded NPC is a tie; the rest stay place names.
      if (!records.has(nameKey(name))) continue
      const n = node(name)
      n.ring = 1
      if (tied.has(n.id)) continue
      tied.add(n.id)
      edges.push({ id: `mention:${q.id}:${n.id}`, from: PARTY, to: n.id, kind: 'mention', label: q.title, done })
    }
  }

  // Every record is on the web, tied to anyone or not.
  for (const r of records.values()) node(r.name)

  const byRecord = new Map<string, WebNode>()
  for (const n of nodes.values()) if (n.record) byRecord.set(n.record.id, n)
  for (const l of links) {
    const a = byRecord.get(l.a), b = byRecord.get(l.b)
    if (!a || !b) continue
    edges.push({ id: `link:${l.id}`, from: a.id, to: b.id, kind: 'link', label: l.label.trim() || l.kind, attitude: l.attitude, linkId: l.id })
  }

  for (const [k, n] of nodes) {
    n.sector = n.system ? 'System' : n.record?.location.trim() || givenAt.get(k) || 'Unplaced'
  }
  const list = [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { nodes: list, edges, pcs: party.map(p => ({ id: p.id, name: p.name })) }
}

/** System first, the places alphabetically, Unplaced last — stable, so a new
 *  NPC slots in rather than reshuffling the ring. */
export function sectorOrder(nodes: WebNode[]): string[] {
  const names = [...new Set(nodes.map(n => n.sector))]
  const rank = (s: string) => (s === 'System' ? 0 : s === 'Unplaced' ? 2 : 1)
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/* ---- geometry: the SAME numbers the screen renders with ---- */
export const NODE_SIZE = { 1: 36, 2: 30 } as const
export const PC_SIZE = 38
export const LABEL_W = 132
export const NAME_LINE = 17
export const SUB_LINE = 11
export const LABEL_GAP = 6
/** ponytail: an average glyph width for 14px EB Garamond, so the guard can tell
 *  a name that wraps to two lines from one that does not. An estimate — the
 *  label clamps at two lines, which is what makes it safe to be approximate. */
const CHAR_W = 6.6
export const nameLines = (name: string) => Math.min(2, Math.max(1, Math.ceil((name.length * CHAR_W) / LABEL_W)))

export interface Pt { x: number; y: number }
/** Spacing between PCs in the centre: a label apart across, a hexagon and its
 *  name apart down. */
const PC_STEP = { x: LABEL_W + 8, y: PC_SIZE + 34 }
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** What a node covers: its circle, then the name and a one-line caption under it. */
export function nodeBox(n: Pick<WebNode, 'name' | 'ring'>, p: Pt): Box {
  const s = NODE_SIZE[n.ring]
  return {
    x0: p.x - LABEL_W / 2, x1: p.x + LABEL_W / 2,
    y0: p.y - s / 2,
    y1: p.y + s / 2 + LABEL_GAP + nameLines(n.name) * NAME_LINE + LABEL_GAP / 2 + SUB_LINE,
  }
}

/** What a PC in the centre covers: the hexagon and its one-line name. */
export function pcBox(p: Pt): Box {
  return { x0: p.x - LABEL_W / 2, x1: p.x + LABEL_W / 2, y0: p.y - PC_SIZE / 2, y1: p.y + PC_SIZE / 2 + LABEL_GAP + NAME_LINE }
}

export interface Ellipse { rx: number; ry: number }
/** A place: its arc, and where its name is written — placed by layout(), clear
 *  of every label, so the screen never works that out for itself. */
export interface Sector { name: string; from: number; to: number; mid: number; at: Pt }

/* Place names: 8px JetBrains Mono at 0.3em tracking. ponytail: a per-character
   width, like CHAR_W — mono makes it a near-exact estimate. */
const SECTOR_CHAR = 7.4
const SECTOR_H = 12
export function sectorBox(s: Pick<Sector, 'name' | 'at'>): Box {
  const w = s.name.length * SECTOR_CHAR
  return { x0: s.at.x - w / 2, x1: s.at.x + w / 2, y0: s.at.y - SECTOR_H / 2, y1: s.at.y + SECTOR_H / 2 }
}
export interface Orbit {
  pos: Map<string, Pt>
  pcs: Map<string, Pt>
  w: number
  h: number
  cx: number
  cy: number
  /** Ring 1, and ring 2 only when someone is on it. */
  rings: Ellipse[]
  sectors: Sector[]
}

/** How round the rings are: 1 is a circle, the user's call (2026-09-22) over
 *  the first version's 0.67 oval. Lower it for a squash; the overlap guard
 *  holds for any value, because every spacing below is derived from it. */
export const ASPECT = 1
/** The smallest ring 1 that clears the party in the middle: two PCs side by
 *  side reach 136px out, and a node's label hangs 66px either side of it. */
const R1_MIN = 215
/** Ring 2 keeps this much clear of ring 1 — more than a label's width across,
 *  more than a label's height down — so an inner label never meets an outer node. */
const RING_GAP = 150
/** Arc a node needs along its ring for its label to clear its neighbour's. On
 *  a round ring two neighbours meet at every angle, not just side by side, so
 *  the room they need is the DIAGONAL of a label box (wide and tall at once) —
 *  the label's width alone let two nodes on a shallow slope overlap. */
const MIN_ARC = Math.hypot(LABEL_W, NODE_SIZE[1] + LABEL_GAP * 1.5 + 2 * NAME_LINE + SUB_LINE) + 4
/** Clear space around everything drawn: the drawing's size is measured from
 *  its contents, not guessed as margins around the ring. */
const PAD = 16

/** deg 0 = twelve o'clock, clockwise. */
export function onEllipse(cx: number, cy: number, e: Ellipse, deg: number): Pt {
  const a = (deg * Math.PI) / 180
  return { x: cx + e.rx * Math.sin(a), y: cy - e.ry * Math.cos(a) }
}
const scale = (e: Ellipse, f: number): Ellipse => ({ rx: e.rx * f, ry: e.ry * f })

export function layout(web: Web): Orbit {
  const order = sectorOrder(web.nodes)
  const members = (s: string, ring: 1 | 2) =>
    web.nodes.filter(n => n.sector === s && n.ring === ring)
  // A sector's arc follows its busiest ring, so a crowded place gets room on both.
  const weight = order.map(s => Math.max(1, members(s, 1).length, members(s, 2).length))
  const total = weight.reduce((a, b) => a + b, 0)

  // Grow a ring until its most crowded sector spaces nodes MIN_ARC apart —
  // measured on the SHORT radius, where an ellipse's arc is tightest. The world
  // grows and fitView scales it down; the labels never overlap to make it fit.
  const grow = (base: Ellipse, ring: 1 | 2) => {
    let f = 1
    order.forEach((s, j) => {
      const k = members(s, ring).length
      if (k < 2) return
      const span = (2 * Math.PI * weight[j]) / total
      f = Math.max(f, (k * MIN_ARC) / (span * base.ry))
    })
    return scale(base, f)
  }
  // Sized to who is actually on the web, not reserved in advance: the first
  // version kept a 420px outer ring even when nobody was on it, and the whole
  // drawing shrank to fit a ring that was empty.
  const r1 = grow({ rx: R1_MIN, ry: R1_MIN * ASPECT }, 1)
  const outerRing = web.nodes.some(n => n.ring === 2)
  const r2 = outerRing ? grow({ rx: r1.rx + RING_GAP, ry: r1.ry + RING_GAP * ASPECT }, 2) : null
  if (r2) {
    const clear = Math.max((r1.rx + RING_GAP) / r2.rx, (r1.ry + RING_GAP * ASPECT) / r2.ry)
    if (clear > 1) Object.assign(r2, scale(r2, clear))
  }
  const edge = r2 ?? r1

  // Positions first, around (0, 0); the drawing's bounds come after, from
  // what was actually placed.
  const pos = new Map<string, Pt>()
  const sectors: Sector[] = []
  let a0 = (-180 * weight[0]) / total   // the first sector centred on twelve o'clock
  order.forEach((s, j) => {
    const span = (360 * weight[j]) / total
    for (const ring of [1, 2] as const) {
      const list = members(s, ring)
      list.forEach((n, i) => pos.set(n.id, onEllipse(0, 0, ring === 1 ? r1 : r2!, a0 + (span * (i + 0.5)) / list.length)))
    }
    sectors.push({ name: s, from: a0, to: a0 + span, mid: a0 + span / 2, at: { x: 0, y: 0 } })
    a0 += span
  })

  // The party sits in the middle, side by side: two to a row, a short last row
  // centred. Stacked vertically (the first version), a PC's name landed on the
  // hexagon below it the moment the campaign had a second character.
  const pcs = new Map<string, Pt>()
  const perRow = Math.min(2, web.pcs.length)
  const rows = Math.ceil(web.pcs.length / Math.max(1, perRow))
  web.pcs.forEach((p, i) => {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, web.pcs.length - row * perRow)
    const col = i % perRow
    pcs.set(p.id, { x: (col - (inRow - 1) / 2) * PC_STEP.x, y: (row - (rows - 1) / 2) * PC_STEP.y })
  })

  // PLACE NAMES go just outside the outermost ring, pushed further out until
  // they clear every label. A node's name hangs BELOW it, so a place written
  // under a node at the bottom of the ring has to travel further than one at
  // the top — with ring 2 empty the first version wrote DAVELGUAY across The
  // Lady's name.
  const byId = new Map(web.nodes.map(n => [n.id, n]))
  const taken: Box[] = [...pos].map(([id, p]) => nodeBox(byId.get(id)!, p))
  const hit = (b: Box) => taken.some(t => b.x0 < t.x1 && t.x0 < b.x1 && b.y0 < t.y1 && t.y0 < b.y1)
  for (const sec of sectors) {
    for (let d = 24; d < 400; d += 6) {
      sec.at = onEllipse(0, 0, { rx: edge.rx + d, ry: edge.ry + d * ASPECT }, sec.mid)
      if (!hit(sectorBox(sec))) break
    }
    taken.push(sectorBox(sec))
  }

  const all: Box[] = [
    ...taken,
    ...[...pcs.values()].map(pcBox),
    { x0: -edge.rx, x1: edge.rx, y0: -edge.ry, y1: edge.ry },
  ]
  const minX = Math.min(...all.map(b => b.x0)) - PAD, maxX = Math.max(...all.map(b => b.x1)) + PAD
  const minY = Math.min(...all.map(b => b.y0)) - PAD, maxY = Math.max(...all.map(b => b.y1)) + PAD
  const shift = (p: Pt): Pt => ({ x: p.x - minX, y: p.y - minY })
  for (const [id, p] of pos) pos.set(id, shift(p))
  for (const [id, p] of pcs) pcs.set(id, shift(p))
  for (const sec of sectors) sec.at = shift(sec.at)
  const { x: cx, y: cy } = shift({ x: 0, y: 0 })
  const w = maxX - minX, h = maxY - minY

  return { pos, pcs, w, h, cx, cy, rings: r2 ? [r1, r2] : [r1], sectors }
}

/** Where an edge endpoint is drawn: a node, a PC, or the party's centre. */
export function endpoint(o: Orbit, id: string): Pt | undefined {
  return id === PARTY ? { x: o.cx, y: o.cy } : o.pos.get(id) ?? o.pcs.get(id)
}

/** A node, everything it is tied to, and the party if the party is one end. */
export function neighbourhood(web: Web, id: string): Set<string> {
  const out = new Set([id])
  for (const e of web.edges) {
    if (e.from === id) out.add(e.to)
    if (e.to === id) out.add(e.from)
  }
  return out
}

export interface View { x: number; y: number; k: number }

/** The whole web, as large as the pane allows but never above life size. */
export function fitView(o: Pick<Orbit, 'w' | 'h'>, paneW: number, paneH: number): View {
  const k = Math.min(1, paneW / o.w, paneH / o.h)
  return { k, x: (paneW - o.w * k) / 2, y: (paneH - o.h * k) / 2 }
}

/** ZOOM TO THE NEIGHBOURHOOD — the story overview's thread zoom, for a person:
 *  the selected NPC and everything tied to them, centred in the space the
 *  drawer leaves. Scales down if they do not fit; up to 1.2× if they do. */
export function focusView(o: Orbit, web: Web, id: string, pane: { w: number; h: number; drawer: number; top: number }): View {
  const PAD = 28
  const boxes: Box[] = []
  const byId = new Map(web.nodes.map(n => [n.id, n]))
  for (const nid of neighbourhood(web, id)) {
    const p = endpoint(o, nid)
    if (!p) continue
    const n = byId.get(nid)
    boxes.push(n ? nodeBox(n, p) : pcBox(p))
  }
  if (!boxes.length) return fitView(o, pane.w, pane.h)
  const b = boxes.reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), y0: Math.min(a.y0, c.y0), x1: Math.max(a.x1, c.x1), y1: Math.max(a.y1, c.y1) }))
  const availW = pane.w - pane.drawer - 2 * PAD
  const availH = pane.h - pane.top - 2 * PAD
  const k = Math.min(1.2, availW / (b.x1 - b.x0), availH / (b.y1 - b.y0))
  return {
    k,
    x: PAD + (availW - (b.x1 - b.x0) * k) / 2 - b.x0 * k,
    y: pane.top + PAD + (availH - (b.y1 - b.y0) * k) / 2 - b.y0 * k,
  }
}

/* ---- reveals: what each player has learned (npcs.known_to, npc_links.known_to) ---- */

const toggled = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter(x => x !== id)

/** Revealing an NPC to a PC, or hiding them again. */
export const revealNpc = (known: string[], pcId: string, on: boolean) => toggled(known, pcId, on)

/** Revealing a TIE reveals both of its ends too: a tie between two people the
 *  player has never heard of is a line between nothing, and derive() drops it.
 *  Hiding a tie hides only the tie — the people stay known. Returns the new
 *  known_to for the link and for each end that changed. */
export function revealTie(
  link: Pick<NpcLinkRow, 'known_to'>, a: Pick<NpcRow, 'id' | 'known_to'>, b: Pick<NpcRow, 'id' | 'known_to'>,
  pcId: string, on: boolean,
): { link: string[]; ends: { id: string; known_to: string[] }[] } {
  const ends = on
    ? [a, b].filter(n => !n.known_to.includes(pcId)).map(n => ({ id: n.id, known_to: [...n.known_to, pcId] }))
    : []
  return { link: toggled(link.known_to, pcId, on), ends }
}

/** Exactly what the player of `pcId` can read under 0024's policies — so the
 *  console's "View as" and the player's own screen draw the same web. */
export function asSeenBy(npcs: NpcRow[], links: NpcLinkRow[], pcId: string): { npcs: NpcRow[]; links: NpcLinkRow[] } {
  return { npcs: npcs.filter(n => n.known_to.includes(pcId)), links: links.filter(l => l.known_to.includes(pcId)) }
}
