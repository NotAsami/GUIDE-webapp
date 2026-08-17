// Run: node --test src/lib/modEditor.test.ts
//
// The GUI modifier rows and the structured ItemEffects the engine reads are two
// shapes of one thing, and compile/decompile has to be a true round trip — a stat
// that compiles but does not decompile silently empties itself the next time the
// DM opens the form.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKILL_STATS, compileEffects, effectsToMods } from './modEditor.ts'


/* ---------- skill bonuses ---------- */

test('a skill row compiles to the keyed bonus the engine reads', () => {
  // `ItemEffects.skills` was readable and unwritable — settable only by editing
  // JSON by hand. The row is labelled by NAME and stored by KEY.
  const eff = compileEffects([{ stat: 'Sleight of Hand', amt: 2 }])
  assert.deepEqual(eff?.skills, { sleightOfHand: 2 })
})

test('it round-trips back into a row', () => {
  const mods = effectsToMods({ skills: { stealth: 3 } })
  assert.deepEqual(mods, [{ stat: 'Stealth', amt: 3 }])
  assert.deepEqual(compileEffects(mods)?.skills, { stealth: 3 })
})

test('skill rows sit beside ordinary stat rows without disturbing them', () => {
  const eff = compileEffects([{ stat: 'AC', amt: 1 }, { stat: 'Stealth', amt: 2 }])
  assert.equal(eff?.ac, 1)
  assert.deepEqual(eff?.skills, { stealth: 2 })
})

test('every skill the app scores is offered as a row', () => {
  // The list is derived from lib/dnd.ts SKILLS, so it cannot drift from the one
  // the Stats screen renders — but a mapping typo would still strand a name.
  for (const name of SKILL_STATS) {
    assert.ok(compileEffects([{ stat: name, amt: 1 }])?.skills, `${name} did not compile`)
  }
})
