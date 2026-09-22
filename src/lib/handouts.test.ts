// Run: node --test src/lib/handouts.test.ts
//
// The verbs are set arithmetic that fails silently — a Push that dropped last
// week's recipients would take a letter out of someone's Journal with no error.
// The invariant the table's check constraint holds (on_screen ⊆ recipients) is
// asserted after every verb, so a patch that would be refused by Postgres fails
// here first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECALL, filePatch, liveFor, pushKey, pushPatch, stateOf, takeBackPatch } from './handoutPatches.ts'
import type { HandoutRow } from './database.types.ts'

const h = (over: Partial<HandoutRow> = {}): HandoutRow => ({
  id: 'h1', title: '', body: '', image_url: '', quest_id: null,
  recipients: [], on_screen: [], pushed_at: null, created_at: '', updated_at: '', ...over,
})
const apply = (row: HandoutRow, p: Partial<HandoutRow>) => {
  const next = { ...row, ...p }
  assert.ok(next.on_screen.every(id => next.recipients.includes(id)), 'on_screen must stay inside recipients')
  return next
}

test('push keeps earlier recipients but replaces who is on screen', () => {
  let row = apply(h(), pushPatch(h(), ['ros'], 't1'))
  row = apply(row, pushPatch(row, ['pc2'], 't2'))
  assert.deepEqual(row.recipients, ['ros', 'pc2'])
  assert.deepEqual(row.on_screen, ['pc2'])
  assert.equal(row.pushed_at, 't2')
})

test('file adds recipients and never opens anything', () => {
  const row = apply(h({ recipients: ['ros'], on_screen: ['ros'] }), filePatch(h({ recipients: ['ros'] }), ['pc2', 'ros']))
  assert.deepEqual(row.recipients, ['ros', 'pc2'])
  assert.deepEqual(row.on_screen, ['ros'])
})

test('recall empties screens and keeps everyone filed', () => {
  const row = apply(h({ recipients: ['ros', 'pc2'], on_screen: ['ros'] }), RECALL)
  assert.deepEqual(row.recipients, ['ros', 'pc2'])
  assert.equal(stateOf(row), 'filed')
})

test('take back removes from both lists, so the constraint still holds', () => {
  const start = h({ recipients: ['ros', 'pc2'], on_screen: ['ros', 'pc2'] })
  const row = apply(start, takeBackPatch(start, ['ros']))
  assert.deepEqual(row.recipients, ['pc2'])
  assert.deepEqual(row.on_screen, ['pc2'])
})

test('state reads live > filed > draft', () => {
  assert.equal(stateOf(h()), 'draft')
  assert.equal(stateOf(h({ recipients: ['ros'] })), 'filed')
  assert.equal(stateOf(h({ recipients: ['ros'], on_screen: ['ros'] })), 'live')
})

test('the dock opens the newest undismissed push for this character only', () => {
  const a = h({ id: 'a', recipients: ['ros'], on_screen: ['ros'], pushed_at: '2026-09-22T20:00:00Z' })
  const b = h({ id: 'b', recipients: ['ros'], on_screen: ['ros'], pushed_at: '2026-09-22T21:00:00Z' })
  const other = h({ id: 'c', recipients: ['ros', 'pc2'], on_screen: ['pc2'], pushed_at: '2026-09-22T22:00:00Z' })
  assert.equal(liveFor([a, b, other], 'ros', new Set())?.id, 'b')
  // Dismissing the latest push leaves the screen empty — an older, never
  // recalled push must not pop up in its place. A fresh push of b (new
  // pushed_at) opens again.
  assert.equal(liveFor([a, b], 'ros', new Set([pushKey(b)])), null)
  assert.equal(liveFor([{ ...b, pushed_at: '2026-09-22T23:00:00Z' }], 'ros', new Set([pushKey(b)]))?.id, 'b')
  assert.equal(liveFor([a, b], 'pc3', new Set()), null)
})
