import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PERSON, preferredDest } from './placement.ts'
import type { EquippedGear } from './database.types.ts'

/** Minimal gear: only the container slots matter to preferredDest. */
function gearWith(containers: Record<string, { id: string } | undefined>): EquippedGear {
  return { containers } as unknown as EquippedGear
}

const BOH = { id: 'boh-1' }
const PACK = { id: 'pack-1' }

test('preferredDest: the bag of holding wins over an earlier target', () => {
  const gear = gearWith({ backpack: PACK, bagOfHolding: BOH })
  // Backpack is listed first — the picker must still open on the bag.
  const dests = [{ id: 'pack-1' }, { id: 'boh-1' }]
  assert.equal(preferredDest(dests, gear), 'boh-1')
})

test('preferredDest: beats On Person, which leads the list when stowed', () => {
  const gear = gearWith({ backpack: PACK, bagOfHolding: BOH })
  const dests = [{ id: PERSON }, { id: 'boh-1' }]
  assert.equal(preferredDest(dests, gear), 'boh-1')
})

test('preferredDest: falls back to the first target with no bag equipped', () => {
  const gear = gearWith({ backpack: PACK })
  const dests = [{ id: PERSON }, { id: 'pack-1' }]
  assert.equal(preferredDest(dests, gear), PERSON)
})

test('preferredDest: a bag equipped but not offered does not win', () => {
  // The bag is worn but full / category-barred, so it is not among the targets.
  // Picking it here would select an id the <select> has no option for, leaving
  // the control blank.
  const gear = gearWith({ backpack: PACK, bagOfHolding: BOH })
  const dests = [{ id: PERSON }, { id: 'pack-1' }]
  assert.equal(preferredDest(dests, gear), PERSON)
})

test('preferredDest: no targets at all yields the empty string', () => {
  assert.equal(preferredDest([], gearWith({ bagOfHolding: BOH })), '')
})
