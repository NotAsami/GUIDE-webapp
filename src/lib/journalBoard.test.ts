// Run: node --test src/lib/journalBoard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardOf, hang, roman, sessionsByRef } from './journalBoard.ts'
import type { HandoutRow, QuestRow, SessionRow } from './database.types.ts'

const quest = (p: Partial<QuestRow>): QuestRow => ({
  id: 'q', title: 'Q', type: 'main', status: 'active', location: '', given_by: '', description: '',
  objectives: [], related: [], created_at: '', updated_at: '', character_id: null, ...p,
})
const handout = (p: Partial<HandoutRow>): HandoutRow => ({
  id: 'h', title: '', body: '', image_url: '', quest_id: null, recipients: [], on_screen: [],
  pushed_at: null, created_at: '', updated_at: '', ...p,
})
const session = (p: Partial<SessionRow>): SessionRow => ({
  id: 's', num: 1, title: '', date: '', recap: '', events: [], updated_at: '', ...p,
})

test('open notices split by rank; closed ones go to the DONE pile', () => {
  const b = boardOf([
    quest({ id: 'm' }), quest({ id: 's', type: 'side' }), quest({ id: 'mine', character_id: 'ros' }),
    quest({ id: 'c', status: 'completed' }), quest({ id: 'f', status: 'failed', type: 'side' }),
  ], [])
  assert.deepEqual(b.main.map(q => q.id), ['m', 'mine'])
  assert.deepEqual(b.side.map(q => q.id), ['s'])
  assert.deepEqual(b.closed.map(q => q.id), ['c', 'f'])
})

test('handouts clip behind their quest, newest on top; the rest are loose', () => {
  const b = boardOf([quest({ id: 'q1' })], [
    handout({ id: 'old', quest_id: 'q1', pushed_at: '2026-01-01' }),
    handout({ id: 'new', quest_id: 'q1', pushed_at: '2026-02-01' }),
    handout({ id: 'free' }),
    handout({ id: 'hidden', quest_id: 'someone-elses' }),   // quest this reader cannot see
  ])
  assert.deepEqual(b.clipped.get('q1')!.map(h => h.id), ['new', 'old'])
  assert.deepEqual(b.loose.map(h => h.id).sort(), ['free', 'hidden'])
})

test('sessionsByRef: which sessions moved a thing, oldest first, once each; pre-0028 sessions add nothing', () => {
  const s2 = session({ id: 's2', num: 2, links: [{ kind: 'quest', ref: 'q1' }, { kind: 'quest', ref: 'q1' }] })
  const s1 = session({ id: 's1', num: 1, links: [{ kind: 'quest', ref: 'q1' }, { kind: 'handout', ref: 'h1' }] })
  const legacy = session({ id: 's0', num: 0 })
  const m = sessionsByRef([s2, legacy, s1])
  assert.deepEqual(m.get('q1')!.map(s => s.id), ['s1', 's2'])
  assert.deepEqual(m.get('h1')!.map(s => s.id), ['s1'])
  assert.equal(m.size, 2)
})

test('roman numerals for the session strip', () => {
  assert.deepEqual([1, 4, 5, 9, 14, 40, 1247].map(roman), ['I', 'IV', 'V', 'IX', 'XIV', 'XL', 'MCCXLVII'])
  assert.equal(roman(0), '0', 'a session 0 prints as itself, not as nothing')
})

test('hang is stable per id and stays within ±1.2°', () => {
  assert.deepEqual(hang('abc'), hang('abc'))
  for (const id of ['a', 'dc60cecf-2a2c', 'f0d4f5d5', 'x'.repeat(40)]) {
    const { rot, edge } = hang(id)
    assert.ok(Math.abs(rot) <= 1.2 && [0, 1, 2].includes(edge), id)
  }
})
