// Run: node --test src/lib/expr.test.ts
// (Node's built-in test runner + type stripping — no framework, no new dep.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExprScope } from './expr.ts'
import { evalExpr, interpolate, interpolations, ROLL_IDENTS, VAR_IDENTS } from './expr.ts'

/** A variable formula's scope (§33): the whitelist plus declared variables. The
 *  Arbiter path values are §21's, which is the content that forced this engine. */
const VARS: ExprScope = {
  level: 7, prof: 3, str: 1, dex: 3, con: 2, int: 0, wis: 4, cha: -1, hp: 52, hpMax: 52, saveDc: 15,
  strScore: 12, dexScore: 16, conScore: 14, intScore: 10, wisScore: 18, chaScore: 9,
  attacksThisTurn: 0,
  mercy: 12, condemnation: 5, judgementState: 1, judgementBias: 5,
  isMercy: true, isCondemnation: false, isBalance: false, perfectJudgment: false,
  canSwitchToMercy: true, canSwitchToCondemnation: false, canSwitchToBalance: false,
  a: 1, b: 2,
}
/** A contribution formula's scope: the same, plus roll context. */
const ROLL: ExprScope = { ...VARS, cast: 3 }

const n = (flat: number, dice: string[] = []) => ({ t: 'num', flat, dice })
const b = (v: boolean) => ({ t: 'bool', v })

// --- value types (§36) -----------------------------------------------------

test('the three value types come back tagged', () => {
  assert.deepEqual(evalExpr('2d6 + 1d4 + 3', VARS), n(3, ['2d6', '1d4']))
  assert.deepEqual(evalExpr('mercy > condemnation', VARS), b(true))
  assert.deepEqual(evalExpr('[1,2,3][1]', VARS), n(2))
})

test('dice come back UNROLLED and uncombined — the caller rolls, so crit can double (§13)', () => {
  assert.deepEqual(evalExpr('1d6 + 1d6', VARS), n(0, ['1d6', '1d6']))
  assert.deepEqual(evalExpr('2d8 + prof', VARS), n(3, ['2d8']))
})

// --- precedence and parens (§29) -------------------------------------------

test('* binds tighter than +, and parens override it', () => {
  assert.deepEqual(evalExpr('1 + 2 * 3', VARS), n(7))
  assert.deepEqual(evalExpr('(1 + 2) * 3', VARS), n(9))
  assert.deepEqual(evalExpr('((1 + 2) * (3 + 4))', VARS), n(21))
})

test('comparison binds tighter than && / ||, so §22 containment reads as written', () => {
  // (isCondemnation || perfectJudgment) && condemnation >= 15
  assert.deepEqual(evalExpr('(isCondemnation || perfectJudgment) && condemnation >= 15', VARS), b(false))
  assert.deepEqual(evalExpr('mercy >= 10 && condemnation < 10', VARS), b(true))
  assert.deepEqual(evalExpr('!isMercy', VARS), b(false))
})

test('binary - is left-associative', () => {
  assert.deepEqual(evalExpr('10 - 3 - 2', VARS), n(5))
})

test('unary minus binds tighter than the binary operators, and never yields -0', () => {
  assert.deepEqual(evalExpr('-3 + 5', VARS), n(2))
  assert.deepEqual(evalExpr('2 * -3', VARS), n(-6))
  assert.deepEqual(evalExpr('-0', VARS), n(0))
})

// --- arithmetic (§14) ------------------------------------------------------

test('/ floor-divides — "half your level, rounded down" (§14)', () => {
  assert.deepEqual(evalExpr('level / 2', VARS), n(3)) // level 7
  assert.deepEqual(evalExpr('-7 / 2', VARS), n(-4)) // floor, not truncate
  assert.deepEqual(evalExpr('mercy / 5', VARS), n(2)) // §21's mercyTier
})

test('n * NdM multiplies the COUNT, not a result (§14)', () => {
  assert.deepEqual(evalExpr('2 * 2d6', VARS), n(0, ['4d6']))
  assert.deepEqual(evalExpr('2d6 * 2', VARS), n(0, ['4d6']))
  assert.deepEqual(evalExpr('prof * 1d4', VARS), n(0, ['3d4']))
  assert.deepEqual(evalExpr('0 * 2d6', VARS), n(0, [])) // a zero-count term is dropped
})

test('dice may be negated — Bane is -1d4 and `add` is the only op (§12)', () => {
  assert.deepEqual(evalExpr('1d8 - 1d4', VARS), n(0, ['1d8', '-1d4']))
  assert.deepEqual(evalExpr('-2d6', VARS), n(0, ['-2d6']))
  assert.deepEqual(evalExpr('-1d4 * 2', VARS), n(0, ['-2d4']))
})

// --- ternaries (§21/§22) ---------------------------------------------------

test('ternaries chain right-associatively — §21 nextJudgementState verbatim', () => {
  const src = 'canSwitchToBalance ? 0 : canSwitchToMercy ? 1 : canSwitchToCondemnation ? -1 : judgementState'
  assert.deepEqual(evalExpr(src, VARS), n(1))
  const balanced = { ...VARS, canSwitchToMercy: false, canSwitchToBalance: true }
  assert.deepEqual(evalExpr(src, balanced), n(0))
  const stuck = { ...VARS, canSwitchToMercy: false, judgementState: -1 }
  assert.deepEqual(evalExpr(src, stuck), n(-1)) // falls through to judgementState
})

test('ternary branches may carry dice as long as both share a `t` (§36)', () => {
  assert.deepEqual(evalExpr('isMercy ? 2d6 : 1d6', VARS), n(0, ['2d6']))
  assert.deepEqual(evalExpr('isCondemnation ? 2d6 : 1d6', VARS), n(0, ['1d6']))
})

// --- arrays (§35) ----------------------------------------------------------

test('arrays are 0-indexed and clamp to the nearest end, both ways (§35)', () => {
  assert.deepEqual(evalExpr('[1,2,3][0]', VARS), n(1))
  assert.deepEqual(evalExpr('[1,2,3][1]', VARS), n(2))
  assert.deepEqual(evalExpr('[1,2,3][-1]', VARS), n(1)) // clamps low, no error
  assert.deepEqual(evalExpr('[1,2,3][99]', VARS), n(3)) // clamps high, no wrap
})

test('a level-indexed progression table reads at the level (§35)', () => {
  const table = '[0,2,2,3,3,4][level]'
  assert.deepEqual(evalExpr(table, { level: 1 }), n(2))
  assert.deepEqual(evalExpr(table, { level: 4 }), n(3))
  assert.deepEqual(evalExpr(table, { level: 20 }), n(4)) // clamped
})

test('array elements may be expressions, so long as they stay dice-free numbers', () => {
  assert.deepEqual(evalExpr('[level, level * 2][1]', VARS), n(14))
})

// --- the two whitelists (§33) ----------------------------------------------

test('the scope IS the whitelist — roll context is rejected in a variable formula (§33)', () => {
  // The same string, the same walk; only the permitted set differs.
  assert.equal(evalExpr('cast * 2', VARS), null)
  assert.deepEqual(evalExpr('cast * 2', ROLL), n(6))
})

test('every whitelisted identifier resolves', () => {
  for (const id of [...VAR_IDENTS, ...ROLL_IDENTS]) {
    assert.notEqual(evalExpr(id, ROLL), null, `${id} should resolve`)
  }
})

test('inherited object properties are not identifiers', () => {
  assert.equal(evalExpr('toString', VARS), null)
  assert.equal(evalExpr('constructor', VARS), null)
})

// --- rejections ------------------------------------------------------------

test('§36 rejection table — every row returns null, never a wrong number', () => {
  const table: [string, string][] = [
    ['2d6 * 1d4', 'dice on both sides'],
    ['2d6 / 2', 'halve the count in the authored expression instead'],
    ['(1d6 + 2) * wis', "can't scale an unrolled dice term by a sum"],
    ['true * 2', 'arithmetic on a bool'],
    ['2d6 > 3', 'comparison on a dice value'],
    ['mercy[2]', 'indexing a non-array'],
    ['mercy ? a : b', 'ternary condition must be bool'],
  ]
  for (const [src, why] of table) assert.equal(evalExpr(src, ROLL), null, `${src} — ${why}`)
})

test('type errors outside §36 table are rejections too', () => {
  for (const src of [
    'isMercy ? 1 : true', // branches differ in type
    '!5', // ! on a num
    '5 && true', // && on a num
    'false && 5', // ...and the right side is still checked, despite JS short-circuit
    '[1,2] + 1', // arithmetic on an arr
    '[1,2] == [1,2]', // arrays are not comparable
    '1 == true', // operands differ in type
    '[1, true][0]', // bool element in an array
    '[1, 1d6][0]', // dice element in an array
    '[1,2,3][1d4]', // index must be a dice-free num
    '1d6 && true',
  ]) {
    assert.equal(evalExpr(src, ROLL), null, `${src} should be rejected`)
  }
})

test('unknown identifiers are rejected, so a typo blocks at author time (§33)', () => {
  assert.equal(evalExpr('foo + 1', VARS), null)
  assert.equal(evalExpr('mercy + condemantion', VARS), null) // misspelt
})

test('syntax errors are rejected, not thrown', () => {
  for (const src of ['', '  ', '1 +', '(1 + 2', '[1,2', 'a ? 1', '1 2', ')', '[]', '2 @ 3', 'level 2']) {
    assert.equal(evalExpr(src, VARS), null, `${JSON.stringify(src)} should be rejected`)
  }
})

test('arithmetic holes §36 leaves open are rejections, not Infinity or a fractional die', () => {
  assert.equal(evalExpr('5 / 0', VARS), null)
  assert.equal(evalExpr('level / (prof - 3)', VARS), null) // zero divisor via an expression
  assert.equal(evalExpr('1.5 * 2d6', VARS), null) // would be 3d6 by luck, 4.5d6 in general
})

// --- §25 inline compute ------------------------------------------------------

test('interpolate computes each span and leaves the rest of the sentence alone', () => {
  const out = interpolate('DC {8 + prof + wis}, Wisdom save.', { prof: 3, wis: 4 })
  assert.equal(out.text, 'DC 15, Wisdom save.')
  assert.deepEqual(out.bad, [])
})

test('a dice value reads as its expression, not as a rolled number', () => {
  // Display must not roll. §13: an unrolled term is the whole point.
  assert.equal(interpolate('Deals {2d6 + 1}.', {}).text, 'Deals 2d6 + 1.')
})

test('a bare boolean is refused — prose needs a phrase, not "true"', () => {
  const out = interpolate('It is {raging}.', { raging: true })
  assert.equal(out.text, 'It is {raging}.')
  assert.deepEqual(out.bad, ['raging'])
  // §25's own shape: a ternary picking a phrase.
  assert.equal(interpolate('It is{raging ? " raging" : " calm"}.', { raging: true }).text, 'It is raging.')
})

test('a failed span is left verbatim and named, never silently dropped', () => {
  const out = interpolate('DC {8 + nope} and {2 * 3}.', {})
  assert.equal(out.text, 'DC {8 + nope} and 6.')
  assert.deepEqual(out.bad, ['8 + nope'])
})

test('interpolations() finds every source, for the audit and the usage scan', () => {
  assert.deepEqual(interpolations('a {x} b {y + 1} c'), ['x', 'y + 1'])
  assert.deepEqual(interpolations('no braces here'), [])
})

test('string literals exist only to be chosen between', () => {
  assert.deepEqual(evalExpr('"held"', {}), { t: 'str', v: 'held' })
  assert.deepEqual(evalExpr('true ? "a" : "b"', {}), { t: 'str', v: 'a' })
  assert.equal(evalExpr('"a" + "b"', {}), null)        // no string arithmetic
  assert.equal(evalExpr('true ? "a" : 1', {}), null)   // §36: branches share a type
  assert.equal(evalExpr('"unterminated', {}), null)
})
