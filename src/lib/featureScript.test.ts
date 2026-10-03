// Run: node --test src/lib/featureScript.test.ts
//
// The Script tab is a locked placeholder; its only claim is "this is the whole
// feature, and each line belongs to that node". Pin that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogFeatureData, GraphEffect } from './database.types.ts'
import { project } from './featureGraph.ts'
import { colour, serialize } from './featureScript.ts'

const eff = (over: Partial<GraphEffect>): GraphEffect => ({ id: 'e1', op: 'add', label: 'L', target: [], ...over }) as GraphEffect
const F = {
  name: 'Mixed', activation: 'bonus', picks: 1,
  vars: [{ name: 'charge', kind: 'stored', type: 'num' }, { name: 'ready', kind: 'derived', formula: 'charge > 0' }],
  graph: [
    eff({ id: 'p', op: 'add', value: '1d4', target: ['tag:fire'], when: 'ready' }),
    eff({ id: 's', op: 'boost', stat: 'dex', value: '2' }),
    eff({ id: 'o', op: 'addVar', variable: 'charge', value: '-1', ask: 'Spend?', when: 'charge > 0' }),
    eff({ id: 'a', op: 'note', once: true, ask: 'A?', target: ['roll:attack'] }),
    eff({ id: 'b', op: 'note', once: true, ask: 'B?', target: ['roll:attack'] }),
    eff({ id: 't', op: 'adv', once: true, target: ['roll:attack'] }),
  ],
} as CatalogFeatureData

test('every rule and variable owns at least one line', () => {
  const g = project(F)
  const lines = serialize(F, g)
  const owned = new Set(lines.map(l => l.key))
  for (const n of g.nodes) if (n.kind === 'var' || 'eff' in n) assert.ok(owned.has(n.key), n.key)
})

test('gated outcomes nest under their ask and condition', () => {
  const t = serialize(F, project(F)).map(l => l.text)
  const i = t.indexOf('    ask "Spend?":')
  assert.ok(i > 0)
  assert.equal(t[i + 1], '      if charge > 0:')
  assert.match(t[i + 2], /^ {8}addVar charge \+ -1/)
})

test('colouring never drops or reorders characters', () => {
  const s = '    add (1d4 + 2) fire "Kindled {x}" -> tag:fire, roll:damage # hi'
  assert.equal(colour(s, new Set()).map(t => t.v).join(''), s)
})
