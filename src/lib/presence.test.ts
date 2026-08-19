// Run: node --test src/lib/presence.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { livePresence, newestVitals, PRESENCE_HEARTBEAT_MS, PRESENCE_STALE_MS, type PresenceEntry } from './vitals.ts'
import type { PublicVitals } from './database.types.ts'

const V = (hp: number): PublicVitals => ({
  hp, hpMax: 23, temp: 0, ac: 15, deathOk: 0, deathFail: 0, effects: [],
})

test('THE NEWEST PAYLOAD WINS — this is the whole point of the function', () => {
  // Caught live: presenceState()[key] is an ARRAY that grows, one entry per
  // track() and per open socket. Reading [0] pinned the HP a character had
  // when they connected — the row rendered perfectly and simply never moved
  // again, and the sync dedupe then suppressed every later update because the
  // value it computed was identical each time.
  const entries: PresenceEntry[] = [
    { at: 1000, v: V(20) },
    { at: 2000, v: V(9) },
    { at: 3000, v: V(0) },
  ]
  assert.equal(newestVitals(entries)?.hp, 0, 'the last thing they broadcast')
  assert.notEqual(newestVitals(entries)?.hp, 20, 'not the first')
})

test('order in the array is not trusted', () => {
  // Nothing promises the server appends in timestamp order.
  const entries: PresenceEntry[] = [
    { at: 3000, v: V(0) },
    { at: 1000, v: V(20) },
    { at: 2000, v: V(9) },
  ]
  assert.equal(newestVitals(entries)?.hp, 0)
})

test('a client on an old build broadcasts no vitals, and that is not a crash', () => {
  assert.equal(newestVitals([{ at: 1 }]), null)
  assert.equal(newestVitals([]), null)
  assert.equal(newestVitals(undefined), null)
})

test('an entry with no timestamp never beats one that has a real payload', () => {
  // `at` missing sorts as 0, so a legacy entry cannot mask a current one.
  const entries: PresenceEntry[] = [{ v: V(7) }, { at: 5000, v: V(12) }]
  assert.equal(newestVitals(entries)?.hp, 12)
})

test('a single entry is returned as-is', () => {
  assert.equal(newestVitals([{ at: 9, v: V(15) }])?.hp, 15)
})

// -- liveness ----------------------------------------------------------------

test('A DEAD SOCKET IS NOT AN ONLINE PLAYER — entries age out', () => {
  // Observed live: a client that had exited minutes earlier was still listed in
  // presenceState(), with its last numbers. If "listed" meant "online", nobody
  // would ever go offline and the dimmed offline row would be dead code.
  const now = 1_000_000
  const state = {
    ghost: [{ at: now - PRESENCE_STALE_MS - 1, v: V(20) }],
    here:  [{ at: now - 5_000, v: V(12) }],
  }
  const live = livePresence(state, now)
  assert.deepEqual([...live.keys()], ['here'])
  assert.equal(live.get('here')?.hp, 12)
})

test('a key with one stale and one fresh entry is online', () => {
  // Reconnecting leaves the old socket's entry behind; the fresh one must win
  // both the liveness check and the payload.
  const now = 1_000_000
  const live = livePresence({
    p: [{ at: now - PRESENCE_STALE_MS - 1, v: V(20) }, { at: now - 1_000, v: V(3) }],
  }, now)
  assert.equal(live.get('p')?.hp, 3)
})

test('right at the cutoff it is still here', () => {
  const now = 1_000_000
  assert.equal(livePresence({ p: [{ at: now - PRESENCE_STALE_MS, v: V(1) }] }, now).size, 1)
  assert.equal(livePresence({ p: [{ at: now - PRESENCE_STALE_MS - 1, v: V(1) }] }, now).size, 0)
})

test('the cutoff leaves room for missed heartbeats, not one', () => {
  // A single dropped beat must not blink someone offline mid-combat.
  assert.ok(PRESENCE_STALE_MS >= PRESENCE_HEARTBEAT_MS * 3,
    'stale window should tolerate at least three missed heartbeats')
})

test('a client on an older build broadcasts no timestamp and is kept', () => {
  // Unknown is not the same as gone: aging out an entry we cannot date would
  // hide a player who is really there.
  const live = livePresence({ old: [{ v: V(9) }] }, 1_000_000)
  assert.equal(live.size, 1)
  assert.equal(live.get('old')?.hp, 9)
})

test('an empty entry list is not an online player', () => {
  assert.equal(livePresence({ p: [] }, 1_000_000).size, 0)
})
