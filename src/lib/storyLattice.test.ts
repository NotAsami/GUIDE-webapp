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
import {
  CX, CY, R_NODE, R_EXIT, COL, HEAD_H, HEADS_TOP, ROW_H, ROWS_TOP, TITLE_OFF,
  FOCAL_BREAK, arcPath, recordFor, rowY, solve, threadsFor, zoomTo,
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

test('the arc sweeps clockwise from the top', () => {
  assert.equal(arcPath(0), null, '0% draws nothing at all')

  // 25% ends at 3 o'clock, 50% at 6, 75% at 9 — and it always starts at 12.
  for (const [pct, x, y] of [[25, CX + 250, CY], [50, CX, CY + 250], [75, CX - 250, CY]] as const) {
    const d = arcPath(pct)!
    assert.ok(d.startsWith(`M ${CX} ${CY - 250}`), `${pct}% must start at the top`)
    const [ex, ey] = d.trim().split(' ').slice(-2).map(Number)
    near(ex, x, 0.02)
    near(ey, y, 0.02)
  }
})

test('the large-arc flag flips once past halfway', () => {
  assert.match(arcPath(50)!, / 0 1 /, 'a semicircle is not a large arc')
  assert.match(arcPath(51)!, / 1 1 /, 'past 180° it is')
})

test('a finished story is a closed ring, not a collapsed arc', () => {
  // Start and end coincide at 100%, which an `A` command renders as nothing.
  const d = arcPath(100)!
  assert.match(d, /Z$/)
  assert.notEqual(arcPath(100), arcPath(99))
})

test('percent is clamped, not trusted', () => {
  assert.equal(arcPath(-10), null)
  assert.equal(arcPath(250), arcPath(100))
})

/* ---------------- where threads come from ---------------- */

test('MAIN reads main quests only, active first, side quests never', () => {
  const qs = [
    quest({ id: 'done', title: 'Arrival', status: 'completed' }),
    quest({ id: 'side', title: 'Whispers', type: 'side' }),
    quest({ id: 'live', title: 'Clear Your Name' }),
  ]
  const t = threadsFor(story('main'), qs, {} as CharacterRow)
  assert.deepEqual(t.map(x => x.id), ['live', 'done'])
  assert.equal(t[0].tone, 'current')
  assert.equal(t[1].tone, 'closed')
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

test('a side quest is not reachable through a main story card', () => {
  const qs = [quest({ id: 'a', type: 'side' })]
  assert.equal(recordFor(story('main'), 'a', qs, {} as CharacterRow), null)
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
