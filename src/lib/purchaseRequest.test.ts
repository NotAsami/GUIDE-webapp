import { test } from 'node:test'
import assert from 'node:assert/strict'
import { purchaseRequest } from './purchaseRequest.ts'

test('a lost reply retains the purchase id across retries and remounts', async () => {
  const memory = new Map<string, string>()
  const journal = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) }, removeItem: (k: string) => { memory.delete(k) } }
  const ids: string[] = []
  const first = await purchaseRequest(journal, 'purchase', () => 'request-1', async id => { ids.push(id); throw new Error('reply lost') })
  assert.deepEqual(first, { ok: false, reason: 'network' })
  await purchaseRequest(journal, 'purchase', () => 'must-not-be-used', async id => { ids.push(id); return { ok: true } })
  assert.deepEqual(ids, ['request-1', 'request-1'])
  assert.equal(memory.size, 0)
})

test('storage failure prevents an untraceable purchase', async () => {
  const result = await purchaseRequest({ getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} },
    'key', () => 'id', async () => assert.fail('must not charge'))
  assert.deepEqual(result, { ok: false, reason: 'storage' })
})
