// Run: node --test src/lib/rename.test.ts
//
// A rename is display-only. The failure that matters is the SILENT one: the new
// name leaking into a write and becoming permanent, or a name-keyed lookup
// (`has<Feature>`) quietly breaking because the name it matched on moved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow } from './database.types.ts'
import { applyRenames, baseName, stripRenames } from './rename.ts'
import { baseScope } from './graph.ts'

const ros = (level: number, extraEffects: object[] = []) => ({
  id: 'c1', owner: 'u1', name: 'Ros', identity: { level }, resources: {}, lore: {}, progress: {}, shards: {}, updated_at: '',
  sheet: {
    abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }, hp: { current: 40, max: 40 }, proficiencyBonus: 3,
    features: [
      { id: 'pyro', feature_id: 'pyro', name: 'Pyromancer', graph: [
        { id: 'r', op: 'rename', label: 'Fire Beam', target: ['spell:fb'], to: 'Fire Beam', when: 'level >= 7', text: 'Now a beam.' },
        { id: 'r2', op: 'rename', label: 'Ascended', target: ['feature:pyro'], to: 'Ascended Pyromancer', when: 'level >= 7' },
        ...extraEffects,
      ] },
    ],
  },
  spellbook: { spells: [{ id: 's1', spell_id: 'fb', name: 'Fire Bolt', level: 0 }, { id: 's2', spell_id: 'mm', name: 'Magic Missile', level: 1 }] },
  inventory: [{ id: 'i1', item_id: 'sw', name: 'Sword' }],
  equipped: { weapons: [{ id: 'w1', item_id: 'sw', name: 'Sword' }] },
}) as unknown as CharacterRow

test('a rename applies while its when holds, and not before', () => {
  const at6 = ros(6)
  assert.equal(applyRenames(at6), at6, 'nothing renamed → the same object, so nothing re-renders')
  const at7 = applyRenames(ros(7))
  const fb = at7.spellbook!.spells![0] as { name: string; __baseName?: string; __renamedBy?: string; __renameText?: string }
  assert.equal(fb.name, 'Fire Beam')
  assert.equal(fb.__baseName, 'Fire Bolt')
  assert.equal(fb.__renamedBy, 'Pyromancer')
  assert.equal(fb.__renameText, 'Now a beam.')
  assert.equal(at7.spellbook!.spells![1].name, 'Magic Missile', 'untargeted spells keep their name')
})

test('stripRenames gives back exactly the stored data — the new name can never be written', () => {
  const raw = ros(7)
  const shown = applyRenames(raw)
  assert.deepEqual(stripRenames(shown.spellbook), raw.spellbook)
  assert.deepEqual(stripRenames(shown.sheet), raw.sheet)
  // A screen that spreads a renamed spell into a NEW array is still covered.
  const edited = { spells: [...shown.spellbook!.spells!, { id: 's3', name: 'Shield', level: 1 }] }
  assert.deepEqual(stripRenames(edited).spells.map((s: { name: string }) => s.name), ['Fire Bolt', 'Magic Missile', 'Shield'])
  const untouched = { a: [1, 2], b: { c: 'x' } }
  assert.equal(stripRenames(untouched), untouched, 'no marks → the same object')
})

test('name-keyed lookups read the STORED name, not the shown one', () => {
  const shown = applyRenames(ros(7))
  const f = shown.sheet!.features![0]
  assert.equal(f.name, 'Ascended Pyromancer')
  assert.equal(baseName(f), 'Pyromancer')
  assert.equal(baseScope(shown).has_pyromancer, true, 'has<Feature> survives the feature being renamed')
})

test('a rename of a weapon reaches the equipped copy too', () => {
  const shown = applyRenames(ros(7, [{ id: 'r3', op: 'rename', label: 'x', target: ['item:sw'], to: 'Dawnbrand' }]))
  assert.equal((shown.inventory as unknown as { name: string }[])[0].name, 'Dawnbrand')
  assert.equal((shown.equipped as unknown as { weapons: { name: string }[] }).weapons[0].name, 'Dawnbrand')
})
