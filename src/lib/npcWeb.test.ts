// Run: node --test src/lib/npcWeb.test.ts
//
// Two kinds of promise. The merge's: three free-text sources become one node per
// person, and a place is never mistaken for one. The layout's: no two labels
// overlap and nothing leaves the drawing, at any size — checked with nodeBox(),
// the same geometry the screen renders, not a box somebody guessed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARTY, TIE_SECTORS, asSeenBy, derive, groupByTie, sectorOrder, endpoint, focusView, layout, neighbourhood, nodeBox, pcBox, revealNpc, revealTie, sectorBox, type Box, type Web } from './npcWeb.ts'
import type { NpcLinkRow, NpcRow } from './database.types.ts'

const npc = (name: string, over: Partial<NpcRow> = {}): NpcRow => ({
  id: `id-${name.toLowerCase().replace(/\W+/g, '-')}`, name, role: '', location: '', portrait: '', blurb: '', known_to: [],
  created_at: '', updated_at: '', ...over,
})
const link = (a: NpcRow, b: NpcRow, known_to: string[] = []): NpcLinkRow =>
  ({ id: `${a.id}~${b.id}`, a: a.id, b: b.id, kind: 'Ally', attitude: null, label: '', known_to, created_at: '' })
const quest = (title: string, given_by: string, location: string, related: string[], status: 'active' | 'completed' = 'active') =>
  ({ id: `q-${title}`, title, status, location, given_by, related: related.map(name => ({ name })) })

// The campaign as it is in Supabase today (2026-09-22).
const ROS = {
  id: 'ros', name: 'Ros Chrisstone',
  lore: { relations: [
    { name: 'G.U.I.D.E.', type: 'System · Bonded', attitude: null, desc: '' },
    { name: 'Maren of the Waterfront', type: 'Ally', attitude: 'friendly' as const, desc: '' },
  ] },
}
const QUESTS = [
  quest('Clear Your Name', 'Magistrate Voss', 'Brettany', ['Magistrate Voss', 'Brettany', 'The Crown']),
  quest('The Stolen Tome', 'The Lady', 'Davelguay', ['The Lady', 'Davelguay']),
  quest("The Mayor's Welcome", 'The Mayor', 'Castella', ['Castella', 'The Mayor'], 'completed'),
  quest('The Thicket Path', '', 'Davelguay', ['Davelguay Thicket']),
  quest('Arrival in Brettany', '', 'Brettany', ['Brettany'], 'completed'),
]

const byName = (w: Web, name: string) => w.nodes.find(n => n.name === name)

test('the real campaign: five people, and no place becomes one', () => {
  const w = derive([], [], [ROS as never], QUESTS as never)
  assert.deepEqual(w.nodes.map(n => n.name).sort(),
    ['G.U.I.D.E.', 'Magistrate Voss', 'Maren of the Waterfront', 'The Lady', 'The Mayor'])
  for (const place of ['Brettany', 'Castella', 'Davelguay', 'Davelguay Thicket', 'The Crown']) assert.equal(byName(w, place), undefined, place)
  assert.ok(w.nodes.every(n => n.ring === 1))
  assert.equal(byName(w, 'G.U.I.D.E.')!.sector, 'System')
  assert.equal(byName(w, 'Magistrate Voss')!.sector, 'Brettany')      // from the quest they gave
  assert.equal(byName(w, 'Maren of the Waterfront')!.sector, 'Unplaced')
  const mayor = w.edges.find(e => e.to === byName(w, 'The Mayor')!.id)!
  assert.equal(mayor.from, PARTY)
  assert.equal(mayor.done, true)
})

test('names match trimmed and case-insensitive: one node per person', () => {
  const lady = npc('  the lady ', { location: 'Davelguay' })
  const other = { id: 'pc2', name: '[PC 2]', lore: { relations: [{ name: 'maren of the waterfront', type: 'Rival', attitude: 'wary' as const, desc: '' }] } }
  const w = derive([lady], [], [ROS as never, other as never], QUESTS as never)
  const maren = w.nodes.filter(n => n.name.toLowerCase() === 'maren of the waterfront')
  assert.equal(maren.length, 1)
  assert.equal(w.edges.filter(e => e.to === maren[0].id).length, 2)
  const node = w.nodes.find(n => n.record?.id === lady.id)!
  assert.equal(w.nodes.filter(n => n.name.toLowerCase() === 'the lady').length, 1)
  assert.equal(node.sector, 'Davelguay')
})

test('a related tag counts only when it names a recorded NPC, and never twice', () => {
  const crown = npc('The Crown')
  const voss = npc('Magistrate Voss')
  const w = derive([crown, voss], [], [], QUESTS as never)
  assert.ok(byName(w, 'The Crown'), 'a recorded name in a related tag is a tie')
  assert.equal(byName(w, 'Brettany'), undefined)
  // Voss both gave Clear Your Name and is tagged in it: one tie, not two.
  assert.equal(w.edges.filter(e => e.to === byName(w, 'Magistrate Voss')!.id && e.label === 'Clear Your Name').length, 1)
})

test('someone known only through another NPC sits on the outer ring; a broken link is dropped', () => {
  const voss = npc('Magistrate Voss'), clerk = npc('[Clerk]'), ghost = npc('[Ghost]')
  const w = derive([voss, clerk], [link(voss, clerk), link(voss, ghost)], [], QUESTS as never)
  assert.equal(byName(w, 'Magistrate Voss')!.ring, 1)
  assert.equal(byName(w, '[Clerk]')!.ring, 2)
  assert.equal(w.edges.filter(e => e.kind === 'link').length, 1)
})

/* ---------------------------------------------------------------- layout */

function overlaps(w: Web): string[] {
  const o = layout(w)
  const boxes: [string, Box][] = [
    ...w.nodes.map(n => [n.name, nodeBox(n, o.pos.get(n.id)!)] as [string, Box]),
    ...w.pcs.map(p => [p.name, pcBox(o.pcs.get(p.id)!)] as [string, Box]),
    ...o.sectors.map(sec => [`place ${sec.name}`, sectorBox(sec)] as [string, Box]),
  ]
  const bad: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    const [an, a] = boxes[i]
    if (a.x0 < 0 || a.y0 < 0 || a.x1 > o.w || a.y1 > o.h) bad.push(`${an} leaves the drawing`)
    for (let j = i + 1; j < boxes.length; j++) {
      const [bn, b] = boxes[j]
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) bad.push(`${an} × ${bn}`)
    }
  }
  return bad
}

/** n NPCs spread over the given places; every third known only through the one before it. */
function synthetic(counts: Record<string, number>): Web {
  const npcs: NpcRow[] = []
  const links: NpcLinkRow[] = []
  const quests: ReturnType<typeof quest>[] = []
  for (const [place, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      const r = npc(`${place} ${i % 2 ? 'Keeper of the long name' : 'Hand'} ${i}`, { location: place })
      npcs.push(r)
      if (i % 3 === 2) links.push(link(npcs[npcs.length - 2], r))
      else quests.push(quest(`q ${place} ${i}`, r.name, place, []))
    }
  }
  return derive(npcs, links, [ROS as never], quests as never)
}

const PARTY_OF = (n: number) => [ROS, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `pc${i + 2}`, name: `[PC ${i + 2}] Longer Name`, lore: {} }))]

test('the party never overlaps itself or the inner ring, one PC to four', () => {
  for (let n = 1; n <= 4; n++) assert.deepEqual(overlaps(derive([], [], PARTY_OF(n) as never, QUESTS as never)), [], `${n} PCs`)
})

test('no label overlaps and nothing leaves the drawing, from five NPCs to thirty', () => {
  assert.deepEqual(overlaps(derive([], [], [ROS as never], QUESTS as never)), [])
  assert.deepEqual(overlaps(synthetic({ Brettany: 4, Davelguay: 3, Castella: 3, Unplaced: 3 })), [])
  assert.deepEqual(overlaps(synthetic({ Brettany: 8, Davelguay: 7, Castella: 6, Unplaced: 5, Waterfront: 4 })), [])
  // Lopsided: one place holds most of the cast.
  assert.deepEqual(overlaps(synthetic({ Brettany: 12, Castella: 1, Unplaced: 1 })), [])
})

test('the party sits at the centre, inside ring 1', () => {
  const w = derive([], [], [ROS as never, { id: 'pc2', name: '[PC 2]', lore: {} } as never], QUESTS as never)
  const o = layout(w)
  for (const p of o.pcs.values()) {
    const dx = (p.x - o.cx) / o.rings[0].rx, dy = (p.y - o.cy) / o.rings[0].ry
    assert.ok(dx * dx + dy * dy < 0.25, 'well inside the inner ring')
  }
  assert.deepEqual(endpoint(o, PARTY), { x: o.cx, y: o.cy })
})

test('focusing lands the whole neighbourhood left of the drawer, inside the pane', () => {
  const w = synthetic({ Brettany: 8, Davelguay: 7, Castella: 6, Unplaced: 5, Waterfront: 4 })
  const o = layout(w)
  const pane = { w: 1040, h: 744, drawer: 372, top: 50 }
  for (const n of w.nodes) {
    const v = focusView(o, w, n.id, pane)
    for (const id of neighbourhood(w, n.id)) {
      const p = endpoint(o, id)!
      const x = p.x * v.k + v.x, y = p.y * v.k + v.y
      assert.ok(x >= 0 && x <= pane.w - pane.drawer && y >= pane.top && y <= pane.h, `${n.name}: ${id} at ${x.toFixed(0)},${y.toFixed(0)}`)
    }
  }
})

/* ---------------------------------------------------------------- reveals */

test('revealing a tie reveals both people on it; hiding it keeps them', () => {
  const voss = npc('Magistrate Voss', { known_to: ['ros'] }), lady = npc('The Lady')
  const l = link(voss, lady)
  const on = revealTie(l, voss, lady, 'ros', true)
  assert.deepEqual(on.link, ['ros'])
  assert.deepEqual(on.ends, [{ id: lady.id, known_to: ['ros'] }])     // Voss was already known
  const off = revealTie({ known_to: ['ros'] }, voss, { ...lady, known_to: ['ros'] }, 'ros', false)
  assert.deepEqual(off.link, [])
  assert.deepEqual(off.ends, [])
  assert.deepEqual(revealNpc(['ros'], 'ros', true), ['ros'])
  assert.deepEqual(revealNpc(['ros', 'pc2'], 'ros', false), ['pc2'])
})

test('a player sees their own relations, the quest givers, and only what was revealed to them', () => {
  const voss = npc('Magistrate Voss', { known_to: ['ros'], blurb: 'known' })
  const lady = npc('The Lady', { known_to: ['ros'] })
  const clerk = npc('[Clerk]', { known_to: [] })                        // never revealed
  const secretTie = link(voss, clerk, [])
  const knownTie = link(voss, lady, ['ros'])
  const seen = asSeenBy([voss, lady, clerk], [secretTie, knownTie], 'ros')
  const w = derive(seen.npcs, seen.links, [ROS as never], QUESTS as never)
  assert.equal(byName(w, '[Clerk]'), undefined, 'an unrevealed NPC is not on their web')
  assert.equal(w.edges.filter(e => e.kind === 'link').length, 1)
  assert.equal(byName(w, 'Magistrate Voss')!.record?.blurb, 'known')
  // Not revealed to Cornelius: The Mayor is still there for him as a bare name
  // (he gave the party a quest), with no record behind it.
  const forCor = asSeenBy([voss, lady, clerk], [secretTie, knownTie], 'cor')
  const wc = derive(forCor.npcs, forCor.links, [{ id: 'cor', name: 'Cornelius', lore: {} } as never], QUESTS as never)
  assert.equal(byName(wc, 'Magistrate Voss')!.record, null)
  assert.equal(wc.edges.filter(e => e.kind === 'link').length, 0)
})

test('groupByTie: bonds, quest givers, the named, and the rest — strongest tie wins', () => {
  const sera = npc('Sera Quill'), holt = npc('Captain Holt'), voss = npc('Magistrate Voss', { location: 'Brettany' })
  const w = groupByTie(derive([sera, holt, voss], [link(voss, holt)], [ROS as never],
    [...QUESTS, quest('The Fence', 'Maren of the Waterfront', 'Castella', ['Sera Quill', 'Maren of the Waterfront'])] as never))
  const at = (name: string) => byName(w, name)?.sector
  assert.equal(at('G.U.I.D.E.'), 'Bonds')
  assert.equal(at('Maren of the Waterfront'), 'Bonds')           // a relation outranks the quest she gave
  assert.equal(at('Magistrate Voss'), 'Gave you a quest')
  assert.equal(at('Sera Quill'), 'Named in a quest')
  assert.equal(at('Captain Holt'), 'Through others')
  assert.equal(byName(w, 'Magistrate Voss')?.place, 'Brettany')  // the drawer still knows where they are
  assert.deepEqual(sectorOrder(w.nodes), [...TIE_SECTORS])        // closest group first, not alphabetical by chance
})

test('groupByTie leaves the layout sound: nothing overlaps', () => {
  assert.deepEqual(overlaps(groupByTie(derive([], [], [ROS as never], QUESTS as never))), [])
})
