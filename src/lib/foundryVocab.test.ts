// Run: node --test src/lib/foundryConditions.test.ts
//
// Two directions over one list, which is the whole risk: an effect the app
// applied must not come back as a second copy of itself, and a condition the DM
// applied must not be mistaken for one of the app's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ActiveEffect } from './database.types.ts'
import { isMirrored, mirroredEffects, pushableEffects, statusOf } from './foundryDamage.ts'

test('a Foundry status becomes an effect-shaped row that says where it came from', () => {
  const [fx] = mirroredEffects(['blinded'])
  assert.equal(fx.name, 'Blinded')
  assert.equal(fx.kind, 'cond')
  assert.equal(fx.source, 'Foundry')
  assert.ok(isMirrored(fx.id))
  /* NO MECHANICS. A mirrored Blinded that quietly subtracted from a roll would
     be a number nobody could trace to a source the player can see. */
  assert.deepEqual(fx.effects, {})
})

test('the app’s own effects are not mirrored, so the panel can tell them apart', () => {
  assert.equal(isMirrored('fx-1234'), false)
})

/* NAME MATCHING IS THE ONLY JOIN the two vocabularies have — free text on one
   side, a closed set of ids on the other. It is the same match immunity uses,
   so an effect that suppresses as Frightened also lights the Frightened icon. */
test('an effect named for a condition carries that status; anything else does not', () => {
  assert.equal(statusOf('Poisoned'), 'poisoned')
  assert.equal(statusOf('  frightened '), 'frightened')
  assert.equal(statusOf('Blessed by the Raven Queen'), undefined)
  // Exhaustion is deliberately absent from the vocabulary: a counter, not a switch.
  assert.equal(statusOf('Exhaustion'), undefined)
})

test('what travels to Foundry keeps the effect’s own id, which is how it is reconciled', () => {
  const effects = [
    { id: 'fx-1', name: 'Poisoned', effects: {} },
    { id: 'fx-2', name: 'Blessed by the Raven Queen', effects: {}, icon: 'fa-star' },
  ] as ActiveEffect[]
  assert.deepEqual(pushableEffects(effects), [
    { id: 'fx-1', name: 'Poisoned', status: 'poisoned' },
    { id: 'fx-2', name: 'Blessed by the Raven Queen', icon: 'fa-star' },
  ])
})
