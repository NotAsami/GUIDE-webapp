import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Outcome } from './graphState.ts'
import { droppedToZero, fireTrigger, onTrigger, triggerMode, triggerProblem } from './triggers.ts'

const o = (x: Partial<Outcome> & { kind: Outcome['kind'] }) => ({ eff: {}, summary: '', ...x }) as unknown as Outcome

test('a free press runs; one that spends or asks is offered', () => {
  assert.equal(triggerMode({}, [o({ kind: 'uses', current: 1, next: 4 })], {}), 'run')
  assert.equal(triggerMode({}, [], {}), 'run')
  assert.equal(triggerMode({ uses: { max: 1 } }, [], {}), 'offer')
  assert.equal(triggerMode({}, [o({ kind: 'uses', current: 5, next: 2 })], {}), 'offer')
  assert.equal(triggerMode({}, [o({ kind: 'slot', delta: -1 })], {}), 'offer')
  assert.equal(triggerMode({}, [o({ kind: 'var', ask: 'Use it?' })], {}), 'offer')
  assert.equal(triggerMode({}, [o({ kind: 'grant' })], {}), 'offer')
})

test('a trigger with nothing to press is a problem; one with an outcome is not', () => {
  assert.equal(triggerProblem({}), null)
  assert.ok(triggerProblem({ trigger: 'initiative' }))
  assert.ok(triggerProblem({ trigger: 'initiative', graph: [{ id: 'a', op: 'add', label: 'x', value: '1' }] }))
  assert.equal(triggerProblem({ trigger: 'initiative', graph: [{ id: 'a', op: 'addUses', label: 'x', value: '1' } as never] }), null)
  assert.equal(triggerProblem({ trigger: 'hpZero', uses: { max: 1 } }), null)
})

test('dropping to 0 is the crossing, not lying there', () => {
  assert.equal(droppedToZero(5, 0), true)
  assert.equal(droppedToZero(5, -3), true)
  assert.equal(droppedToZero(0, 0), false)
  assert.equal(droppedToZero(undefined, 0), false)
  assert.equal(droppedToZero(3, 1), false)
})

test('the bus reaches every listener until it unsubscribes', () => {
  const got: string[] = []
  const off = onTrigger(e => got.push(e))
  fireTrigger('initiative')
  off()
  fireTrigger('turnStart')
  assert.deepEqual(got, ['initiative'])
})
