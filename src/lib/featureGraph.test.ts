// Run: node --test src/lib/featureGraph.test.ts
//
// The Graph view draws claims the DM will believe: "this outcome only runs when
// X", "this reads that", "this applies to those". Every one is re-derived from the
// feature, so these pin the derivation. Fixtures follow the mockup's four
// features (guide-hud/project/feature-graph.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogFeatureData, GraphEffect } from './database.types.ts'
import { addNode, autoLayout, connectTarget, disconnectTarget, editGate, project, regate, removeNode, retarget, setMatch, setPos, targetRefusal, type GEdge, type FeatureGraph } from './featureGraph.ts'
import { blankEffect } from './opSchema.ts'

const feat = (over: Partial<CatalogFeatureData>) => ({ name: 'Test', ...over }) as CatalogFeatureData
const eff = (over: Partial<GraphEffect>): GraphEffect => ({ id: 'e1', op: 'add', label: 'L', target: [], ...over }) as GraphEffect

const keys = (g: FeatureGraph) => g.nodes.map(n => n.key).sort()
const edges = (g: FeatureGraph, kind: GEdge['kind']) => g.edges.filter(e => e.kind === kind).map(e => `${e.from} -> ${e.to}`).sort()
const kindOf = (g: FeatureGraph, key: string) => g.nodes.find(n => n.key === key)?.kind

const BRUTAL = feat({
  name: 'Brutal Strike', activation: 'free', uses: { max: 1 }, recharge: 'turn',
  picks: 'has_improved_brutal_strike_enhanced ? 2 : 1',
  vars: [{ name: 'brutalStrikeReady', kind: 'derived', formula: 'recklessAttack && attacksThisTurn == 0' }],
  graph: [
    eff({ id: 'add', op: 'add', once: true, when: 'brutalStrikeReady', target: ['roll:damage.melee'],
      label: 'Add {has_improved_brutal_strike_enhanced ? 2d10 : 1d10}', value: 'has_improved_brutal_strike_enhanced ? 2d10 : 1d10' }),
    eff({ id: 'fb', op: 'note', once: true, ask: 'Forceful Blow?', when: 'brutalStrikeReady', target: ['roll:damage.melee'], label: 'Forceful Blow', text: 'Pushed 15 ft.' }),
    eff({ id: 'hb', op: 'note', once: true, ask: 'Hamstring Blow?', when: 'brutalStrikeReady', target: ['roll:damage.melee'], label: 'Hamstring Blow', text: 'Speed −15 ft.' }),
  ],
})

const JUDGEMENT = feat({
  name: 'Judgement', activation: 'action',
  vars: [
    { name: 'mercy', kind: 'stored', type: 'num', initial: 0 },
    { name: 'condemnation', kind: 'stored', type: 'num', initial: 0 },
    { name: 'judgementState', kind: 'stored', type: 'num', initial: 0 },
    { name: 'judgementDelta', kind: 'derived', formula: 'mercy - condemnation' },
    { name: 'isMerciful', kind: 'derived', formula: 'judgementDelta >= 3' },
    { name: 'nextJudgementState', kind: 'derived', formula: 'isMerciful ? 1 : 0' },
  ],
  graph: [
    eff({ id: 'set', op: 'setVar', variable: 'judgementState', value: 'nextJudgementState', when: 'nextJudgementState != judgementState', label: 'Recalculate Path' }),
    eff({ id: 'mend', op: 'setHp', value: 'hp + mercy * 3', ask: 'At least one creature failed the save', label: 'Mercy’s mend' }),
    eff({ id: 'shown', op: 'addVar', variable: 'mercy', value: '1', ask: 'At least one creature  FAILED the save ', label: 'Mercy shown' }),
    eff({ id: 'strike', op: 'add', value: '1d6', dmgType: 'radiant', when: 'mercy >= 2 && hit', target: ['tag:judgements_edge'], label: 'Merciful Strike' }),
  ],
})

const EMBER = feat({
  name: 'Ember Ward', activation: 'bonus',
  graph: [
    eff({ id: 'k1', op: 'add', value: '1', target: ['tag:Fire', 'tag:fire', 'roll:damage'], label: 'Kindled Blade' }),
    eff({ id: 'k4', op: 'adv', target: [], label: 'Ember Sight' }),
    eff({ id: 'k5', op: 'add', value: '1', match: 'and', target: ['tag:fire', 'tag:weapon'], label: 'Cinder Oath' }),
    eff({ id: 'b1', op: 'boost', stat: 'dex', value: '2', label: 'Nimble' }),
    eff({ id: 'u1', op: 'addUses', value: '1', target: [], label: 'Rekindle' }),
  ],
})

const SECOND_WIND = feat({
  name: 'Second Wind', activation: 'bonus', uses: { max: 1 }, recharge: 'short',
  graph: [eff({ id: 'heal', op: 'setHp', value: 'hp + 1d10 + level', label: 'Second Wind' })],
})

/* ---------- keys ---------- */

test('keys survive an edit that deletes nothing', () => {
  const before = keys(project(JUDGEMENT))
  const edited = { ...JUDGEMENT, graph: JUDGEMENT.graph!.map(e => (e.id === 'mend' ? { ...e, value: 'hp + 1' } : e)) }
  assert.deepEqual(keys(project(edited)), before)
})

test('a duplicated effect id still gets its own node', () => {
  const g = project(feat({ graph: [eff({ id: 'x', label: 'A' }), eff({ id: 'x', label: 'B' })] }))
  assert.deepEqual(g.nodes.filter(n => n.kind === 'contrib').map(n => n.key), ['eff:x', 'eff:x~2'])
})

/* ---------- the press and its gates ---------- */

test('one press reaches a lone outcome directly', () => {
  assert.deepEqual(edges(project(SECOND_WIND), 'flow'), ['press -> eff:heal'])
})

test('outcomes sharing an ask share ONE ask node — the engine makes them one checkbox', () => {
  const g = project(JUDGEMENT)
  assert.equal(g.nodes.filter(n => n.kind === 'ask').length, 1)
  const ask = 'ask:at least one creature failed the save'
  assert.deepEqual(edges(g, 'flow').filter(e => e.includes(ask)), [
    `${ask} -> eff:mend`, `${ask} -> eff:shown`, `press -> ${ask}`,
  ])
})

test('a when on an outcome becomes a condition between the press and it', () => {
  const g = project(JUDGEMENT)
  const cond = 'when:press|nextJudgementState != judgementState'
  assert.equal(kindOf(g, cond), 'cond')
  assert.ok(edges(g, 'flow').includes(`press -> ${cond}`))
  assert.ok(edges(g, 'flow').includes(`${cond} -> eff:set`))
})

test('ask then when chain, and a when under an ask is its own condition', () => {
  const g = project(feat({ activation: 'action', graph: [
    eff({ id: 'a', op: 'setHp', value: '1', ask: 'Q', when: 'hp < 5' }),
    eff({ id: 'b', op: 'setHp', value: '1', when: 'hp < 5' }),
  ] }))
  assert.deepEqual(edges(g, 'flow'), [
    'ask:q -> when:ask:q|hp < 5', 'press -> ask:q', 'press -> when:press|hp < 5',
    'when:ask:q|hp < 5 -> eff:a', 'when:press|hp < 5 -> eff:b',
  ])
})

test('a contribution’s when and ask stay on the node — they are not flow', () => {
  const g = project(JUDGEMENT)
  assert.ok(!g.edges.some(e => e.kind === 'flow' && e.to === 'eff:strike'))
  assert.equal(g.nodes.filter(n => n.kind === 'cond').length, 1)
})

test('no press, no flow: a pure contribution feature draws no press node', () => {
  const g = project(feat({ graph: [eff({ id: 'p', op: 'adv', target: ['roll:attack'] })] }))
  assert.equal(kindOf(g, 'press'), undefined)
})

test('activation left at none still gets a press when there is something to press', () => {
  // `activation: 'none'` is the editor's default, not a statement (isUsable).
  const g = project(feat({ activation: 'none', graph: [eff({ id: 'o', op: 'add', once: true, target: ['roll:attack'] })] }))
  assert.equal(kindOf(g, 'press'), 'press')
})

/* ---------- arms, offers, picks ---------- */

test('once contributions are armed by the press; once + ask are offers into picks', () => {
  const g = project(BRUTAL)
  assert.deepEqual(edges(g, 'arm'), ['press -> eff:add', 'press -> eff:fb', 'press -> eff:hb'])
  assert.deepEqual(edges(g, 'offer'), ['eff:fb -> picks', 'eff:hb -> picks'])
})

test('two offers make a picks node even with picks unset; one does not', () => {
  const two = project(feat({ graph: [eff({ id: 'a', once: true, ask: 'A?' }), eff({ id: 'b', once: true, ask: 'B?' })] }))
  const one = project(feat({ graph: [eff({ id: 'a', once: true, ask: 'A?' })] }))
  assert.equal(kindOf(two, 'picks'), 'picks')
  assert.equal(kindOf(one, 'picks'), undefined)
})

/* ---------- data wires ---------- */

test('a derived chain wires variable to variable, typed by what it carries', () => {
  const g = project(JUDGEMENT)
  const d = g.edges.filter((e): e is Extract<GEdge, { kind: 'data' }> => e.kind === 'data')
  const w = (from: string, to: string) => d.find(e => e.from === from && e.to === to)
  assert.equal(w('var:mercy', 'var:judgementDelta')?.type, 'n')
  assert.equal(w('var:judgementDelta', 'var:isMerciful')?.type, 'n')
  assert.equal(w('var:isMerciful', 'var:nextJudgementState')?.type, 'b')
  assert.equal(w('var:nextJudgementState', 'eff:set')?.field, 'value')
})

test('roll identifiers are roll context; sheet stats draw nothing; the turn counter is the engine', () => {
  const j = project(JUDGEMENT)
  assert.equal(kindOf(j, 'ctx:hit'), 'ctx')
  assert.ok(j.edges.some(e => e.kind === 'data' && e.from === 'ctx:hit' && e.to === 'eff:strike' && e.type === 'x'))
  assert.equal(kindOf(j, 'ext:hp'), undefined)
  assert.equal(kindOf(project(SECOND_WIND), 'ext:level'), undefined)

  const b = project(BRUTAL)
  const n = b.nodes.find(x => x.key === 'ext:attacksThisTurn')
  assert.ok(n && n.kind === 'ext' && n.decl === 'engine')
})

test('has_* and catalog identifiers are external; unknown ones draw nothing', () => {
  const g = project(BRUTAL, { recklessAttack: 'bool' })
  const ext = (k: string) => { const n = g.nodes.find(x => x.key === k); return n?.kind === 'ext' ? n.decl : undefined }
  assert.equal(ext('ext:recklessAttack'), 'catalog')
  assert.equal(ext('ext:has_improved_brutal_strike_enhanced'), 'has_*')
  assert.equal(kindOf(project(BRUTAL), 'ext:recklessAttack'), undefined)
})

test('an interpolation in a label is a read, and so is the picks formula', () => {
  const g = project(BRUTAL)
  const has = 'ext:has_improved_brutal_strike_enhanced'
  assert.ok(g.edges.some(e => e.kind === 'data' && e.from === has && e.to === 'eff:add' && e.field === 'label'))
  assert.ok(g.edges.some(e => e.kind === 'data' && e.from === has && e.to === 'picks' && e.type === 'b'))
})

test('a local variable shadows a catalog one of the same name', () => {
  const g = project(JUDGEMENT, { mercy: 'bool' })
  assert.equal(kindOf(g, 'ext:mercy'), undefined)
  assert.ok(g.edges.some(e => e.kind === 'data' && e.from === 'var:mercy' && e.to === 'eff:mend'))
})

/* ---------- applies-to ---------- */

test('selectors are keyed as the engine keys them: tag:Fire and tag:fire are one target', () => {
  const g = project(EMBER)
  assert.deepEqual(edges(g, 'target').filter(e => e.startsWith('eff:k1')), ['eff:k1 -> dest:roll:damage', 'eff:k1 -> dest:tag:fire'])
})

test('an and list is a junction; an or list is not', () => {
  const t = project(EMBER).edges.filter((e): e is Extract<GEdge, { kind: 'target' }> => e.kind === 'target')
  assert.ok(t.filter(e => e.from === 'eff:k5').every(e => e.and))
  assert.ok(t.filter(e => e.from === 'eff:k1').every(e => !e.and))
})

test('and over a single target is no junction — there is nothing to intersect', () => {
  const g = project(feat({ graph: [eff({ id: 'a', match: 'and', target: ['tag:fire'] })] }))
  assert.ok(g.edges.every(e => e.kind !== 'target' || !e.and))
})

test('an empty target means its own roll; a sheet op has no target at all', () => {
  const g = project(EMBER)
  const own = (k: string) => { const n = g.nodes.find(x => x.key === k); return n && 'own' in n ? n.own : undefined }
  assert.equal(own('eff:k4'), true)
  assert.equal(own('eff:u1'), true) // addUses reaches a feature — empty = this one's counter
  assert.equal(own('eff:b1'), false)
  assert.equal(kindOf(g, 'eff:b1'), 'sheet')
})

/* ---------- layout ---------- */

test('auto layout places every node once, and a saved position wins', () => {
  const g = project(BRUTAL, { recklessAttack: 'bool' })
  const pos = autoLayout(g, { 'eff:fb': [999, 7] })
  assert.deepEqual(Object.keys(pos).sort(), keys(g))
  assert.deepEqual(pos['eff:fb'], [999, 7])
  const auto = Object.entries(pos).filter(([k]) => k !== 'eff:fb').map(([, p]) => p.join(','))
  assert.equal(new Set(auto).size, auto.length)
})

test('a target sits level with the rule pointing at it, and two targets never overlap', () => {
  const g = project(EMBER)
  const h = () => 80
  const pos = autoLayout(g, {}, h)
  assert.equal(pos['dest:tag:weapon'][1] >= pos['eff:k5'][1], true)
  const ys = g.nodes.filter(n => n.kind === 'dest').map(n => pos[n.key][1]).sort((a, b) => a - b)
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 80, `dests overlap: ${ys}`)
  const lone = project(feat({ graph: [eff({ id: 'a', target: ['roll:attack'] })] }))
  const p = autoLayout(lone, { 'eff:a': [0, 500] }, h)
  assert.equal(p['dest:roll:attack'][1], 500)
})

test('a derived variable sits right of what it reads, and the press right of every variable', () => {
  const pos = autoLayout(project(JUDGEMENT))
  const x = (k: string) => pos[k][0]
  assert.ok(x('var:mercy') < x('var:judgementDelta'))
  assert.ok(x('var:judgementDelta') < x('var:isMerciful'))
  assert.ok(x('var:isMerciful') < x('var:nextJudgementState'))
  assert.ok(x('var:nextJudgementState') < x('press'))
  assert.ok(x('press') < x('eff:set'))
})

/* ---------- edits ---------- */

const ok = (r: { ok: boolean; f?: CatalogFeatureData; why?: string }) => {
  assert.ok(r.ok, (r as { why?: string }).why)
  return (r as { f: CatalogFeatureData }).f
}
const gatesOf = (f: CatalogFeatureData, id: string) => {
  const e = f.graph!.find(x => x.id === id)!
  return { ask: e.ask, when: e.when }
}
const PLAIN = feat({ activation: 'action', graph: [
  eff({ id: 'a', op: 'setHp', value: '1' }),
  eff({ id: 'b', op: 'setHp', value: '2', ask: 'Q?' }),
  eff({ id: 'c', op: 'setHp', value: '3', ask: 'Q?', when: 'hp < 5' }),
] })

test('regate: an outcome hung from an ask takes that ask; hung from the press loses its gates', () => {
  const f1 = ok(regate(PLAIN, 'eff:a', 'ask:q?'))
  assert.deepEqual(gatesOf(f1, 'a'), { ask: 'Q?', when: undefined })
  const f2 = ok(regate(PLAIN, 'eff:c', 'press'))
  assert.deepEqual(gatesOf(f2, 'c'), { ask: undefined, when: undefined })
})

test('regate: a condition under a condition is written as their conjunction', () => {
  const two = feat({ activation: 'action', graph: [eff({ id: 'x', op: 'setHp', value: '1', when: 'a' }), eff({ id: 'y', op: 'setHp', value: '1', when: 'b' })] })
  // Hanging the CONDITION b under a: everything behind b now needs both.
  const f = ok(regate(two, 'when:press|b', 'when:press|a'))
  assert.equal(gatesOf(f, 'y').when, '(a) && (b)')
  assert.equal(gatesOf(f, 'x').when, 'a')
  // Rewiring the OUTCOME y into a replaces its incoming wire: it now needs a only.
  assert.equal(gatesOf(ok(regate(two, 'eff:y', 'when:press|a')), 'y').when, 'a')
})

test('regate: moving a gate moves everything under it, and a second ask is refused', () => {
  const f = ok(regate(PLAIN, 'when:ask:q?|hp < 5', 'press'))
  assert.deepEqual(gatesOf(f, 'c'), { ask: undefined, when: 'hp < 5' })
  const twoAsks = feat({ activation: 'action', graph: [eff({ id: 'p', op: 'setHp', value: '1', ask: 'One?' }), eff({ id: 'q', op: 'setHp', value: '1', ask: 'Two?' })] })
  const r = regate(twoAsks, 'ask:two?', 'ask:one?')
  assert.equal(r.ok, false)
})

test('regate refuses what the schema cannot say', () => {
  assert.equal(regate(PLAIN, 'ask:q?', 'when:ask:q?|hp < 5').ok, false) // under itself
  const armed = feat({ activation: 'action', graph: [eff({ id: 'o', op: 'add', once: true, target: ['roll:attack'] })] })
  const r = regate(armed, 'eff:o', 'press')
  assert.ok(!r.ok && /armed/.test(r.why))
})

test('a pending gate is drawn, and wiring an outcome into it makes it real and keeps its place', () => {
  const add = addNode(PLAIN, 'cond', [500, 40], blankEffect)
  const f1 = ok(add)
  const pk = add.key!
  assert.equal(project(f1).nodes.find(n => n.key === pk)?.kind, 'cond')
  const f2 = ok(regate(editGate(f1, pk, 'hp > 0'), 'eff:a', pk))
  assert.deepEqual(gatesOf(f2, 'a'), { ask: undefined, when: 'hp > 0' })
  assert.equal(f2.layout?.pending?.length, 0)
  assert.deepEqual(f2.layout?.pos?.['when:press|hp > 0'], [500, 40])
})

test('editGate rewrites exactly the outcomes under it, and its position follows the new key', () => {
  const f0 = setPos(PLAIN, 'ask:q?', [10, 20])
  const f = editGate(f0, 'ask:q?', 'Did it land?')
  assert.equal(gatesOf(f, 'b').ask, 'Did it land?')
  assert.equal(gatesOf(f, 'c').ask, 'Did it land?')
  assert.equal(gatesOf(f, 'a').ask, undefined)
  assert.deepEqual(f.layout?.pos?.['ask:did it land?'], [10, 20])
})

test('removeNode: a gate hands its outcomes to its parent; a target leaves every rule', () => {
  const f = ok(removeNode(PLAIN, 'ask:q?'))
  assert.deepEqual(gatesOf(f, 'b'), { ask: undefined, when: undefined })
  assert.deepEqual(gatesOf(f, 'c'), { ask: undefined, when: 'hp < 5' })
  const g = ok(removeNode(EMBER, 'dest:tag:fire'))
  assert.deepEqual(g.graph!.find(e => e.id === 'k1')!.target, ['roll:damage'])
  assert.deepEqual(g.graph!.find(e => e.id === 'k5')!.target, ['tag:weapon'])
  assert.equal(removeNode(PLAIN, 'press').ok, false)
})

test('removeNode prunes the deleted node’s saved position', () => {
  const f = ok(removeNode(setPos(PLAIN, 'eff:a', [1, 2]), 'eff:a'))
  assert.equal(f.layout?.pos?.['eff:a'], undefined)
  assert.equal(f.graph!.some(e => e.id === 'a'), false)
})

test('addNode: effects come from the form’s defaults, and one-per-feature kinds refuse a second', () => {
  const r = addNode(feat({}), 'contrib', [0, 0], blankEffect)
  const f = ok(r)
  assert.equal(f.graph!.length, 1)
  assert.equal(f.graph![0].op, 'add')
  assert.deepEqual(f.layout?.pos?.[r.key!], [0, 0])
  assert.equal(addNode(PLAIN, 'press', [0, 0], blankEffect).ok, false)
  assert.equal(addNode(feat({ picks: 2 }), 'picks', [0, 0], blankEffect).ok, false)
  const v = ok(addNode(feat({ vars: [{ name: 'newVariable', kind: 'stored', type: 'num' }] }), 'var', [0, 0], blankEffect))
  assert.equal(v.vars![1].name, 'newVariable2')
})

/* ---------- applies-to edits ---------- */

const CAT = [{ gid: 'feature:rage' as const, tags: ['barbarian'] }, { gid: 'spell:fire_bolt' as const, tags: ['fire'] }]
const TGT = feat({ activation: 'bonus', graph: [
  eff({ id: 'g', op: 'grant', value: '1d6', label: 'Inspire', target: [] }),
  eff({ id: 'u', op: 'addUses', value: '1', label: 'Regain', target: [] }),
  eff({ id: 'p', op: 'add', value: '1', label: 'Bonus', target: ['tag:Fire'] }),
] })

test('targetRefusal answers with the audit: grant takes a roll, addUses a feature', () => {
  assert.equal(targetRefusal(TGT, 'eff:g', 'roll:d20', CAT), null)
  assert.match(targetRefusal(TGT, 'eff:g', 'tag:fire', CAT) ?? '', /Grant needs a roll target/)
  assert.equal(targetRefusal(TGT, 'eff:u', 'feature:rage', CAT), null)
  assert.match(targetRefusal(TGT, 'eff:u', 'roll:attack', CAT) ?? '', /addUses targets a feature/)
})

test('targetRefusal refuses a duplicate spelling and a rule with no target at all', () => {
  assert.match(targetRefusal(TGT, 'eff:p', 'tag:fire', CAT) ?? '', /already applies/)
  const sv = feat({ graph: [eff({ id: 's', op: 'setVar', variable: 'x', value: '1', label: 'Set' })] })
  assert.match(targetRefusal(sv, 'eff:s', 'roll:attack', CAT) ?? '', /no target/)
})

test('connect adds once; disconnect removes every spelling; match toggles', () => {
  const f1 = connectTarget(TGT, 'eff:p', 'roll:damage')
  assert.deepEqual(f1.graph![2].target, ['tag:Fire', 'roll:damage'])
  assert.deepEqual(connectTarget(f1, 'eff:p', 'roll:damage').graph![2].target, ['tag:Fire', 'roll:damage'])
  assert.deepEqual(disconnectTarget(f1, 'eff:p', 'tag:fire').graph![2].target, ['roll:damage'])
  assert.equal(setMatch(f1, 'eff:p', 'and').graph![2].match, 'and')
  assert.equal(setMatch(setMatch(f1, 'eff:p', 'and'), 'eff:p', 'or').graph![2].match, undefined)
})

test('retarget moves every rule on that target, and the target keeps its place', () => {
  const two = feat({ graph: [eff({ id: 'a', target: ['tag:fire'] }), eff({ id: 'b', target: ['tag:fire', 'roll:damage'] })], layout: { pos: { 'dest:tag:fire': [9, 9] } } })
  const f = retarget(two, 'tag:fire', 'tag:cold')
  assert.deepEqual(f.graph!.map(e => e.target), [['tag:cold'], ['tag:cold', 'roll:damage']])
  assert.deepEqual(f.layout?.pos?.['dest:tag:cold'], [9, 9])
  // Retargeting onto a target the rule already has does not duplicate it.
  assert.deepEqual(retarget(two, 'tag:fire', 'roll:damage').graph![1].target, ['roll:damage'])
})

test('targetRefusal: an armed rule takes rolls only, and a dangling reference is refused', () => {
  const armed = feat({ graph: [eff({ id: 'o', op: 'add', value: '1', once: true, target: [] })] })
  assert.match(targetRefusal(armed, 'eff:o', 'tag:fire', CAT) ?? '', /roll target/)
  assert.equal(targetRefusal(armed, 'eff:o', 'roll:attack', CAT), null)
  assert.match(targetRefusal(TGT, 'eff:p', 'spell:nope', CAT) ?? '', /Dangling target/)
  assert.equal(targetRefusal(TGT, 'eff:p', 'spell:fire_bolt', CAT), null)
})

test('targetRefusal judges the new selector alone — a list already wrong does not taint it', () => {
  // A grant whose list is already bad (a tag) may still take a roll.
  const bad = feat({ graph: [eff({ id: 'g', op: 'grant', value: '1d6', label: 'Inspire', target: ['tag:x'] })] })
  assert.equal(targetRefusal(bad, 'eff:g', 'roll:d20', CAT), null)
  // And an error that is not about targets (no label) is not a reason to refuse one.
  const unlabelled = feat({ graph: [eff({ id: 'g', op: 'grant', value: '1d6', label: '', target: [] })] })
  assert.equal(targetRefusal(unlabelled, 'eff:g', 'roll:d20', CAT), null)
})

test('a target’s legality depends on its kind, not its name — what lets the chooser audit once per kind', () => {
  // The chooser (components/FeatureGraph.tsx TargetChooser) audits one
  // representative per tag / roll kind / reference prefix. A future audit rule
  // that judged a selector by its particular name would make that wrong
  // silently — this is where it would show first.
  const cat = [
    { gid: 'feature:rage' as const, tags: ['barbarian', 'rage'] }, { gid: 'feature:bi' as const, tags: ['bard'] },
    { gid: 'spell:fire_bolt' as const, tags: ['fire'] }, { gid: 'spell:frost' as const, tags: ['cold'] },
    { gid: 'item:sunblade' as const, tags: ['radiant'] }, { gid: 'item:rope' as const, tags: [] },
  ]
  const byKind = (sels: string[]) => [sels.filter(s => s.startsWith('tag:')), ...['feature:', 'spell:', 'item:'].map(p => sels.filter(s => s.startsWith(p)))]
  const sels = [...cat.map(c => c.gid), ...cat.flatMap(c => c.tags.map(t => `tag:${t}`))]
  for (const e of [
    eff({ id: 'x', op: 'add', value: '1' }), eff({ id: 'x', op: 'add', value: '1', once: true }),
    eff({ id: 'x', op: 'grant', value: '1d6' }), eff({ id: 'x', op: 'addUses', value: '1' }),
    eff({ id: 'x', op: 'resist' }), eff({ id: 'x', op: 'note', text: 'n' }),
  ]) {
    const f = feat({ graph: [e] })
    for (const group of byKind(sels)) {
      const verdicts = new Set(group.map(s => targetRefusal(f, 'eff:x', s, cat) === null))
      assert.equal(verdicts.size, 1, `${e.op}${e.once ? ' (once)' : ''} judges ${group.join(', ')} differently`)
    }
  }
})
