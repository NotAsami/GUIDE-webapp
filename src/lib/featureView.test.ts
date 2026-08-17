// Run: node --test src/lib/featureView.test.ts
//
// The Features screen makes two claims a player will believe: "this is what the
// feature does" (the effect sub-rows) and "this is what reaches it" (the popup's
// Affected By). Both are assembled from optional fields, so both go wrong
// quietly. These pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, GraphOp } from './database.types.ts'
import { OP_GLYPH, featureEffects, isUsable, originChain, toggleVar } from './featureView.ts'
import { OPS } from './opSchema.ts'
import { affectedBy, baseScope, buildContext, gid } from './graph.ts'
import { interpolate } from './expr.ts'

const feat = (over: Partial<Feature> = {}): Feature =>
  ({ id: 'f1', name: 'Test Feature', ...over }) as Feature

const eff = (over: Partial<GraphEffect> = {}): GraphEffect =>
  ({ id: 'e1', op: 'add', label: 'L', target: [], ...over }) as GraphEffect

/* ---------- effect sub-rows ---------- */

test('every op in the type has a glyph', () => {
  // Exhaustive by construction (Record<GraphOp, string>), but a future op could
  // be given an empty string and compile. A blank column renders as a silent gap
  // in a list whose whole job is saying what the feature does.
  for (const op of Object.keys(OPS) as GraphOp[]) {
    assert.ok(OP_GLYPH[op]?.trim(), `${op} has no glyph`)
  }
})

test('the value leads, and the damage type rides beside it', () => {
  // dmgType is a FIELD, not part of the text: the renderer has to tint it, and it
  // cannot colour half a string.
  const rows = featureEffects(feat({ graph: [eff({ value: '2d6', dmgType: 'radiant', label: 'Ember' })] }))
  assert.deepEqual(rows, [{ glyph: OP_GLYPH.add, text: '**2d6** · Ember', tag: '', dmgType: 'radiant' }])
})

test('a flag op with no value is carried by its label alone', () => {
  const rows = featureEffects(feat({ graph: [eff({ op: 'adv', label: 'Steady Hand', value: undefined })] }))
  assert.deepEqual(rows, [{ glyph: OP_GLYPH.adv, text: 'Steady Hand', tag: '', dmgType: undefined }])
})

test('ACTIVATION ops are not passive sub-rows', () => {
  // They do nothing until the player presses Use, and the confirm sheet already
  // lists them. On the card they would claim the feature does something it does
  // not — the exact lie the card exists to avoid.
  const rows = featureEffects(feat({
    graph: [eff({ op: 'setVar', variable: 'charges', value: '1' }), eff({ value: '2', label: 'Bonus' })],
  }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, '**2** · Bonus')
})

test('targets read as a player would say them, never as a gid', () => {
  const rows = featureEffects(feat({
    graph: [eff({ value: '1', target: ['roll:damage.melee', 'tag:fire_damage', 'feature:9f3e-uuid'] })],
  }))
  assert.equal(rows[0].tag, 'melee damage · fire damage · feature')
  assert.doesNotMatch(rows[0].tag, /uuid/, 'a gid must not leak onto the card')
})

/* ---------- origin chain ---------- */

test('an authored origin wins outright', () => {
  const chain = ['Fighter', 'Martial Reserve', 'Level 1', 'Second Wind']
  assert.deepEqual(originChain(feat({ origin: chain, category: 'class', source: 'Ignored' })), chain)
})

test('a derived chain skips what is absent rather than rendering blanks', () => {
  assert.deepEqual(
    originChain(feat({ category: 'class', source: 'Fighter 1', level: 3, name: 'Ironhold' })),
    ['Class', 'Fighter 1', 'Level 3', 'Ironhold'],
  )
  // Thin data still reads as a chain, just a short one.
  assert.deepEqual(originChain(feat({ name: 'Bare' })), ['Bare'])
  assert.deepEqual(originChain(feat({ origin: ['  ', ''], category: 'other', name: 'Bare' })), ['Other', 'Bare'])
})

/* ---------- the usable / passive split ---------- */

test('isUsable — a real activation, or something to press', () => {
  assert.equal(isUsable(feat({ activation: 'bonus' })), true)
  assert.equal(isUsable(feat({ roll: '1d10' })), true)
  assert.equal(isUsable(feat({ uses: { current: 1, max: 2 } })), true)
  assert.equal(isUsable(feat({ graph: [eff({ op: 'setVar', variable: 'x' })] })), true)
  assert.equal(isUsable(feat({ graph: [eff({ once: true })] })), true)
  assert.equal(isUsable(feat({ vars: [{ name: 'hoodUp', kind: 'stored', type: 'bool', scope: 'player' }] })), true)

  // `activation: 'none'` is the editor's DEFAULT, not a statement — treating it
  // as one put every live feature in the Passive tab.
  assert.equal(isUsable(feat({ activation: 'none', graph: [eff({ value: '2' })] })), false)
  assert.equal(isUsable(feat({ light_description: 'prose only' })), false)
})

test('a toggle is one bool and nothing else to spend', () => {
  const v = (name: string) => ({ name, kind: 'stored' as const, type: 'bool' as const, scope: 'player' as const })
  assert.equal(toggleVar(feat({ vars: [v('a')] }))?.name, 'a')
  // Two switches: the hexagon cannot pick one and the player cannot tell which.
  assert.equal(toggleVar(feat({ vars: [v('a'), v('b')] })), null)
  // Uses make it a spend, not a hold.
  assert.equal(toggleVar(feat({ vars: [v('a')], uses: { current: 1, max: 1 } })), null)
  // A DM-scoped bool is not the player's to flip.
  assert.equal(toggleVar(feat({ vars: [{ ...v('a'), scope: 'dm' }] })), null)
})

/* ---------- the reverse lookup ---------- */

const character = (features: Feature[]): CharacterRow => ({
  id: 'c1', owner: 'u1', name: 'T', identity: { level: 7 },
  sheet: { features, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 3 },
  resources: {}, inventory: [], equipped: {}, shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
}) as CharacterRow

const TARGET = feat({ id: 'target', feature_id: 'target', name: 'Target', tags: ['fire'] })

test('affectedBy finds a node targeting the feature by GID', () => {
  const src = feat({
    id: 'src', feature_id: 'src', name: 'Booster',
    graph: [eff({ label: 'Boost', value: '2', target: [gid('feature', { feature_id: 'target' })] })],
  })
  const found = affectedBy(buildContext(character([TARGET, src])), gid('feature', TARGET))
  assert.equal(found.length, 1)
  assert.equal(found[0].source, 'Booster')
  assert.equal(found[0].eff.label, 'Boost')
})

test('affectedBy finds one targeting it by TAG', () => {
  // A tag reaching this feature is exactly as much "affected by" as naming it.
  const src = feat({
    id: 'src', feature_id: 'src', name: 'Tagger',
    graph: [eff({ label: 'Kindle', value: '1', target: ['tag:fire'] })],
  })
  const found = affectedBy(buildContext(character([TARGET, src])), gid('feature', TARGET), TARGET.tags)
  assert.deepEqual(found.map(f => f.source), ['Tagger'])
})

test('a feature is not affected by itself', () => {
  const self = feat({
    id: 'target', feature_id: 'target', name: 'Target', tags: ['fire'],
    graph: [eff({ label: 'Own', value: '1', target: ['tag:fire'] })],
  })
  assert.deepEqual(affectedBy(buildContext(character([self])), gid('feature', self), self.tags), [])
})

test('nothing targeting it returns empty, so the section is omitted not blank', () => {
  assert.deepEqual(affectedBy(buildContext(character([TARGET])), gid('feature', TARGET), TARGET.tags), [])
})

test('a node matching by BOTH gid and tag is reported once', () => {
  const src = feat({
    id: 'src', feature_id: 'src', name: 'Double',
    graph: [eff({ label: 'Both', value: '1', target: [gid('feature', { feature_id: 'target' }), 'tag:fire'] })],
  })
  const found = affectedBy(buildContext(character([TARGET, src])), gid('feature', TARGET), TARGET.tags)
  assert.equal(found.length, 1, 'one effect, one row')
})

/* ---------- prose interpolation (the {saveDc} case) ---------- */

test('saveDc resolves from the spellbook, and is 0 when it has none', () => {
  // Read, never recomputed: which ability backs the DC is the DM's answer and the
  // spellbook already stores it. Deriving it here would be a second answer.
  const withDc = { ...character([]), spellbook: { saveDC: 15 } } as CharacterRow
  assert.equal(baseScope(withDc).saveDc, 15)
  assert.equal(baseScope(character([])).saveDc, 0)
})

test('interpolation substitutes a scope value into prose', () => {
  const scope = baseScope({ ...character([]), spellbook: { saveDC: 15 } } as CharacterRow)
  const { text } = interpolate('Wisdom ({saveDc}) saving throw', scope)
  assert.equal(text, 'Wisdom (15) saving throw')
})

test('an unresolvable reference survives as the literal source', () => {
  // The whole safety story. A visible `{nope}` is how an author learns it did not
  // resolve; silently blanking it would hide the typo AND the sentence.
  const { text, bad } = interpolate('a {nope} b', baseScope(character([])))
  assert.equal(text, 'a {nope} b')
  assert.deepEqual(bad, ['nope'])
})

test('a ternary over a declared bool picks each branch', () => {
  // The user's second case: prose that changes with character state.
  const src = '{upgraded ? " and restrains the target." : "."}'
  assert.equal(interpolate(src, { upgraded: true }).text, ' and restrains the target.')
  assert.equal(interpolate(src, { upgraded: false }).text, '.')
})
