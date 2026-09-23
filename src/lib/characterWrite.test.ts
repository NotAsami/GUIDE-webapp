import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, CharacterUpdate } from './database.types.ts'
import { mergeCharacterPatch, CharacterConflict } from './characterMerge.ts'
import { writeCharacter, type CharacterStore } from './characterWrite.ts'

const row = (patch: Partial<CharacterRow> = {}): CharacterRow => ({
  id: 'c', owner: 'u', name: 'Player', identity: {}, sheet: { hp: { current: 10, max: 20 }, coins: { gold: 10 } },
  resources: {}, inventory: [], equipped: {}, shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '1', ...patch,
} as CharacterRow)

test('HP changes preserve concurrent coin changes and recompute vitals', async () => {
  const base = row()
  let stored = row({ updated_at: '2', sheet: { ...base.sheet, coins: { gold: 5 } } })
  const store: CharacterStore = {
    read: async () => stored,
    compareAndSwap: async (expected, patch) => {
      if (expected.updated_at !== stored.updated_at) return null
      stored = { ...stored, ...patch, updated_at: '3' } as CharacterRow
      return stored
    },
  }
  const result = await writeCharacter(store, base, { sheet: { ...base.sheet, hp: { current: 9, max: 20 } } }, {})
  assert.equal(result.ok, true)
  assert.equal(stored.sheet.coins?.gold, 5)
  assert.equal(stored.sheet.hp?.current, 9)
  assert.equal(stored.public_vitals?.hp, 9)
})

test('conflicting HP edits fail without replacing the latest row', async () => {
  const base = row(), current = row({ updated_at: '2', sheet: { hp: { current: 8, max: 20 } } })
  const result = await writeCharacter({ read: async () => current, compareAndSwap: async expected => {
    if (expected.updated_at !== current.updated_at) return null
    return assert.fail('must not write')
  } }, base,
    { sheet: { ...base.sheet, hp: { current: 9, max: 20 } } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.row, current)
})

test('an inventory conflict cannot partially apply the accompanying equipment change', () => {
  const base = { inventory: ['sword'], equipped: {} }
  assert.throws(() => mergeCharacterPatch(base, { inventory: [], equipped: { weapon: 'sword' } },
    { inventory: ['sword', 'gift'], equipped: {} }), CharacterConflict)
})

test('CAS retries merge against the new row instead of overwriting it', async () => {
  const base = row()
  let attempts = 0
  let current = base
  let committed: CharacterUpdate | undefined
  const result = await writeCharacter({ read: async () => current, compareAndSwap: async (_, patch) => {
    if (++attempts === 1) {
      current = row({ updated_at: '2', sheet: { ...base.sheet, coins: { gold: 4 } } })
      return null
    }
    committed = patch
    return { ...current, ...patch } as CharacterRow
  } }, base, { sheet: { ...base.sheet, hp: { current: 9, max: 20 } } }, {})
  assert.equal(result.ok, true)
  assert.equal(attempts, 2)
  assert.equal(committed?.sheet?.coins?.gold, 4)
})

test('network failures return failure rather than a successful void result', async () => {
  const result = await writeCharacter({ read: async () => row(), compareAndSwap: async () => { throw new Error('offline') } }, row(), {}, {})
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.message, 'offline')
})

test('nested deletion preserves unrelated remote fields; concurrent deletion conflicts', () => {
  assert.deepEqual(mergeCharacterPatch({ sheet: { a: 1, b: 2 } }, { sheet: { b: 2 } }, { sheet: { a: 1, b: 3 } }), { sheet: { b: 3 } })
  assert.throws(() => mergeCharacterPatch({ sheet: { a: 1 } }, { sheet: { a: 2 } }, { sheet: {} }), CharacterConflict)
})

test('two actions based on the same resource count cannot both report success', () => {
  const base = { charges: 3 }
  assert.throws(() => mergeCharacterPatch(base, { charges: 2 }, { charges: 2 }), CharacterConflict)
})

test('an up-to-date base saves in ONE round trip: no read before the write', async () => {
  const base = row()
  let reads = 0
  const result = await writeCharacter({
    read: async () => { reads++; return base },
    compareAndSwap: async (expected, patch) => expected.updated_at === base.updated_at
      ? { ...base, ...patch, updated_at: '2' } as CharacterRow : null,
  }, base, { sheet: { ...base.sheet, hp: { current: 9, max: 20 } } }, {})
  assert.equal(result.ok, true)
  assert.equal(reads, 0)
})
