// Run: node --test src/lib/usePanZoom.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitView, zoomView } from './usePanZoom.ts'

test('zooming keeps the point under the cursor where it was', () => {
  const v = { x: 30, y: -20, z: 0.8 }
  const world = (vw: typeof v, ox: number, oy: number) => [(ox - vw.x) / vw.z, (oy - vw.y) / vw.z]
  const n = zoomView(v, 1.5, 200, 120, 0.25, 2.2)
  assert.ok(Math.abs(n.z - 1.2) < 1e-9)
  const [a, b] = world(v, 200, 120), [c, d] = world(n, 200, 120)
  assert.ok(Math.abs(a - c) < 1e-9 && Math.abs(b - d) < 1e-9)
})

test('zoom clamps, and a clamped zoom does not move the view', () => {
  const v = { x: 10, y: 10, z: 2.2 }
  assert.deepEqual(zoomView(v, 2, 100, 100, 0.25, 2.2), v)
})

test('fit centres the box inside the padding', () => {
  const v = fitView({ x0: 100, y0: 100, x1: 300, y1: 200 }, 500, 400, 50, 0.25, 5)
  assert.equal(v.z, 2) // width-bound: (500 - 100) / 200
  assert.equal(v.x + 100 * v.z, 50) // left edge lands on the padding
  assert.equal(v.y + 100 * v.z, (400 - 100 * 2) / 2)
})

test('fit zooms in no further than the cap it is given', () => {
  const small = { x0: 0, y0: 0, x1: 100, y1: 100 }
  assert.equal(fitView(small, 1000, 1000, 8, 0.3, 1.15).z, 1.15) // the graph's cap
  assert.equal(fitView(small, 1000, 1000, 8, 0.3, 2.6).z, 2.6) // a shard tree fills its stage
})
