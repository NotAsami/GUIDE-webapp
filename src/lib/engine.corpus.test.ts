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
  affectedBy, auditNode, buildContext, characterVars, damageFlags, gid, immuneTo, matchCount, nodeGid, resolve, rollResolution,
  staleArmed, suppressedEffects, total,
  type AuthoredNode, type Gid, type ResolveReq,
} from './engine/index.ts'
import { armedFrom } from './graphState.ts'

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

// --- the feature graph -------------------------------------------------------

/** Every authored thing, as the audit sees the catalog. */
const NODES: AuthoredNode[] = [
  ...[...C.feature_catalog, ...C.class_catalog, ...C.race_catalog, ...C.background_catalog].map(r => ({ gid: `feature:${r.id}` as Gid, tags: r.data.tags })),
  ...C.item_catalog.map(r => ({ gid: `item:${r.id}` as Gid, tags: r.data.tags })),
  ...C.spell_catalog.map(r => ({ gid: `spell:${r.id}` as Gid, tags: r.data.tags })),
  ...C.shard_tree_catalog.flatMap(r => (r.data.nodes as { id: string }[]).map(n => ({ gid: nodeGid(r.id, n.id) }))),
]
/** Every variable the catalog declares, name → type. */
const TYPES: Record<string, 'num' | 'bool'> = {}
for (const rows of Object.values(C)) for (const r of rows) for (const v of r.data.vars ?? []) TYPES[v.name] ??= v.type ?? 'num'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
/** The rolls a character makes, asked of one subject. */
function requests(subject: Gid, tags: string[] = []): ResolveReq[] {
  const out: ResolveReq[] = [{ kind: 'feature', subject, tags }]
  for (const hit of [undefined, true, false]) {
    for (const sub of ['melee', 'ranged', 'spell']) out.push({ kind: 'attack', sub, ability: sub === 'melee' ? 'str' : 'dex', subject, tags, hit, targetAc: hit === undefined ? 0 : 15, proficient: true })
    out.push({ kind: 'damage', sub: 'melee', ability: 'str', subject, tags, hit }, { kind: 'damage', subject, tags, hit, cast: 3 })
  }
  for (const sub of ABILITIES) out.push({ kind: 'save', sub, proficient: sub === 'con' }, { kind: 'check', sub, proficient: false })
  out.push({ kind: 'check', sub: 'stealth', ability: 'dex', proficient: true }, { kind: 'attack', cast: 5, tags: ['fire', 'Radiant Damage'] }, { kind: 'damage', cast: 9 })
  return out
}

/** Everything the graph answers about one character, on every roll in the matrix. */
function interrogate(c: CharacterRow, subject: Gid, tags: string[] = [], trees: Record<string, ShardTree> = {}) {
  characterVars(c, trees)
  characterVars(c, trees, TYPES)
  for (const ctx of [buildContext(c, trees), buildContext(c, trees, TYPES)]) {
    for (const req of requests(subject, tags)) {
      const res = resolve(ctx, req)
      total(res)
      rollResolution(res)
      rollResolution(res, true, 'fire')
    }
    for (const kind of ['fire', 'Frightened', 'cold', 'poison']) { damageFlags(ctx, kind); immuneTo(ctx, kind) }
    suppressedEffects(ctx, c)
    affectedBy(ctx, subject, tags)
    staleArmed(ctx)
    staleArmed(ctx, { ...ctx.scope, level: 1 })
  }
}

/** A character holding the arms a row's `once` effects would mint, some offered and one spent. */
function armedWith(c: CharacterRow, r: Row, source: Gid): CharacterRow {
  const once = ((r.data.graph ?? []) as Parameters<typeof armedFrom>[0][]).filter(e => e.once)
  const armed = once.flatMap(e => armedFrom(e, source, r.data.name, { level: 10 }, 1))
  if (!armed.length) return c
  const marked = armed.map((m, i) => (i % 3 === 2 ? { ...m, spent: 'roll-1' } : m))
  return { ...c, resources: { ...(c.resources as object), graph: { armed: marked, vars: {}, attacks: 1 } } } as CharacterRow
}

test('every authored node passes through the audit alike', () => {
  for (const rows of [C.feature_catalog, C.class_catalog, C.race_catalog, C.background_catalog, C.item_catalog, C.spell_catalog]) {
    for (const r of rows) {
      const node = { graph: r.data.graph, vars: r.data.vars, prose: [r.data.light_description, r.data.deep_description, r.data.desc], uses: r.data.uses, shortRecharge: r.data.shortRecharge }
      auditNode(node, NODES, TYPES)
      auditNode(node)
      for (const eff of r.data.graph ?? []) for (const t of eff.target ?? []) matchCount(t, NODES)
    }
  }
  for (const r of C.shard_tree_catalog) for (const n of r.data.nodes) auditNode({ graph: n.graph, vars: n.vars, prose: [n.effect] }, NODES, TYPES)
})

test('every feature, class, race and background: its graph on every roll', () => {
  for (const r of [...C.feature_catalog, ...C.class_catalog, ...C.race_catalog, ...C.background_catalog]) {
    const f = asFeature(r)
    const c = character({ sheet: sheetWith([f]) })
    assert.equal(gid('feature', f), `feature:${r.id}`)
    interrogate(c, `feature:${r.id}`, r.data.tags)
    interrogate(armedWith(c, r, `feature:${r.id}`), `feature:${r.id}`, r.data.tags)
  }
})

test('every item with a graph: worn and wielded, on every roll', () => {
  for (const r of C.item_catalog.filter(i => i.data.graph?.length || i.data.vars?.length || i.data.features?.length)) {
    const item = asItem(r)
    if (SLOTS.includes(r.data.slot)) interrogate(character({ equipped: { [r.data.slot]: item } }), `item:${r.id}`, r.data.tags)
    interrogate(character({ equipped: { weapons: [item] } }), `weapon:${r.id}`, r.data.tags)
  }
})

test('every shard tree and a sample of spells, on every roll', () => {
  for (const r of C.shard_tree_catalog) {
    const attuned = (r.data.nodes as { id: string }[]).map(n => n.id)
    interrogate(character({ shards: { slot1: { shardId: r.id, earned: 99, attuned } } }), nodeGid(r.id, 'core'), [], TREES)
  }
  for (const r of C.spell_catalog.filter((_, i) => i % 10 === 0)) {
    interrogate(character({ spellbook: { ...level10().spellbook, spells: [asSpell(r)] } }), `spell:${r.id}`, r.data.tags)
  }
})

test('a whole class at once: features that read and boost each other', () => {
  const folders = new Map<string, Row[]>()
  for (const r of C.feature_catalog) folders.set(r.data.folder ?? '', [...(folders.get(r.data.folder ?? '') ?? []), r])
  for (const [, rows] of folders) {
    let c = character({ sheet: sheetWith(rows.map(asFeature)) })
    for (const r of rows) c = armedWith(c, r, `feature:${r.id}`)
    interrogate(c, `feature:${rows[0].id}`, rows[0].data.tags)
  }
  assert.ok(folders.size > 5)
})
