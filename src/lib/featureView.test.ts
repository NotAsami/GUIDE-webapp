// Run: node --test src/lib/featureView.test.ts
//
// The Features screen makes two claims a player will believe: "this is what the
// feature does" (the effect sub-rows) and "this is what reaches it" (the popup's
// Affected By). Both are assembled from optional fields, so both go wrong
// quietly. These pin them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, Feature, GraphEffect, GraphOp } from './database.types.ts'
import { OP_GLYPH, featureEffects, isUsable, originChain, runsActivation, toggleVar, isCarrier, origins, usesOf } from './featureView.ts'
import type { Feature } from './database.types.ts'
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

const v = (name: string) => ({ name, kind: 'stored' as const, type: 'bool' as const, scope: 'player' as const })

test('a toggle is one bool the player owns', () => {
  assert.equal(toggleVar(feat({ vars: [v('a')] }))?.name, 'a')
  // Two switches: the hexagon cannot pick one and the player cannot tell which.
  assert.equal(toggleVar(feat({ vars: [v('a'), v('b')] })), null)
  // A DM-scoped bool is not the player's to flip.
  assert.equal(toggleVar(feat({ vars: [{ ...v('a'), scope: 'dm' }] })), null)
  // A feature that rolls dice has a result to show; a switch has nowhere to
  // show it, so the press stays a roll.
  assert.equal(toggleVar(feat({ vars: [v('a')], roll: '1d10' })), null)
})

test('A STANCE MAY COST A USE TO ENTER — Rage is a switch and a counter', () => {
  /* `uses` used to disqualify a toggle outright, on the reasoning that a press
     either spends or holds. Rage does both, and so do Wild Shape and Frenzy. The
     exclusion left exactly one authorable shape: a hexagon that spent a use and
     showed nothing, beside a free hand switch in the popup that turned the thing
     on for nothing. */
  const rage = feat({ vars: [v('isRaging')], uses: { max: 'rages' } })
  assert.equal(toggleVar(rage)?.name, 'isRaging')
  // What the press DOES is a separate question, and this is its answer: with an
  // activation to run, entering goes through the path that spends the use.
  assert.equal(runsActivation(rage), false, 'nothing authored to run, so nothing is spent')
  const armed = feat({
    vars: [v('isRaging')], uses: { max: 'rages' },
    graph: [eff({ op: 'setVar', variable: 'isRaging', value: 'true', label: 'Enter Rage' })],
  })
  assert.equal(runsActivation(armed), true)
  // An armed `once` counts too — arming IS the press, §16.
  assert.equal(runsActivation(feat({ graph: [eff({ once: true, target: ['roll:attack'] })] })), true)
  assert.equal(runsActivation(feat({ graph: [eff({ op: 'add', value: '2' })] })), false, 'a passive contribution runs nothing')
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

/* ---------- carriers ---------- */

const carrier = (id: string, over: Partial<Feature> = {}): Feature =>
  ({ id, name: id, ...over }) as Feature

test('A CARRIER IS HIDDEN, A GRANTED FEATURE IS NOT — the difference is one colon', () => {
  // The dangerous line in this whole change. `cls:arbiter` is the synthetic row
  // carrying the class's vars; `cls:arbiter:second_wind` is Second Wind. A
  // startsWith('cls:') test would hide every feature the class grants — most of
  // the screen — and it would look like the grant path had broken.
  assert.equal(isCarrier('cls:arbiter'), true)
  assert.equal(isCarrier('race:elf'), true)
  assert.equal(isCarrier('cls:arbiter:second_wind'), false, 'a GRANTED feature')
  assert.equal(isCarrier('race:elf:darkvision'), false, 'a GRANTED feature')
})

test('an ordinary feature is never mistaken for a carrier', () => {
  for (const id of ['rage', 'gear-ring-1', 'shard-slot1-core-2', '', undefined]) {
    assert.equal(isCarrier(id), false, `treated as a carrier: ${id}`)
  }
})

test('origins read the description off the carrier, race first', () => {
  // Off the CARRIER, not the catalog: class_catalog has no player policy, so a
  // player cannot read it. assignClass snapshots desc onto light_description.
  const list = origins([
    carrier('cls:arbiter', { name: 'Arbiter', light_description: 'Sworn to the Reclamation.' }),
    carrier('rage', { name: 'Rage', light_description: 'Not an origin.' }),
    carrier('race:elf', { name: 'Elf', light_description: 'Graceful and long-lived.' }),
  ])
  assert.deepEqual(list.map(o => o.kind), ['race', 'class'])
  assert.deepEqual(list.map(o => o.name), ['Elf', 'Arbiter'])
  assert.equal(list[0].desc, 'Graceful and long-lived.')
})

test('a carrier with no description contributes no section', () => {
  // Otherwise the Lore dossier grows an empty "Origin" heading for a class whose
  // author never wrote one.
  assert.deepEqual(origins([carrier('cls:arbiter', { name: 'Arbiter' })]), [])
  assert.deepEqual(origins([carrier('cls:arbiter', { name: 'Arbiter', light_description: '   ' })]), [])
  assert.deepEqual(origins(undefined), [])
})

/* ---------- uses: the max is a formula ---------- */

test('a plain number max still reads exactly as it always did', () => {
  assert.deepEqual(usesOf(feat({ uses: { current: 1, max: 3 } }), {}), { current: 1, max: 3 })
  // …and so does the string form a JSON round-trip or a text input produces.
  assert.deepEqual(usesOf(feat({ uses: { current: 1, max: '3' } }), {}), { current: 1, max: 3 })
  assert.equal(usesOf(feat(), {}), null, 'no counter is null, not zero')
})

test('a FORMULA max resolves against the character scope', () => {
  // The whole point: "the Rages column of the Barbarian table" is `rages`, which
  // the class carrier declares. Without this the max was a fixed number typed by
  // the DM, and a level-5 Barbarian and a level-17 one had the same Rages.
  const rage = feat({ uses: { current: 2, max: 'rages' } })
  assert.deepEqual(usesOf(rage, { rages: 3 }), { current: 2, max: 3 })
  assert.deepEqual(usesOf(rage, { rages: 6 }), { current: 2, max: 6 })
  // A level table indexes inline just as well, with no variable to declare.
  const tbl = feat({ uses: { current: 9, max: '[0,2,2,3,3,3,4][level]' } })
  assert.equal(usesOf(tbl, { level: 1 })!.max, 2)
  assert.equal(usesOf(tbl, { level: 6 })!.max, 4)
})

test('ABSENT current means FULL — a template cannot know its own max', () => {
  // A catalog row is granted to a character it has never met, so there is no
  // number for it to copy. Writing 0 would hand out a permanently spent feature.
  assert.deepEqual(usesOf(feat({ uses: { max: 'rages' } }), { rages: 4 }), { current: 4, max: 4 })
  assert.deepEqual(usesOf(feat({ uses: { max: 2 } }), {}), { current: 2, max: 2 })
})

test('current is CLAMPED on read and the stored value is never rewritten', () => {
  // Same rule effective HP follows: losing the level that raised the max must
  // not destroy the count, because regaining it has to give the use back.
  const f = feat({ uses: { current: 5, max: 'rages' } })
  assert.equal(usesOf(f, { rages: 3 })!.current, 3)
  assert.equal(f.uses!.current, 5, 'the row is untouched')
  assert.equal(usesOf(f, { rages: 6 })!.current, 5, 'and comes back when the ceiling rises')
})

test('an unresolvable max is 0 rather than a guess', () => {
  // 0 reads as "spent" everywhere, which is the loud failure. The Feature Editor
  // refuses to publish one, so this is the shape of a row edited by hand.
  assert.deepEqual(usesOf(feat({ uses: { current: 2, max: 'nonsense' } }), {}), { current: 0, max: 0 })
  // Dice in a use count is not a thing — refused, not truncated to its flat part.
  assert.equal(usesOf(feat({ uses: { current: 2, max: '1d4 + 2' } }), {})!.max, 0)
})

/* ---------- the value is what it is WORTH, not how it was written ----------
 *
 * Brutal Strike's damage is authored as
 * `has_improved_brutal_strike_enhanced ? 2d10 : 1d10`, and the card printed
 * that string at the player — the engine talking to itself in the one place
 * that exists to say what the feature does. */

test('a value formula resolves against the character', () => {
  const rows = featureEffects(
    feat({ graph: [eff({ value: 'has_greater_smite ? 2d10 : 1d10', label: 'Add to Damage Roll' })] }),
    { has_greater_smite: true },
  )
  assert.equal(rows[0].text, '**2d10** · Add to Damage Roll')
})

test('the same formula reads the other way for a character without it', () => {
  const rows = featureEffects(
    feat({ graph: [eff({ value: 'has_greater_smite ? 2d10 : 1d10', label: 'Add to Damage Roll' })] }),
    {},
  )
  assert.equal(rows[0].text, '**1d10** · Add to Damage Roll')
})

test('a level table wins over the bare value, exactly as the roller reads it', () => {
  const byLevel = ['', '', '', '', '', '', '', '', '', '1d10', '', '', '', '', '', '', '', '2d10']
  const rows = featureEffects(feat({ graph: [eff({ value: '1d10', byLevel, label: 'Add' })] }), { level: 18 })
  assert.equal(rows[0].text, '**2d10** · Add')
})

test('dice and a flat bonus read as one amount', () => {
  const rows = featureEffects(feat({ graph: [eff({ value: '1d6 + prof', label: 'Add' })] }), { prof: 3, level: 5 })
  assert.equal(rows[0].text, '**1d6 + 3** · Add')
})

/* WITHOUT A CHARACTER the source is the honest answer — the DM's authoring
   preview has nothing to resolve against, and so is a formula that fails to
   resolve: blanking it would hide the typo that caused it. */
test('with no scope, and for a formula that will not resolve, the source stands', () => {
  const g = [eff({ value: 'has_greater_smite ? 2d10 : 1d10', label: 'Add' })]
  assert.equal(featureEffects(feat({ graph: g }))[0].text, '**has_greater_smite ? 2d10 : 1d10** · Add')
  const broken = [eff({ value: 'nonsense +', label: 'Add' })]
  assert.equal(featureEffects(feat({ graph: broken }), { level: 5 })[0].text, '**nonsense +** · Add')
})
