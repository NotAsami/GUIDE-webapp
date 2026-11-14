// Run: ENGINE=shadow node --test src/lib/engine.parity.test.ts
//
// What the two engines must agree on that no existing test happens to ask.
// Under ENGINE=shadow the facade runs both and throws on a difference, so every
// call below is a comparison even where it asserts nothing itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import '../../scripts/engine-node.mjs'
import * as ts from './expr.ts'
import { OPS } from './opSchema.ts'
import { same } from './engine/compare.ts'
import {
  evalExpr, freeIdents, hasIdent, interpolate, interpolations, isHasIdent, wasmConstants,
  parseDice, rerollDie, rollDice, rollHeal, rolledDice, rolledDiceTerms,
} from './engine/index.ts'
import type { ExprScope } from './engine/index.ts'

const VARS: ExprScope = { level: 7, prof: 3, wis: 4, half: 0.5, on: true }

test('the static constant lists equal the Rust engine\'s own', () => {
  const c = wasmConstants()
  assert.deepEqual(c.VAR_IDENTS, [...ts.VAR_IDENTS])
  assert.deepEqual(c.ROLL_IDENTS, [...ts.ROLL_IDENTS])
  assert.deepEqual(c.BOOST_IDENTS, [...ts.BOOST_IDENTS])
  assert.deepEqual(c.ROLL_IDENT_PROBE, ts.ROLL_IDENT_PROBE)
  assert.equal(c.HIT_ASK, ts.HIT_ASK)
  assert.equal(c.HAS_PREFIX, ts.HAS_PREFIX)
})

test('the comparison rule tells -0 from 0 and keeps NaN equal to itself', () => {
  assert.equal(same({ flat: -0 }, { flat: 0 }), false)
  assert.equal(same([NaN], [NaN]), true)
  assert.equal(same({ a: 1, b: undefined }, { a: 1 }), true)
  assert.equal(same({ a: null }, {}), false)
  assert.equal(same([1, 2], [2, 1]), false)
})

test('the four whitelist cases: variable, roll, boost, and the has_ exception', () => {
  assert.equal(evalExpr('cast >= 3', VARS), null) // a variable scope carries no roll context
  assert.deepEqual(evalExpr('cast >= 3', { ...VARS, cast: 3 }), { t: 'bool', v: true })
  assert.equal(evalExpr('level + wis', { level: 1, prof: 2 }), null) // a boost scope has two names
  assert.deepEqual(evalExpr('has_rage', VARS), { t: 'bool', v: false })
  assert.equal(evalExpr('has_Rage', VARS), null)
})

test('number edges: floor division, negative zero, fractions, huge literals', () => {
  for (const src of [
    '-7 / 2', '7 / -2', '0 / -5', '0 * -1', '-0', '1.5 + 1', 'half * 3', '0.1 + 0.2', '5 / 0', '5 / (1 - 1)',
    '1000000000000000000000 + 1', `${'9'.repeat(400)}`, `${'9'.repeat(400)} - ${'9'.repeat(400)}`,
    `[1,2,3][${'9'.repeat(400)}]`, '[1,2,3][0 - 1]', '[1,2,3][1.9]', '[1,2,3][-1.9]', '007', '1.', '.5', '1e3',
    'level == 7 ? 0 : 10 / 0', '1 == 1 == true', '1 < 2 < 3',
  ]) evalExpr(src, VARS)
})

test('dice edges: signs, scaling, leading zeros, exponent counts', () => {
  for (const src of [
    '1d8 - 1d4', '--1d4', '-(1d4 - 1d6)', 'wis * 1d6', '1d6 * -2', '-1 * 02d06', '0 * 1d6', '1d6 * 0.0',
    '1.5 * 2d6', '(1d6 + 2) * wis', '(1d6 + 2 - 2) * 2', '2d6 * 1d4', '2d6abc', '2d', '1.5d6', '2D6', '0d6', '1d0',
    '1000000000000000000000 * 1d6', `${'9'.repeat(400)} * 1d6`, `0 * ${'9'.repeat(400)}d6`,
  ]) evalExpr(src, VARS)
})

test('what the original throws on, the port throws on too', () => {
  assert.throws(() => evalExpr('2 * (1000000000000000000000 * 1d6)', VARS))
  assert.throws(() => interpolate('x {2 * (1000000000000000000000 * 1d6)} y', VARS))
})

test('JavaScript whitespace, not Rust\'s: U+FEFF and U+00A0 separate tokens, U+0085 does not', () => {
  assert.deepEqual(evalExpr('1﻿+ 2', VARS), { t: 'num', flat: 3, dice: [] })
  assert.equal(evalExpr('1\u0085+ 2', VARS), null)
  assert.deepEqual(interpolate('{﻿ nope  }', VARS).bad, ['nope'])
})

test('strings, identifiers and prose spans', () => {
  for (const src of ['"a" == "a"', '"a" == 1', '"unterminated', 'on ? "yes" : "no"', 'on ? 1 : "no"', 'Level', '_x', 'toString', 'constructor', '#', '']) {
    evalExpr(src, VARS)
    freeIdents(src)
  }
  for (const text of ['{level * 2}', '{{level}}', '{}', '{a{b}', '{a}}', '} {', '{2d6 - 3} {1d8 - 1d4} {2d6 + 0}', '{on}', '{[1,2]}', '{"é"}', '']) {
    interpolate(text, VARS)
    interpolations(text)
  }
  for (const name of ['Improved Brutal Strike (Enhanced)', 'İnfo KelvinK', '', '___', 'ΌΣΟΣ', 'ǅ']) {
    isHasIdent(hasIdent(name))
  }
})

// --- dice ------------------------------------------------------------------

test('parseDice: every spelling, and the signs', () => {
  for (const src of [
    '2d6', 'd8', '3d4 + 3', '3d4+3', '1d10 - 2', '-1d4', '- 2 D 6 - 0', '-0d6', '2d6-0', ' \uFEFF2d6\u00A0', '2\u0085d6',
    '', 'not dice', '2d', '2d6+', '2d6+1+1', '+1d4', '2d6x', '1e3d6', '2d6\n', 'ⅱd6', '٢d6', '1d6 + -1',
    `${'9'.repeat(30)}d6`, `2d${'9'.repeat(400)}`,
  ]) parseDice(src)
  assert.ok(Object.is(parseDice('-0d6')!.count, -0))
})

test('rolling draws the same dice in the same order on both engines', () => {
  for (let i = 0; i < 200; i++) {
    rollDice(3, 6); rollDice(0, 6); rollDice(-2, 6); rollDice(2.9, 6); rollDice(NaN, 6); rollDice(2, 0); rollDice(2, -4); rollDice(2, 2.5)
    rolledDice(2, 20)
    rolledDiceTerms(['1d4', '-1d6', 'junk', '2d8 + 3', '0d6', '-0d4'], i % 2 === 0)
    rolledDiceTerms(['1d6'])
    rerollDie(rerollDie({ v: 12, sides: 20 }))
    rerollDie({ v: 3, sides: 6, crit: true })
    for (const amount of [5, -3, 0, -0, 2.5, NaN, '2d4', '2d4 + 2', '02d4 - 1', '0d6 - 2', '1D8+0', '3 apples', 'd8', '-2', '-0', '', ' 7 ', '+4', '1d6 + -1']) rollHeal(amount)
  }
})

test('a rolled die is one draw: face = floor(random * sides) + 1', () => {
  const real = Math.random
  const tape = [0, 0.5, 0.999999]
  let i = 0
  Math.random = () => tape[i++]
  try { assert.deepEqual(rollDice(3, 6), [1, 4, 6]) } finally { Math.random = real }
})

// --- the op schema -----------------------------------------------------------

test('the op schema the Rust audit reads is the one the editor renders from', () => {
  const mine = wasmConstants().OPS
  const theirs = Object.fromEntries(Object.entries(OPS).map(([op, d]) => [op, {
    group: d.group,
    fields: d.fields.map(f => ({ key: f.key, label: f.label, required: !!f.required, array: f.type === 'array' })),
  }]))
  assert.deepEqual(mine, theirs)
})
