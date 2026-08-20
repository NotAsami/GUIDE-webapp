import test from 'node:test'
import assert from 'node:assert/strict'
import { SEP, ancestorsOf, leafOf, depthOf, folderSet, hiddenUnder } from './folders.ts'

test('a path names its ancestors, shallowest first', () => {
  assert.deepEqual(ancestorsOf('SRD/Bard'), ['SRD'])
  assert.deepEqual(ancestorsOf('a/b/c'), ['a', 'a/b'])
  assert.deepEqual(ancestorsOf('Unfiled'), [], 'a top-level folder has no parent')
})

test('the row shows the leaf, the indent shows the depth', () => {
  assert.equal(leafOf('SRD/Bard'), 'Bard')
  assert.equal(leafOf('SRD'), 'SRD')
  assert.equal(depthOf('SRD'), 0)
  assert.equal(depthOf('SRD/Bard'), 1)
  assert.equal(depthOf('a/b/c'), 2)
})

test('ANCESTORS ARE SYNTHESISED — a child cannot render with no parent', () => {
  // Nothing is filed directly in "SRD". It still has to exist as a row, or the
  // 34 class folders come back as 34 top-level ones.
  assert.deepEqual(folderSet(['SRD/Bard', 'SRD/Cleric']), ['SRD', 'SRD/Bard', 'SRD/Cleric'])
  assert.deepEqual(folderSet(['a/b/c']), ['a', 'a/b', 'a/b/c'])
  assert.deepEqual(folderSet(['x', '', 'x']), ['x'], 'empty paths and repeats collapse')
})

test('PLAIN STRING SORT IS DEPTH-FIRST — a parent is a prefix, and prefixes sort first', () => {
  // The render walks folderSet() in order and indents by depth. If a parent
  // could sort AFTER its own child, the child would appear indented under
  // whatever happened to precede it.
  const out = folderSet(['SRD/Wizard', 'SRD/Bard', 'Homebrew/Pact', 'SRD/Barbarian', 'Unfiled'])
  assert.deepEqual(out, [
    'Homebrew', 'Homebrew/Pact', 'SRD', 'SRD/Barbarian', 'SRD/Bard', 'SRD/Wizard', 'Unfiled',
  ])
  for (let i = 0; i < out.length; i++) {
    for (const a of ancestorsOf(out[i])) {
      assert.ok(out.indexOf(a) < i, `${a} must render before its child ${out[i]}`)
    }
  }
  // Siblings are NOT guaranteed adjacent, and the render has to survive that:
  // '-' is 0x2D, below the separator, so this top-level folder lands in the
  // middle of SRD's children. Depth still drives the indent, so it draws at
  // depth 0 where it belongs — it just is not where you would put it by hand.
  assert.ok(SEP > '-')
  const mixed = folderSet(['SRD/Bard', 'SRD-Extra'])
  assert.deepEqual(mixed, ['SRD', 'SRD-Extra', 'SRD/Bard'])
  assert.deepEqual(mixed.map(depthOf), [0, 0, 1])
  for (let i = 0; i < mixed.length; i++) {
    for (const a of ancestorsOf(mixed[i])) assert.ok(mixed.indexOf(a) < i)
  }
})

test('COLLAPSE ACTS ON THE WHOLE SUBTREE, not just direct children', () => {
  const closed = (f: string) => f === 'SRD'
  assert.equal(hiddenUnder('SRD/Bard', closed), true)
  // The one that a naive "is my parent closed?" check gets wrong: Bard is open
  // in its own right, so only walking one level up leaves this on screen.
  assert.equal(hiddenUnder('SRD/Bard/Extra', closed), true)
  assert.equal(hiddenUnder('SRD', closed), false, 'a collapsed folder still shows its own row')
  assert.equal(hiddenUnder('Homebrew/Pact', closed), false)
})
