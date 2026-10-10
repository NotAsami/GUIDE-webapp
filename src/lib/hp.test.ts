import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyHp } from './hp.ts'

test('damage drains temp HP before current', () => {
  assert.deepEqual(applyHp({ current: 40, max: 52, temp: 5 }, 52, { kind: 'damage', amount: 8 }), { current: 37, max: 52, temp: 0 })
  assert.deepEqual(applyHp({ current: 40, max: 52, temp: 10 }, 52, { kind: 'damage', amount: 8 }), { current: 40, max: 52, temp: 2 })
})

test('damage floors at 0, heal caps at the effective max', () => {
  assert.equal(applyHp({ current: 3, max: 52 }, 52, { kind: 'damage', amount: 20 }).current, 0)
  const healed = applyHp({ current: 50, max: 52 }, 57, { kind: 'heal', amount: 20 })
  assert.equal(healed.current, 57)
  assert.equal(healed.max, 52, 'persisted max stays the authored base')
})

test('temp HP is set, not stacked; junk input is a no-op amount', () => {
  assert.equal(applyHp({ current: 40, max: 52, temp: 6 }, 52, { kind: 'temp', amount: 4 }).temp, 4)
  assert.equal(applyHp({ current: 40, max: 52 }, 52, { kind: 'damage', amount: -9 }).current, 40)
})
