// Run: ENGINE=shadow node --test src/lib/engine.corpus.test.ts
//
// THE WHOLE CATALOG, on both engines. Every authored feature, item, spell,
// shard and effect in supabase/catalog_snapshot.sql is placed on a level-10
// character and the sheet layer is asked about it. Under ENGINE=shadow the
// facade runs the TypeScript engine and the Rust port side by side and throws
// on the first difference; in the default mode this is a smoke test that none
// of the real content makes the engine throw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import '../../scripts/engine-node.mjs'
import { catalog, level10 } from '../../scripts/engine-corpus.mjs'
import type { CharacterRow, ShardTree } from './database.types.ts'
import {
  activeSources, carryMultiplier, compileEffects, currentBurden, effectiveSheet, gearFeatures, shardFeatures, sheetEffects,
} from './engine/index.ts'

type Row = { id: string; data: Record<string, any> }
const C = catalog() as Record<string, Row[]>
const SLOTS = ['helmet', 'armor', 'cloak', 'boots', 'gloves', 'neck', 'ring1', 'ring2']
const TREES = Object.fromEntries(C.shard_tree_catalog.map(r => [r.id, r.data])) as Record<string, ShardTree>
const character = (over: Record<string, unknown>) => level10(over) as unknown as CharacterRow

/** Everything the sheet layer answers about one character. */
function ask(c: CharacterRow, trees: Record<string, ShardTree> = {}): number {
  const sheet = effectiveSheet(c, trees)
  assert.equal(typeof sheet.ac, 'number')
  gearFeatures(c)
  carryMultiplier(c, trees)
  currentBurden(c)
  shardFeatures(c, trees)
  return activeSources(c, trees).length
}

const asFeature = (r: Row) => ({ ...r.data, id: r.id, feature_id: r.id })
const asItem = (r: Row, n = 0) => ({ ...r.data, id: `inst-${n}`, item_id: r.id })
const asSpell = (r: Row, prepared = true) => ({ ...r.data, id: r.id, spell_id: r.id, prepared })
const sheetWith = (features: unknown[]) => ({ ...level10().sheet, features })

test('every feature, class, race and background, granted alone', () => {
  const rows = [...C.feature_catalog, ...C.class_catalog, ...C.race_catalog, ...C.background_catalog]
  for (const r of rows) {
    assert.ok(ask(character({ sheet: sheetWith([asFeature(r)]) })) >= 1, r.id)
    sheetEffects(r.data.graph, { level: 10, prof: 4 })
    sheetEffects(r.data.graph)
  }
  assert.ok(rows.length > 350)
})

test('every item: worn in its slot, wielded, and carried', () => {
  for (const r of C.item_catalog) {
    const item = asItem(r)
    if (SLOTS.includes(r.data.slot)) ask(character({ equipped: { [r.data.slot]: item } }))
    ask(character({ equipped: { weapons: [item], guideShard: asItem(r, 1) } }))
    ask(character({ inventory: [{ ...item, qty: 3 }], equipped: { containers: { backpack: asItem(r, 2) } } }))
  }
})

test('every spell: prepared, unprepared, and on a known-style caster', () => {
  for (const r of C.spell_catalog) {
    const book = (over: Record<string, unknown>) => ({ ...level10().spellbook, ...over })
    ask(character({ spellbook: book({ spells: [asSpell(r)] }) }))
    ask(character({ spellbook: book({ spells: [asSpell(r, false)] }) }))
    ask(character({ spellbook: book({ spells: [asSpell(r, false)], preparesSpells: false }) }))
    ask(character({ spellbook: book({ spells: [asSpell(r, false)], pactMagic: true }) }))
  }
})

test('every shard tree: fully attuned, concealed and revealed, in each slot', () => {
  for (const r of C.shard_tree_catalog) {
    const attuned = (r.data.nodes as { id: string }[]).map(n => n.id)
    const revealed = Object.fromEntries(attuned.map(id => [id, true]))
    for (const key of ['slot1', 'slot2', 'slot3']) {
      assert.ok(ask(character({ shards: { [key]: { shardId: r.id, earned: 99, attuned } } }), TREES) >= 1, r.id)
      ask(character({ shards: { [key]: { shardId: r.id, earned: 99, attuned, revealed } } }), TREES)
    }
    // A slotted shard the catalog does not have contributes nothing.
    ask(character({ shards: { slot1: { shardId: r.id, earned: 0, attuned: ['core'] } } }))
  }
})

test('every applied effect', () => {
  for (const r of C.effect_catalog) {
    const effects = compileEffects(r.data.mods ?? [], [r.data])
    ask(character({ resources: { activeEffects: [{ id: r.id, name: r.data.name, effects: effects ?? {} }] } }))
  }
})

test('a character carrying a great deal of it at once', () => {
  const worn = Object.fromEntries(SLOTS.map(slot => {
    // No catalog item names `ring2` — a ring is authored for ring1 and worn in either.
    const r = C.item_catalog.find(i => i.data.slot === (slot === 'ring2' ? 'ring1' : slot))!
    return [slot, asItem(r, SLOTS.indexOf(slot))]
  }))
  const everything = character({
    sheet: sheetWith([...C.class_catalog.slice(0, 2), ...C.race_catalog.slice(0, 2), ...C.feature_catalog.slice(0, 60)].map(asFeature)),
    equipped: { ...worn, weapons: C.item_catalog.filter(i => i.data.category === 'weapon').slice(0, 3).map((r, n) => asItem(r, n + 10)) },
    inventory: C.item_catalog.slice(0, 80).map((r, n) => ({ ...asItem(r, n + 100), qty: n % 4 })),
    spellbook: { ...level10().spellbook, spells: C.spell_catalog.slice(0, 40).map((r, n) => asSpell(r, n % 2 === 0)) },
    shards: Object.fromEntries(C.shard_tree_catalog.slice(0, 3).map((r, n) =>
      [`slot${n + 1}`, { shardId: r.id, earned: 99, attuned: (r.data.nodes as { id: string }[]).map(x => x.id) }])),
    resources: { activeEffects: C.effect_catalog.map(r => ({ id: r.id, name: r.data.name, effects: compileEffects(r.data.mods ?? []) ?? {} })) },
  })
  assert.ok(ask(everything, TREES) > 100)
})
