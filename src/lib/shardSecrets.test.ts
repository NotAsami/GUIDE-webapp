// Run: node --test src/lib/shardSecrets.test.ts
//
// The concealed-node boundary. `shard_tree_secrets` has no player policy — ever
// — so what `splitForSave` puts in `shard_tree_catalog.data` is what every bound
// player can read. A field leaking here is a spoiler with no undo: the row is
// already in their client by the time anyone notices.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GraphEffect, ShardTree, ShardTreeSecretRow, VarDef } from './database.types.ts'
import { mergeTree, splitForSave, type EditorNode, type EditorTree } from './shardSecrets.ts'

const GRAPH: GraphEffect[] = [
  { id: 'e1', op: 'add', value: '2d6', dmgType: 'radiant', label: 'Zealot', target: ['roll:damage'] },
]
const VARS: VarDef[] = [{ name: 'shardsHeld', kind: 'stored', type: 'num' }]

const node = (over: Partial<EditorNode> = {}): EditorNode => ({
  id: 'n1', name: 'Zealot’s Ember', tier: 2, branch: 'grit', angle: 40, cost: 2,
  icon: 'fa-fire', prereqs: ['core'], effect: 'Burns brighter.',
  graph: GRAPH, vars: VARS, tags: ['fire'], mods: { ac: 1 },
  ...over,
})

const tree = (n: EditorNode): EditorTree => ({
  id: 'sh1', name: 'Test Shard', capacity: 10, nodes: [n],
} as EditorTree)

test('a CONCEALED node keeps its graph, vars and tags out of the player catalog', () => {
  const { catalog, secretsData } = splitForSave(tree(node({ concealed: true })))
  const pub = catalog.nodes[0] as Record<string, unknown>

  // Everything mechanical is absent from the row a player can read…
  for (const field of ['graph', 'vars', 'tags', 'mods', 'features', 'perks']) {
    assert.equal(pub[field], undefined, `${field} leaked to the public catalog`)
  }
  assert.equal(pub.name, '')      // and the name and prose are blanked, not merely omitted
  assert.equal(pub.effect, '')
  assert.equal(pub.concealed, true)
  // …while the geometry a lattice needs to draw survives.
  assert.equal(pub.id, 'n1')
  assert.equal(pub.tier, 2)
  assert.equal(pub.angle, 40)

  // …and all of it is in secrets, which no player policy grants.
  assert.deepEqual(secretsData.nodes.n1?.graph, GRAPH)
  assert.deepEqual(secretsData.nodes.n1?.vars, VARS)
  assert.deepEqual(secretsData.nodes.n1?.tags, ['fire'])
  assert.equal(secretsData.nodes.n1?.name, 'Zealot’s Ember')
})

test('an UNCONCEALED node keeps its graph on the catalog row', () => {
  // Concealment is the trigger, not authoring. A visible node's mechanics are
  // exactly what a player is supposed to be able to read.
  const { catalog, secretsData } = splitForSave(tree(node({ concealed: false })))
  assert.deepEqual(catalog.nodes[0].graph, GRAPH)
  assert.deepEqual(catalog.nodes[0].vars, VARS)
  assert.equal(secretsData.nodes.n1, undefined)
})

test('a DM note never reaches the catalog, concealed or not', () => {
  const { catalog, secretsData } = splitForSave(tree(node({ concealed: false, dm: 'the pommel sigil' })))
  assert.equal((catalog.nodes[0] as Record<string, unknown>).dm, undefined)
  assert.equal(secretsData.nodes.n1?.dm, 'the pommel sigil')
})

test('mergeTree gives the DM back what the split took away', () => {
  const { catalog, secretsData } = splitForSave(tree(node({ concealed: true, dm: 'note' })))
  const secretRow = { shard_id: 'sh1', data: secretsData } as ShardTreeSecretRow
  const merged = mergeTree(catalog as ShardTree, secretRow)
  const n = merged.nodes[0]

  assert.deepEqual(n.graph, GRAPH)
  assert.deepEqual(n.vars, VARS)
  assert.equal(n.name, 'Zealot’s Ember')
  assert.equal(n.effect, 'Burns brighter.')
  assert.equal(n.dm, 'note')
  // A full round trip: what the DM edits next is what they authored.
  assert.deepEqual(splitForSave(merged).catalog.nodes[0], catalog.nodes[0])
})

test('a field with no secrets entry survives the merge untouched', () => {
  const { catalog } = splitForSave(tree(node({ concealed: false })))
  const merged = mergeTree(catalog as ShardTree, undefined)
  assert.deepEqual(merged.nodes[0].graph, GRAPH)
})
