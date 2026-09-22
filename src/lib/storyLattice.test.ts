// Run: node --test src/lib/storyLattice.test.ts
//
// Guard: the Story screen's leaders actually reach their nodes.
//
// This is geometry drawn in two separate SVGs — a viewBox'd sigil square and a
// plain-px overlay — joined only by the arithmetic in storyLattice.ts. When that
// arithmetic drifts, nothing throws and nothing logs: a leader ends four pixels
// off its node and it reads as a rendering quirk, which is exactly the kind of
// defect nobody chases. So the invariants are asserted instead of eyeballed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CX, CY, R_NODE, R_EXIT, COL, HEAD_H, HEADS_TOP, ROW_H, ROWS_TOP, TITLE_OFF,
  FOCAL_BREAK, R_SIDE_NODE, SIDE_GAP, SIDE_LEADER_GAP, SIDE_ROW_H, SIDE_TITLE_OFF, ZOOM,
  ARC_LEN, RING_PATH, arcOffset, completionFor, recordFor, rowY, sideRowY, solve, threadsFor, wiresFor, zoomTo,
} from './storyLattice.ts'
import type { CharacterRow, ProgressStory, QuestRow } from './database.types.ts'

const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} (±${tol})`)

const story = (emblem: ProgressStory['emblem']): ProgressStory =>
  ({ id: 's', title: 'T', label: 'L', emblem, percent: 0 })

const quest = (p: Partial<QuestRow>): QuestRow => ({
  id: 'q', title: 'Q', type: 'main', status: 'active', location: 'Brettany',
  given_by: 'Voss', description: '', objectives: [], related: [],
  created_at: '', updated_at: '', ...p,
})

/* ---------------- the join between the two SVGs ---------------- */

test('a node sits on the node ring and its leader breaks on the exit ring', () => {
  for (let i = 0; i < 4; i++) {
    const w = solve(rowY(i))
    assert.ok(w, `row ${i} should solve`)
    near(Math.hypot(w.nx - CX, w.ny - CY), R_NODE)
    near(Math.hypot(w.ex - CX, w.ey - CY), R_EXIT)
  }
})

test('THE LEADER ARRIVES ON ITS OWN ROW — the whole point of solving the angle', () => {
  for (let i = 0; i < 4; i++) {
    const w = solve(rowY(i))
    assert.ok(w)
    // The horizontal run is flat, and it is flat at exactly the title's line.
    assert.equal(w.ey, ROWS_TOP + i * ROW_H + TITLE_OFF)
  }
})

test('every leader run is left-to-right and never degenerate — EVERY row, not just the drawn three', () => {
  // A run that arrives from the right, or is a stub a few px long, reads as a
  // glitch rather than a wire. 30px is the floor below which it stops reading.
  //
  // Checked across every row that solves rather than the three the design was
  // drawn with, because the shortest run is NOT the last one: the exit ring is
  // widest at y == CY, so the run bottoms out on whichever row sits nearest the
  // lattice's own centre line and grows again below it. That minimum is
  // structural — COL - 4 - (CX + R_EXIT) = 61px — so the floor holds for any
  // thread count, and this loop is what proves it stays true if a radius moves.
  let checked = 0
  for (let i = 0; i < 12; i++) {
    const w = solve(rowY(i))
    if (!w) continue
    const run = COL - 4 - w.ex
    assert.ok(run >= 30, `row ${i} (y=${rowY(i)}) run is ${run.toFixed(1)}px — too short to read as a leader`)
    checked++
  }
  assert.ok(checked >= 6, `only ${checked} rows solved — the loop stopped testing anything`)
})

test('the shortest run is the one nearest the lattice centre line, and it is 61px', () => {
  // Pins the reasoning above: if someone widens R_EXIT or pulls COL left, this
  // is the assertion that notices before a leader becomes a stub.
  const worst = COL - 4 - (CX + R_EXIT)
  assert.ok(worst >= 30, `structural minimum run is ${worst}px`)
  const runs = Array.from({ length: 12 }, (_, i) => solve(rowY(i))).filter(Boolean)
    .map(w => COL - 4 - w!.ex)
  assert.ok(Math.min(...runs) >= worst - 0.01, 'no row may beat the structural minimum')
})

test('nodes descend in the order their rows do', () => {
  const ys = [0, 1, 2, 3].map(i => solve(rowY(i))!.ny)
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] > ys[i - 1], `node ${i} should sit below node ${i - 1}`)
  }
})

test('a row past the ring reach gets no node instead of a NaN', () => {
  assert.equal(solve(CY + R_EXIT + 1), null)
  assert.equal(solve(CY - R_EXIT - 1), null)
  assert.ok(solve(CY + R_EXIT))      // exactly on the ring still solves
})

test('the rows start exactly below the heading band', () => {
  // The headings are a grid row above the rows. If that band grows and ROWS_TOP
  // does not, every row shifts down and every leader misses its own title — the
  // silent failure this whole file exists to prevent.
  assert.equal(ROWS_TOP, HEADS_TOP + HEAD_H)
})

/* ---------------- the progress arc ---------------- */

test('THE RING IS A CONSTANT CIRCLE — the shape never changes, so the offset can tween', () => {
  // The old arc was a different path per percent. Swapping it made the ring
  // SNAP between values, and a one-shot reveal can never go down. A constant
  // shape leaves the offset as the only thing that changes, and a CSS
  // transition interpolates that in both directions.
  assert.ok(RING_PATH.startsWith(`M ${CX} ${CY - 250} `), 'must start at 12 o\'clock')
  // First half lands at 6 o'clock with sweep-flag 1 — clockwise on a y-down
  // screen, so it grows through the RIGHT, as the old arc did.
  assert.ok(RING_PATH.includes(`A 250 250 0 1 1 ${CX} ${CY + 250}`), 'first half must sweep clockwise to 6 o\'clock')
  assert.ok(RING_PATH.trim().endsWith(`${CX} ${CY - 250}`), 'and close back at the top')
  assert.ok(!/Z/.test(RING_PATH), 'no Z — a closing segment would add length the dash does not account for')
})

test('the dash length is the exact circumference, not a "long enough" guess', () => {
  // It used to be 1600. As a reveal that was harmless; as the denominator of an
  // offset it would put every percent ~1.9% of the ring in the wrong place.
  near(ARC_LEN, 2 * Math.PI * 250, 1e-9)
})

test('the offset hides exactly the un-done part', () => {
  near(arcOffset(0), ARC_LEN)          // nothing drawn
  near(arcOffset(100), 0)              // the whole ring
  near(arcOffset(25), ARC_LEN * 0.75)
  near(arcOffset(33), ARC_LEN * 0.67)
})

test('percent is clamped, not trusted', () => {
  near(arcOffset(-10), ARC_LEN)
  near(arcOffset(250), 0)
})

test('the offset falls as the percent rises — so a DROP rewinds instead of refilling', () => {
  for (let p = 0; p < 100; p += 5) assert.ok(arcOffset(p + 5) < arcOffset(p), `${p} -> ${p + 5}`)
})

/* ---------------- where threads come from ---------------- */

test('MAIN lists main quests, then side quests one rank down', () => {
  // Side quests used to appear on no card anywhere. They are the same campaign,
  // so they belong here — below the spine, not on it.
  const qs = [
    quest({ id: 'done', title: 'Arrival', status: 'completed' }),
    quest({ id: 'side', title: 'Whispers', type: 'side' }),
    quest({ id: 'live', title: 'Clear Your Name' }),
  ]
  const t = threadsFor(story('main'), qs, {} as CharacterRow)
  assert.deepEqual(t.map(x => x.id), ['live', 'done', 'side'])
  assert.deepEqual(t.map(x => x.kind), ['main', 'main', 'side'])
  assert.equal(t[0].tone, 'current')
  assert.equal(t[1].tone, 'closed')
  assert.equal(t[2].tone, 'active', 'a side quest is never the CURRENT thread')
})

test('MAIN counts objectives into the meta line', () => {
  const qs = [quest({ objectives: [{ text: 'a', done: true }, { text: 'b', done: false }] })]
  assert.match(threadsFor(story('main'), qs, {} as CharacterRow)[0].meta, /Obj 1 \/ 2/)
})

test('REGION groups the locations quests name, busiest first', () => {
  const qs = [
    quest({ id: '1', location: 'Davelguay' }),
    quest({ id: '2', location: 'Brettany' }),
    quest({ id: '3', location: 'Brettany' }),
    quest({ id: '4', location: '   ' }),   // blank is not a location
  ]
  const t = threadsFor(story('region'), qs, {} as CharacterRow)
  assert.deepEqual(t.map(x => x.title), ['Brettany', 'Davelguay'])
  assert.match(t[0].meta, /2 quests/)
  assert.match(t[1].meta, /1 quest logged/)
})

test('CHARACTER reads lore.relations, and an absent attitude says so', () => {
  const ch = { lore: { relations: [{ name: 'The Lady', type: 'Enigma', desc: '' }] } } as CharacterRow
  const t = threadsFor(story('character'), [], ch)
  assert.equal(t[0].title, 'The Lady')
  assert.match(t[0].meta, /unknown/)
})

test('an unauthored story card lists nothing rather than throwing', () => {
  for (const e of ['main', 'region', 'character'] as const) {
    assert.deepEqual(threadsFor(story(e), [], {} as CharacterRow), [])
  }
})

/* ---------------- the thread depth ---------------- */

test('MAIN opens the quest behind the thread, with its prose and objectives intact', () => {
  const qs = [quest({ id: 'a', title: 'Clear Your Name', description: 'A **courier** died.',
    objectives: [{ text: 'Ask Voss', done: true }], related: [{ name: 'Voss' }] })]
  const r = recordFor(story('main'), 'a', qs, {} as CharacterRow)!
  assert.equal(r.title, 'Clear Your Name')
  assert.equal(r.kicker, 'Main Quest')
  assert.equal(r.status, 'Active')
  // The markdown is handed over UNRENDERED — <Prose> does that, and rendering it
  // here would put a second render path on one authored value.
  assert.equal(r.body, 'A **courier** died.')
  assert.equal(r.objectives.length, 1)
  assert.deepEqual(r.meta, [{ k: 'Given by', v: 'Voss' }, { k: 'Location', v: 'Brettany' }])
})

test('A SIDE QUEST OPENS like any other thread, and says which rank it is', () => {
  // The old filter was `type === 'main'`, which would list a side thread on the
  // card and then refuse to open it — a row that is a link to a redirect.
  const qs = [quest({ id: 'a', type: 'side', title: 'Whispers in Castella' })]
  const r = recordFor(story('main'), 'a', qs, {} as CharacterRow)
  assert.ok(r)
  assert.equal(r.title, 'Whispers in Castella')
  assert.equal(r.kicker, 'Side Quest')
})

test('legacy string Related tags still normalise to objects', () => {
  // Rows written before tags carried a url are bare strings; a reader that
  // assumes the object shape renders "undefined".
  const qs = [quest({ id: 'a', related: ['Brettany' as unknown as { name: string }] })]
  assert.deepEqual(recordFor(story('main'), 'a', qs, {} as CharacterRow)!.related, [{ name: 'Brettany' }])
})

test('REGION opens a place and lists the quests that name it', () => {
  const qs = [
    quest({ id: '1', location: 'Davelguay', title: 'Tome' }),
    quest({ id: '2', location: 'Davelguay', title: 'Thicket', status: 'completed', type: 'side' }),
    quest({ id: '3', location: 'Brettany' }),
  ]
  const r = recordFor(story('region'), 'davelguay', qs, {} as CharacterRow)!
  assert.equal(r.title, 'Davelguay')
  assert.equal(r.status, '1 open')
  assert.deepEqual(r.links.map(l => l.title), ['Tome', 'Thicket'])
  assert.match(r.links[1].meta, /Completed · Side/)
  assert.equal(r.body, '', 'a place has no description of its own — there is no locations table')
})

test('CHARACTER opens a relation and titlecases its attitude', () => {
  const ch = { lore: { relations: [
    { name: 'Magistrate Voss', type: 'Magistrate', attitude: 'wary', desc: 'Holds the writ.' },
    { name: 'The Lady', type: 'Enigma', desc: '' },
  ] } } as CharacterRow
  assert.equal(recordFor(story('character'), 'magistrate-voss', [], ch)!.status, 'Wary')
  assert.equal(recordFor(story('character'), 'the-lady', [], ch)!.status, '—', 'no attitude is not "undefined"')
})

test('A DELETED OR HAND-TYPED THREAD RETURNS NULL, so the screen can redirect', () => {
  const ch = { lore: { relations: [] } } as unknown as CharacterRow
  for (const e of ['main', 'region', 'character'] as const) {
    assert.equal(recordFor(story(e), 'nope', [quest({})], ch), null)
  }
})

test('every thread listed can actually be opened — the id round-trips', () => {
  // threadsFor and recordFor derive ids independently; if they ever disagree,
  // every row on the screen becomes a link to a redirect.
  const qs = [quest({ id: 'q1', location: 'Davelguay' }), quest({ id: 'q2', location: 'Brettany' })]
  const ch = { lore: { relations: [{ name: 'The Lady', type: 'Enigma', desc: '' }] } } as CharacterRow
  for (const e of ['main', 'region', 'character'] as const) {
    for (const t of threadsFor(story(e), qs, ch)) {
      assert.ok(recordFor(story(e), t.id, qs, ch), `${e} thread "${t.id}" lists but does not open`)
    }
  }
})

/* ---------------- the zoom ---------------- */

/** Apply what the CSS transform does: P -> s·P + t, origin 0 0. */
function applied(z: { transform: string }, p: { x: number; y: number }) {
  const [, tx, ty, s] = z.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/)!.map(Number)
  return { x: s * p.x + tx, y: s * p.y + ty }
}

test('THE ZOOM LANDS THE FOCUSED NODE ON ITS FOCAL POINT, whichever thread it is', () => {
  for (let i = 0; i < 3; i++) {
    const n = solve(rowY(i))!
    const z = zoomTo(n, rowY(i))
    const got = applied(z, { x: n.nx, y: n.ny })
    near(got.x, z.focal.x, 0.05)
    near(got.y, z.focal.y, 0.05)
  }
})

test('the zoomed leader is the same length for every thread, so it can never fall out of reach', () => {
  const runs = [0, 1, 2].map(i => COL - 4 - (zoomTo(solve(rowY(i))!, rowY(i)).focal.x + FOCAL_BREAK))
  assert.deepEqual([...new Set(runs)], [runs[0]], 'every thread must get the same run')
  assert.ok(runs[0] >= 30, `zoomed run is ${runs[0]}px`)
})

test('ZOOMING IN DOES NOT THROW THE OTHER NODES OFF THE CANVAS', () => {
  // The rejected design centred the focused node on the lattice's middle, which
  // put a neighbour at y=614 on a 472px canvas — off-screen, and with it any
  // chance of seeing where a hop would go. This is the assertion that says the
  // focal point is doing that job.
  const CANVAS = { w: 520, h: 480 }   // the lattice half, and the shortest body
  for (let i = 0; i < 3; i++) {
    const z = zoomTo(solve(rowY(i))!, rowY(i))
    for (let j = 0; j < 3; j++) {
      const n = solve(rowY(j))!
      const p = applied(z, { x: n.nx, y: n.ny })
      assert.ok(p.x > 0 && p.x < CANVAS.w, `focus ${i}: node ${j} at x=${p.x.toFixed(0)} left the canvas`)
      assert.ok(p.y > 0 && p.y < CANVAS.h, `focus ${i}: node ${j} at y=${p.y.toFixed(0)} left the canvas`)
    }
  }
})

/* ---------------- the outer orbit ---------------- */

test('side rows start below the last main row', () => {
  assert.equal(sideRowY(0, 3), ROWS_TOP + 3 * ROW_H + SIDE_GAP + SIDE_TITLE_OFF)
  assert.ok(sideRowY(0, 3) > rowY(2))
})

test('THE COMPACT SIDE ROW IS LOAD-BEARING, not taste', () => {
  // Three main plus three side has to fit the body a laptop actually gives this
  // screen. At 44px it ends at 546; at a main row's 92px it would end at 660.
  const BODY = 556
  const compact = ROWS_TOP + 3 * ROW_H + SIDE_GAP + 3 * SIDE_ROW_H
  assert.ok(compact <= BODY, `side list ends at ${compact}px, body is ${BODY}px`)
  assert.ok(ROWS_TOP + 3 * ROW_H + SIDE_GAP + 3 * ROW_H > BODY,
    'if a full-height side row also fitted, the compact one would be arbitrary')
})

test('wiresFor puts every thread on the ring its RANK belongs to', () => {
  const qs = [
    quest({ id: 'm1' }), quest({ id: 'm2' }),
    quest({ id: 's1', type: 'side' }), quest({ id: 's2', type: 'side' }),
  ]
  const th = threadsFor(story('main'), qs, {} as CharacterRow)
  const ws = wiresFor(th)
  assert.equal(ws.length, th.length, 'wires must stay parallel to threads')
  const radius = (w) => Math.hypot(w.nx - CX, w.ny - CY)
  th.forEach((t, i) => near(radius(ws[i]), t.kind === 'main' ? R_NODE : R_SIDE_NODE))
  const mains = ws.filter((_, i) => th[i].kind === 'main').map(radius)
  const sides = ws.filter((_, i) => th[i].kind === 'side').map(radius)
  assert.ok(Math.min(...sides) > Math.max(...mains), 'every side node sits outside every main one')
})

test('a side leader reaches its own row and still runs left-to-right', () => {
  const qs = [0, 1, 2].map(i => quest({ id: 'm' + i }))
    .concat([0, 1, 2].map(i => quest({ id: 's' + i, type: 'side' })))
  const th = threadsFor(story('main'), qs, {} as CharacterRow)
  const ws = wiresFor(th)
  let m = 0
  let sIdx = 0
  th.forEach((t, i) => {
    const w = ws[i]
    assert.ok(w, `thread ${i} should solve`)
    assert.equal(w.ey, t.kind === 'main' ? rowY(m++) : sideRowY(sIdx++, 3))
    const run = COL - 4 - w.ex
    assert.ok(run >= 30, `${t.kind} thread ${i} run is ${run.toFixed(1)}px`)
  })
})

/* ---------------- completion ---------------- */

test('COMPLETION COUNTS SIDE QUESTS — that is the whole point of the reframe', () => {
  const qs = [
    quest({ id: 'a' }), quest({ id: 'b' }), quest({ id: 'c', status: 'completed' }),
    quest({ id: 'd', type: 'side' }), quest({ id: 'e', type: 'side' }),
    quest({ id: 'f', type: 'side', status: 'completed' }),
  ]
  const c = completionFor(story('main'), qs, {} as CharacterRow)
  assert.deepEqual(c, { done: 2, total: 6, percent: 33 })
})

test('a failed quest stays in the denominator', () => {
  // Dropping it would let botching a quest RAISE your completion.
  const qs = [quest({ id: 'a', status: 'completed' }), quest({ id: 'b', status: 'failed' })]
  assert.equal(completionFor(story('main'), qs, {} as CharacterRow).percent, 50)
})

test('one quest is one unit, whatever its objectives', () => {
  const heavy = quest({ id: 'a', status: 'completed', objectives: [
    { text: 'x', done: true }, { text: 'y', done: true }, { text: 'z', done: true }] })
  const light = quest({ id: 'b', type: 'side' })
  assert.equal(completionFor(story('main'), [heavy, light], {} as CharacterRow).percent, 50)
})

test('NULL where there is nothing to count, so the caller falls back to the authored number', () => {
  // The honest state for two emblems today — not zero, which would read as
  // "you have done none of it".
  assert.equal(completionFor(story('region'), [quest({})], {} as CharacterRow), null)
  assert.equal(completionFor(story('character'), [quest({})], {} as CharacterRow), null)
  assert.equal(completionFor(story('main'), [], {} as CharacterRow), null, 'no quests yet')
})

test('a finished campaign reads 100, and the arc closes into a ring', () => {
  const qs = [quest({ id: 'a', status: 'completed' }), quest({ id: 'b', status: 'completed' })]
  const c = completionFor(story('main'), qs, {} as CharacterRow)
  assert.equal(c.percent, 100)
  near(arcOffset(c.percent), 0, 1e-9)
})

/* ------------------------------------------------------------------
   ONE AUTHORED VALUE, ONE RENDER PATH — scanned, because the defect IS the
   call site.

   A story's `percent` is the DM's number, and every card now shows a DERIVED one
   instead where there is something to count. The rule for that lived inline at
   each render site, and the third site missed it: the story tabs printed the
   authored 23% right beside the centre's derived 33%. Nothing threw. It only
   showed up by looking at the screen. So a render has to go through
   displayPercent, and this fails on any that reads `.percent` directly.
   ------------------------------------------------------------------ */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const tsxFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = join(dir, e.name)
  return e.isDirectory() ? tsxFiles(p) : e.name.endsWith('.tsx') ? [p] : []
})

/** Reads of a story percent that are raw on purpose, and why. */
const RAW_PERCENT_ON_PURPOSE: { match: string; why: string }[] = [
  { match: 'value={st.percent}',
    why: 'the DM editing the AUTHORED number in the console — it has to show what is being typed, not what the card derives' },
]

test('EVERY RENDER OF A CARD PERCENT GOES THROUGH displayPercent', () => {
  const raw: string[] = []
  for (const f of tsxFiles(SRC)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!/\.percent\b/.test(line)) return
      if (RAW_PERCENT_ON_PURPOSE.some(p => line.includes(p.match))) return
      raw.push(`${f.slice(SRC.length)}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(raw, [],
    'These read a story percent directly, so they will disagree with every card that derives it.\n'
    + 'Use displayPercent(story, quests, character), or add to RAW_PERCENT_ON_PURPOSE with the reason:\n  '
    + raw.join('\n  '))
})

test('every excuse in RAW_PERCENT_ON_PURPOSE still matches something', () => {
  const all = tsxFiles(SRC).map(f => readFileSync(f, 'utf8')).join('\n')
  for (const p of RAW_PERCENT_ON_PURPOSE) assert.ok(all.includes(p.match), `stale exemption: "${p.match}"`)
})

/* ---------------- a leader leaves its node from the EDGE ---------------- */

const sixThreads = () => threadsFor(story('main'),
  [0, 1, 2].map(i => quest({ id: 'm' + i })).concat([0, 1, 2].map(i => quest({ id: 's' + i, type: 'side' }))),
  {} as CharacterRow)

test('A SIDE LEADER STARTS AT ITS NODE EDGE, not through its hollow middle', () => {
  // The leader layer paints above the nodes, and a side node is hollow — so a
  // leader starting at the centre drew a line straight through it, which read
  // as a stray digit. Measured in the browser before this existed.
  const th = sixThreads()
  wiresFor(th).forEach((w, i) => {
    if (th[i].kind !== 'side') return
    near(Math.hypot(w.sx - w.nx, w.sy - w.ny), SIDE_LEADER_GAP)
    // ...and it is still the same radial line, just shortened at the node end.
    const cross = (w.sx - w.nx) * (w.ey - w.ny) - (w.sy - w.ny) * (w.ex - w.nx)
    near(cross, 0, 0.01)
  })
})

test('a main leader still starts at its node centre — filled nodes hide it, so nothing moved', () => {
  const th = sixThreads()
  wiresFor(th).forEach((w, i) => {
    if (th[i].kind !== 'main') return
    assert.equal(w.sx, w.nx)
    assert.equal(w.sy, w.ny)
  })
})

test('zoomed in, a side leader still leaves from the scaled edge, toward its break', () => {
  const th = sixThreads()
  const ws = wiresFor(th)
  const side = ws[th.findIndex(t => t.kind === 'side')]
  const z = zoomTo(side, side.ey)
  near(Math.hypot(z.leaderStart.x - z.focal.x, z.leaderStart.y - z.focal.y), SIDE_LEADER_GAP * ZOOM)
  assert.ok(z.leaderStart.x > z.focal.x && z.leaderStart.y > z.focal.y, 'it must head toward the break, not away')

  const main = ws[0]
  const zm = zoomTo(main, main.ey)
  assert.deepEqual(zm.leaderStart, zm.focal, 'a filled main node keeps a centre start when zoomed too')
})
