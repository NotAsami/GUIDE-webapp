import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropRect, DEFAULT_CROP, imagePath, IMAGE_PREFIX, MAX_SOURCE_BYTES, outputSize, validateImage } from './imageFiles.ts'

test('image validation rejects unsupported, empty, and oversized input', () => {
  for (const type of ['image/svg+xml', 'image/gif', 'text/html', '']) assert.ok(validateImage({ type, size: 100 }))
  assert.ok(validateImage({ type: 'image/png', size: 0 }))
  assert.ok(validateImage({ type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 }))
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(validateImage({ type, size: MAX_SOURCE_BYTES }), null)
})
test('private references and legacy URLs are distinguished without storing signed URLs', () => {
  assert.equal(imagePath(IMAGE_PREFIX + 'npcs/test.webp'), 'npcs/test.webp')
  assert.equal(imagePath('https://example.com/portrait.png'), null)
})
test('crop centers a portrait inside a landscape source and permits edge positioning', () => {
  assert.deepEqual(cropRect(1600, 900, 3 / 4, DEFAULT_CROP), { x: 462.5, y: 0, width: 675, height: 900 })
  assert.deepEqual(cropRect(900, 1600, 1, { x: 100, y: 100, zoom: 2 }), { x: 450, y: 1150, width: 450, height: 450 })
  assert.deepEqual(cropRect(900, 1600, 1, { x: -50, y: 900, zoom: 0 }), { x: 0, y: 700, width: 900, height: 900 })
})
test('handouts retain the full image; export never upscales', () => {
  assert.deepEqual(cropRect(600, 2000, undefined, { x: 0, y: 0, zoom: 3 }), { x: 0, y: 0, width: 600, height: 2000 })
  assert.deepEqual(outputSize(6000, 3000, 4096), { width: 4096, height: 2048 })
  assert.deepEqual(outputSize(20, 10, 1600), { width: 20, height: 10 })
  assert.throws(() => cropRect(0, 200, 1, DEFAULT_CROP))
})
