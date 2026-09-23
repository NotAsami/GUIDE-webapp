import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SaveQueue } from './saveQueue.ts'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

test('failed saves stay dirty and an explicit retry confirms them', async () => {
  const q = new SaveQueue()
  let calls = 0
  q.enqueue({ key: 'item', version: 'edited', write: async () => { if (++calls === 1) throw new Error('offline') } })
  await q.flush()
  assert.equal(q.state('item').status, 'failed')
  await q.flush()
  assert.equal(q.state('item').status, 'saved')
  assert.equal(calls, 2)
})

test('switching records during a save preserves destinations and latest values', async () => {
  const q = new SaveQueue(), wait = deferred(), writes: string[] = []
  q.enqueue({ key: 'A', version: '1', write: async () => { writes.push('A1'); await wait.promise } })
  const running = q.flush()
  q.enqueue({ key: 'A', version: '2', write: async () => { writes.push('A2') } })
  q.enqueue({ key: 'B', version: '1', write: async () => { writes.push('B1') } })
  wait.resolve()
  await running
  assert.deepEqual(writes, ['A1', 'A2', 'B1'])
  assert.equal(q.state('A').status, 'saved')
  assert.equal(q.state('B').status, 'saved')
})

test('reverting while an older save is in flight still persists the revert', async () => {
  const q = new SaveQueue(), wait = deferred(), writes: string[] = []
  q.baseline('A', 'original')
  q.enqueue({ key: 'A', version: 'edited', write: async () => { writes.push('edited'); await wait.promise } })
  const running = q.flush()
  q.enqueue({ key: 'A', version: 'original', write: async () => { writes.push('original') } })
  wait.resolve(); await running
  assert.deepEqual(writes, ['edited', 'original'])
})

test('a failure on one record does not discard saves for other records', async () => {
  const q = new SaveQueue()
  q.enqueue({ key: 'A', version: '1', write: async () => { throw new Error('offline') } })
  q.enqueue({ key: 'B', version: '1', write: async () => {} })
  await q.flush()
  assert.equal(q.state('A').status, 'failed')
  assert.equal(q.state('B').status, 'saved')
})
