// Run: node --test src/lib/feats.test.ts
//
// The load-bearing test in this file is "an unreadable clause does not block".
// `prerequisite` is free text a DM may write anything into, so a parser that
// treats what it cannot read as unmet silently makes homebrew feats
// ungrantable — with no error to explain why.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow } from './database.types.ts'
import { prereqClauses, prereqMet, prereqSummary } from './feats.ts'

function char(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', owner: 'o', name: 'Ros',
    identity: { level: 4 },
    sheet: {
      abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 8 },
      features: [{ id: 'cls:f1', name: 'Fighting Style' }],
    },
    resources: {}, inventory: [], equipped: {},
    spellbook: { spellcasting: false },
    ...over,
  } as CharacterRow
}

// ── the rule everything else hangs off ──────────────────────────────────────

test('AN UNREADABLE CLAUSE NEVER BLOCKS — it is reported, not enforced', () => {
  const r = prereqMet('Must have slain a dragon', char())
  assert.equal(r.ok, true, 'unreadable must not make a feat ungrantable')
  assert.deepEqual(r.unmet, [])
  assert.deepEqual(r.unparsed, ['Must have slain a dragon'])
})

test('a readable clause still blocks when it is genuinely unmet', () => {
  const r = prereqMet('Level 8+', char())
  assert.equal(r.ok, false)
  assert.deepEqual(r.unmet, ['Level 8+'])
})

test('a mix blocks on the readable half and reports the rest', () => {
  const r = prereqMet('Level 8+, Blessed by the Raven Queen', char())
  assert.equal(r.ok, false)
  assert.deepEqual(r.unmet, ['Level 8+'])
  assert.deepEqual(r.unparsed, ['Blessed by the Raven Queen'])
})

test('no prerequisite is trivially satisfied', () => {
  for (const v of [undefined, '', '   ']) {
    const r = prereqMet(v, char())
    assert.equal(r.ok, true)
    assert.deepEqual(r.unmet, [])
    assert.deepEqual(r.unparsed, [])
  }
})

// ── level ───────────────────────────────────────────────────────────────────

test('level compares against identity.level, inclusive at the boundary', () => {
  assert.equal(prereqMet('Level 4+', char()).ok, true, '4 meets "4+"')
  assert.equal(prereqMet('Level 5+', char()).ok, false)
  assert.equal(prereqMet('Level 19+', char({ identity: { level: 19 } })).ok, true)
})

// ── abilities ───────────────────────────────────────────────────────────────

test('an ability clause reads the score by full name', () => {
  assert.equal(prereqMet('Strength 13+', char()).ok, true)
  assert.equal(prereqMet('Charisma 13+', char()).ok, false)
})

test('"or" means ANY of them qualifies', () => {
  // STR 14 passes, DEX 12 does not — one is enough.
  assert.equal(prereqMet('Strength or Dexterity 13+', char()).ok, true)
  assert.equal(prereqMet('Dexterity or Charisma 13+', char()).ok, false)
})

test('EFFECTIVE scores count, so a granted +2 qualifies the character', () => {
  // A feature that boosts STR by 2 — the same layering effectiveSheet applies
  // on every other screen. Base 12 would fail; effective 14 passes.
  const boosted = char({
    sheet: {
      ...char().sheet,
      abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 8 },
      features: [
        { id: 'cls:f1', name: 'Fighting Style' },
        { id: 'race:x', name: 'Orcish Might', graph: [{ id: 'g', op: 'boost', stat: 'STR', value: 2 }] },
      ],
    },
  } as Partial<CharacterRow>)
  assert.equal(prereqMet('Strength 13+', char({ sheet: { ...char().sheet, abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 8 } } })).ok, false, 'base 12 alone fails')
  assert.equal(prereqMet('Strength 13+', boosted).ok, true, 'the boost must count')
})

test('a phrase that only LOOKS like an ability clause is unparsed, not guessed', () => {
  const r = prereqMet('Reputation 13+', char())
  assert.equal(r.ok, true)
  assert.deepEqual(r.unparsed, ['Reputation 13+'])
})

// ── features ────────────────────────────────────────────────────────────────

test('a feature clause matches a feature on the sheet by name', () => {
  assert.equal(prereqMet('Fighting Style Feature', char()).ok, true)
  assert.equal(prereqMet('Extra Attack Feature', char()).ok, false)
})

test('"Spellcasting Feature" asks the spellbook, which is where the app records it', () => {
  // No class in the catalog references a feature named "Spellcasting", so a
  // name lookup alone would refuse every caster.
  assert.equal(prereqMet('Spellcasting Feature', char()).ok, false)
  const caster = char({ spellbook: { spellcasting: true } })
  assert.equal(prereqMet('Spellcasting Feature', caster).ok, true)
})

// ── the real catalog sentences ──────────────────────────────────────────────

test('every prerequisite shape in the live catalog parses', () => {
  const real = ['Level 4+', 'Level 19+', 'Fighting Style Feature',
    'Level 19+, Spellcasting Feature', 'Strength or Dexterity 13+']
  for (const p of real) {
    assert.deepEqual(prereqMet(p, char()).unparsed, [], `"${p}" should be readable`)
  }
})

test('comma is AND — both halves must hold', () => {
  const caster = char({ identity: { level: 19 }, spellbook: { spellcasting: true } })
  assert.equal(prereqMet('Level 19+, Spellcasting Feature', caster).ok, true)
  assert.equal(prereqMet('Level 19+, Spellcasting Feature', char({ identity: { level: 19 } })).ok, false)
  assert.equal(prereqMet('Level 19+, Spellcasting Feature', char({ spellbook: { spellcasting: true } })).ok, false)
})

// ── the classifier the editor asks ──────────────────────────────────────────
//
// `prereqClauses` answers "can this be READ", with no character in hand, so the
// Feature Editor can warn while someone types. It is the same parse `prereqMet`
// runs — a second copy is how an editor comes to call a clause readable that
// the enforcer quietly ignores.

test('every readable shape is classified, and the text is kept verbatim', () => {
  assert.deepEqual(prereqClauses('Level 9+'), [{ text: 'Level 9+', kind: 'level', level: 9 }])
  assert.deepEqual(prereqClauses('Reckless Attack Feature'),
    [{ text: 'Reckless Attack Feature', kind: 'feature', name: 'reckless attack' }])
  assert.deepEqual(prereqClauses('Strength or Dexterity 13+'),
    [{ text: 'Strength or Dexterity 13+', kind: 'ability', keys: ['str', 'dex'], need: 13 }])
})

test('THE TEXT STAYS THE AUTHORS OWN, not a normalisation — every message quotes it back', () => {
  const [c] = prereqClauses('  LEVEL 9+  ')
  assert.equal(c.text, 'LEVEL 9+', 'trimmed, but not lower-cased or reformatted')
})

test('an unreadable clause is classified as such rather than guessed at', () => {
  assert.deepEqual(prereqClauses('Must have slain a dragon'),
    [{ text: 'Must have slain a dragon', kind: 'unreadable' }])
  // Looks like an ability clause and is not one.
  assert.equal(prereqClauses('Reputation 13+')[0].kind, 'unreadable')
})

test('comma splits, blanks are dropped, and nothing is a clause of nothing', () => {
  assert.deepEqual(prereqClauses('Level 4+, , Alert Feature').map(c => c.kind), ['level', 'feature'])
  for (const v of [undefined, '', '   ', ',,']) assert.deepEqual(prereqClauses(v), [])
})

test('THE CLASSIFIER AND THE ENFORCER AGREE — unreadable there is unparsed here', () => {
  // The property that makes one parser worth having: whatever prereqClauses
  // calls unreadable is exactly what prereqMet reports as unchecked, and it
  // never lands in `unmet`.
  const src = 'Level 8+, Blessed by the Raven Queen, Strength 13+, Slain a dragon'
  const r = prereqMet(src, char())
  const unreadable = prereqClauses(src).filter(c => c.kind === 'unreadable').map(c => c.text)
  assert.deepEqual(r.unparsed, unreadable)
  for (const t of unreadable) assert.equal(r.unmet.includes(t), false, 'unreadable must never block')
})

test('every prerequisite shape in the live catalog is readable', () => {
  const real = ['Level 4+', 'Level 19+', 'Fighting Style Feature',
    'Level 19+, Spellcasting Feature', 'Strength or Dexterity 13+',
    'Level 9+, Reckless Attack Feature']
  for (const p of real) {
    assert.deepEqual(prereqClauses(p).filter(c => c.kind === 'unreadable'), [], `"${p}" should be readable`)
  }
})

// ── the summary line ────────────────────────────────────────────────────────

test('the summary names the unmet clause, or the unchecked one, or nothing', () => {
  assert.equal(prereqSummary(prereqMet('Level 8+', char())), 'Requires Level 8+')
  assert.equal(prereqSummary(prereqMet('Slain a dragon', char())), 'Not checked: Slain a dragon')
  assert.equal(prereqSummary(prereqMet('Level 4+', char())), null)
})
