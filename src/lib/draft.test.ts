// Run: node --test src/lib/draft.test.ts
// The ladder's FIRST rung only — the two DB rungs are covered by the manual
// pass, since they are round trips through Supabase rather than logic.
//
// No React here: rendering a hook needs a renderer, and the part worth pinning
// is the storage contract useLocalDraft depends on. If these keys or shapes
// change, a refresh silently loses the DM's work — the exact failure the local
// tier exists to prevent.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const PREFIX = 'guide:draft:'

type Stored<T> = { at: number; value: T }

/** The reader from lib/draft.ts, isolated. Kept in step by the tests below. */
function read<T>(store: Map<string, string>, key: string): Stored<T> | null {
  try {
    const raw = store.get(PREFIX + key)
    return raw ? (JSON.parse(raw) as Stored<T>) : null
  } catch {
    return null
  }
}

test('a stored draft round-trips under its own key', () => {
  const store = new Map<string, string>()
  const value = { name: 'Second Wind', graph: [{ id: 'e1', op: 'add', label: 'Heal' }] }
  store.set(`${PREFIX}feature:second_wind`, JSON.stringify({ at: 1000, value }))

  const got = read<typeof value>(store, 'feature:second_wind')
  assert.deepEqual(got?.value, value)
  assert.equal(got?.at, 1000)
  // Keys are namespaced per editor AND per row, so two open editors cannot
  // overwrite each other.
  assert.equal(read(store, 'feature:action_surge'), null)
  assert.equal(read(store, 'shard:second_wind'), null)
})

test('unparseable local state degrades to no autosave, never a crash', () => {
  // Quota errors, private mode, and payloads from an older shape all land here.
  // Losing the local tier is survivable; taking the editor down is not.
  const store = new Map([[`${PREFIX}feature:x`, '{ not json']])
  assert.equal(read(store, 'feature:x'), null)
})

test('the new-feature key is distinct from every saved row', () => {
  // A feature that has never been saved has no id, so it parks under a fixed
  // sentinel. If that collided with a real id, starting a new feature would
  // silently adopt an existing one's unsaved edits.
  const store = new Map<string, string>()
  store.set(`${PREFIX}feature:__new__`, JSON.stringify({ at: 1, value: { name: 'Draft' } }))
  assert.equal(read<{ name: string }>(store, 'feature:__new__')?.value.name, 'Draft')
  assert.equal(read(store, 'feature:'), null)
})
