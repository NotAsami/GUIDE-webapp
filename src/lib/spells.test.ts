// Run: node --test src/lib/spells.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterSpellbook, Spell } from './database.types.ts'
import {
  cantripTier, damageAt, isCaster, isPrepared, maxCastLevel,
  pactSlotCount, pactSlotLevel, pactSlotsAvail, preparedUsed, preparesSpells, rollSpellDamage,
} from './spells.ts'
import type { Rider } from './graph.ts'

function spell(over: Partial<Spell>): Spell {
  return {
    id: 's1', name: 'Test Spell', level: 1, school: 'Evocation', castingTime: '1 Action',
    range: '30 ft', v: true, s: true, m: false, duration: 'Instantaneous',
    concentration: false, ritual: false, desc: '', hasDamage: false,
    ...over,
  }
}

test('cantripTier follows the 1/5/11/17 breakpoints', () => {
  assert.equal(cantripTier(1), 1)
  assert.equal(cantripTier(4), 1)
  assert.equal(cantripTier(5), 2)
  assert.equal(cantripTier(10), 2)
  assert.equal(cantripTier(11), 3)
  assert.equal(cantripTier(16), 3)
  assert.equal(cantripTier(17), 4)
  assert.equal(cantripTier(20), 4)
})

test('cantrip damage scales by character level, not cast level (CLAUDE.md canon)', () => {
  const fireBolt = spell({ level: 0, hasDamage: true, dice: '1d10', scaling: '1d10', dmgType: 'Fire' })
  // castLevel is passed but ignored for cantrips — only charLevel matters.
  assert.equal(damageAt(fireBolt, 0, 4)!.expr, '1d10')
  assert.equal(damageAt(fireBolt, 99, 4)!.expr, '1d10')
  assert.equal(damageAt(fireBolt, 0, 5)!.expr, '2d10')
  assert.equal(damageAt(fireBolt, 0, 11)!.expr, '3d10')
  assert.equal(damageAt(fireBolt, 0, 17)!.expr, '4d10')
})

test('levelled spell upcast scales by chosen cast level', () => {
  const fireball = spell({ level: 3, hasDamage: true, dice: '8d6', scaling: '1d6', dmgType: 'Fire' })
  assert.equal(damageAt(fireball, 3, 5)!.expr, '8d6')
  assert.equal(damageAt(fireball, 5, 5)!.expr, '10d6')
  // casting below its own level never happens in the UI, but must not go negative.
  assert.equal(damageAt(fireball, 1, 5)!.expr, '8d6')
})

test('base + per-level modifier scaling (Magic Missile shape)', () => {
  const magicMissile = spell({ level: 1, hasDamage: true, dice: '3d4+3', scaling: '1d4+1', dmgType: 'Force' })
  const at1 = damageAt(magicMissile, 1, 5)!
  assert.equal(at1.count, 3); assert.equal(at1.mod, 3); assert.equal(at1.expr, '3d4 + 3')
  const at3 = damageAt(magicMissile, 3, 5)!
  assert.equal(at3.count, 5); assert.equal(at3.mod, 5); assert.equal(at3.expr, '5d4 + 5')
})

test('unparseable dice returns null instead of throwing', () => {
  const bad = spell({ level: 1, hasDamage: true, dice: 'not dice' })
  assert.equal(damageAt(bad, 1, 5), null)
})

test('no-damage spell returns null', () => {
  const shield = spell({ level: 1, hasDamage: false })
  assert.equal(damageAt(shield, 1, 5), null)
})

test('preparedUsed counts only prepared non-cantrips', () => {
  const sb: CharacterSpellbook = {
    spells: [
      spell({ id: 'a', level: 0, prepared: true }),   // cantrip — never counts
      spell({ id: 'b', level: 1, prepared: true }),
      spell({ id: 'c', level: 2, prepared: false }),
      spell({ id: 'd', level: 3, prepared: true }),
    ],
  }
  assert.equal(preparedUsed(sb), 2)
})

test('isCaster requires spellcasting AND at least one known spell', () => {
  assert.equal(isCaster({ spellcasting: false }), false)
  assert.equal(isCaster({ spellcasting: true, spells: [] }), false)
  assert.equal(isCaster({ spellcasting: true, spells: [spell({})] }), true)
  assert.equal(isCaster(undefined), false)
})

test('preparesSpells defaults true (Wizard-style) when unset', () => {
  assert.equal(preparesSpells({}), true)
  assert.equal(preparesSpells({ preparesSpells: true }), true)
  assert.equal(preparesSpells({ preparesSpells: false }), false)
  assert.equal(preparesSpells(undefined), true)
})

test('isPrepared: cantrips and known-caster spells always ready; prepared casters read the flag', () => {
  const cantrip = spell({ level: 0, prepared: false })
  const known = spell({ level: 3, prepared: false })
  const prep = spell({ level: 3, prepared: false })

  // Wizard-style (preparesSpells true / unset) — respects the per-spell flag.
  assert.equal(isPrepared(cantrip, { preparesSpells: true }), true)
  assert.equal(isPrepared(prep, { preparesSpells: true }), false)
  assert.equal(isPrepared({ ...prep, prepared: true }, { preparesSpells: true }), true)

  // Warlock-style (preparesSpells false) — every levelled spell reads ready
  // regardless of the stored flag; a fresh Grant Spell (prepared:false) must
  // not show as "not prepared" forever.
  assert.equal(isPrepared(known, { preparesSpells: false }), true)
  assert.equal(isPrepared({ ...known, prepared: true }, { preparesSpells: false }), true)
})

test('preparedUsed only makes sense for a Prepared-style caster (verified separately by callers)', () => {
  const sb: CharacterSpellbook = { spells: [spell({ id: 'a', level: 2, prepared: true })] }
  assert.equal(preparedUsed(sb), 1)
})

test('maxCastLevel is capped by owned slots, never below the spell level', () => {
  const sb: CharacterSpellbook = {
    slots: [
      { level: 1, total: 4, expended: 0 }, { level: 2, total: 0, expended: 0 },
      { level: 3, total: 2, expended: 0 }, { level: 4, total: 0, expended: 0 },
      { level: 5, total: 0, expended: 0 }, { level: 6, total: 0, expended: 0 },
      { level: 7, total: 0, expended: 0 }, { level: 8, total: 0, expended: 0 },
      { level: 9, total: 0, expended: 0 },
    ],
  }
  const fireball = spell({ level: 3 })
  assert.equal(maxCastLevel(fireball, sb), 3) // highest owned slot level
  const magicMissile = spell({ level: 1 })
  assert.equal(maxCastLevel(magicMissile, sb), 3) // can upcast into owned L3 slots
})

test('pactSlotCount follows the 1/2/11/17 breakpoints (max 4, ever)', () => {
  assert.equal(pactSlotCount(1), 1)
  assert.equal(pactSlotCount(2), 2)
  assert.equal(pactSlotCount(10), 2)
  assert.equal(pactSlotCount(11), 3)
  assert.equal(pactSlotCount(16), 3)
  assert.equal(pactSlotCount(17), 4)
  assert.equal(pactSlotCount(20), 4)
})

test('pactSlotLevel climbs 1st..5th, reaching 5th at level 9 and staying there', () => {
  assert.equal(pactSlotLevel(1), 1)
  assert.equal(pactSlotLevel(2), 1)
  assert.equal(pactSlotLevel(3), 2)
  assert.equal(pactSlotLevel(4), 2)
  assert.equal(pactSlotLevel(5), 3)
  assert.equal(pactSlotLevel(6), 3)
  assert.equal(pactSlotLevel(7), 4)
  assert.equal(pactSlotLevel(8), 4)
  assert.equal(pactSlotLevel(9), 5)
  assert.equal(pactSlotLevel(20), 5) // never 6-9 — that's Mystic Arcanum, out of scope
})

test('pactSlotsAvail subtracts pactExpended from the derived total, floored at 0', () => {
  assert.equal(pactSlotsAvail({}, 5), 2) // level 5 → 2 pact slots, none spent
  assert.equal(pactSlotsAvail({ pactExpended: 1 }, 5), 1)
  assert.equal(pactSlotsAvail({ pactExpended: 99 }, 5), 0) // never negative
})

test('a Pact Magic caster is always Known-style, regardless of preparesSpells', () => {
  assert.equal(preparesSpells({ pactMagic: true }), false)
  assert.equal(preparesSpells({ pactMagic: true, preparesSpells: true }), false)
  assert.equal(preparesSpells({ pactMagic: false, preparesSpells: true }), true)
})

test('canUpcast: false pins maxCastLevel to the spell\'s own level, even with higher slots owned', () => {
  const sb: CharacterSpellbook = {
    slots: Array.from({ length: 9 }, (_, i) => ({ level: i + 1, total: i === 4 ? 3 : 0, expended: 0 })), // 5 slots owned
  }
  const noUpcast = spell({ level: 2, hasDamage: true, dice: '3d6', canUpcast: false })
  assert.equal(maxCastLevel(noUpcast, sb), 2)
  assert.equal(damageAt(noUpcast, 5, 5)!.expr, '3d6') // even if a caller passed a higher castLevel, extra is 0 at its own level
})

test('maxUpcastLevel caps the ceiling below owned slots, but never below the spell\'s own level', () => {
  const sb: CharacterSpellbook = {
    slots: Array.from({ length: 9 }, (_, i) => ({ level: i + 1, total: 1, expended: 0 })), // owns every level 1-9
  }
  const capped = spell({ level: 2, hasDamage: true, dice: '3d6', maxUpcastLevel: 4 })
  assert.equal(maxCastLevel(capped, sb), 4) // capped well below the 9 it could otherwise reach
  const miscappedBelowOwnLevel = spell({ level: 5, hasDamage: true, dice: '3d6', maxUpcastLevel: 2 })
  assert.equal(maxCastLevel(miscappedBelowOwnLevel, sb), 5) // a bad DM cap never drops below the spell's own level
})

// --- §6a: the graph reaches a cast ------------------------------------------

const FLAME: Spell = {
  id: 'inst-1', spell_id: 'cat-flame', name: 'Sacred Flame', level: 0, school: 'evocation',
  castingTime: '1 Action', range: '60 ft', v: true, s: true, m: false, duration: 'Instantaneous',
  concentration: false, ritual: false, desc: '', hasDamage: true, dice: '1d8', dmgType: 'radiant',
} as Spell

/** The caller rolls the contribution now, so the fixture hands over what
 *  rollResolution would have produced. */
const CONTRIB = (riders: Rider[] = []) => {
  const rolled = riders.map(r => (r.when !== 'manual' && r.dice.length
    ? { ...r, rolledDice: r.dice.flatMap(d => {
        const n = parseInt(d, 10) || 1
        return Array.from({ length: n }, () => ({ v: 3, sides: parseInt(d.split('d')[1], 10) }))
      }) }
    : r))
  const flat = rolled.reduce((n, r) => n + (r.when === 'manual' ? 0
    : r.flat + (r.rolledDice ?? []).reduce((a, b) => a + b.v, 0)), 0)
  return { flat, riders: rolled }
}

const rider = (over: Partial<Rider>): Rider =>
  ({ label: 'R', source: 'F', op: 'add', formula: '', flat: 0, dice: [], when: 'always', on: true, ...over })

test('a spell with no graph rolls exactly as it always did', () => {
  const r = rollSpellDamage(FLAME, 0, 7)!
  assert.equal(r.mod, 0)
  assert.equal(r.riders.length, 0)
  assert.equal(r.total, r.rolls.reduce((a, b) => a + b.v, 0))
  assert.equal(r.rolls[0].sides, 8)   // the die knows what it is (§46)
})

test('a flat contribution lands in the cast\u2019s total and is named', () => {
  const r = rollSpellDamage(FLAME, 0, 7, CONTRIB([rider({ label: 'Zealot’s Ember', flat: 2 })]))!
  assert.equal(r.mod, 2)
  assert.equal(r.total, r.rolls.reduce((a, b) => a + b.v, 0) + 2)
  assert.equal(r.riders[0].label, 'Zealot\u2019s Ember')
})

test('a dice contribution is rolled ONCE and its faces stay on the rider', () => {
  const r = rollSpellDamage(FLAME, 0, 7, CONTRIB([rider({ label: 'Searing', dice: ['2d6'] })]))!
  const faces = r.riders[0].rolledDice!
  assert.equal(faces.length, 2)
  assert.equal(faces[0].sides, 6)
  assert.equal(r.total, r.rolls.reduce((a, b) => a + b.v, 0) + faces.reduce((a, b) => a + b.v, 0))
})

test('an unanswered `manual` rider does NOT apply to the cast', () => {
  // §7: the panel asks; the roller must not pre-apply it.
  const r = rollSpellDamage(FLAME, 0, 7, CONTRIB([
    rider({ label: 'Judged', when: 'manual', on: false, formula: '1d6', dice: ['1d6'] }),
  ]))!
  assert.equal(r.mod, 0)
  assert.equal(r.riders[0].rolledDice, undefined)
})
