#!/usr/bin/env node
/**
 * The TypeScript engine as an ORACLE for the Rust property tests.
 *
 * engine/core/tests/*_oracle.rs starts this once and talks to it over
 * stdin/stdout, one JSON request per line, one JSON answer per line. Rust
 * generates the inputs (so proptest can shrink a failure); this says what the
 * original engine does with them.
 *
 * Numbers travel as STRINGS in both directions — JSON has no NaN, no Infinity
 * and no -0, and those are exactly the values the two engines could disagree on.
 */
import { createInterface } from 'node:readline'
import * as burden from '../src/lib/burden.ts'
import * as dice from '../src/lib/dice.ts'
import * as fx from '../src/lib/effects.ts'
import * as mods from '../src/lib/modEditor.ts'
import * as shards from '../src/lib/shards.ts'
import * as expr from '../src/lib/expr.ts'

const num = n => (Object.is(n, -0) ? '-0' : String(n))
const unnum = s => (s === '-0' ? -0 : Number(s))
const encode = v => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? num(x) : x)) ?? 'null')
const scope = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'string' ? unnum(v) : v]))

/** Run a rolling function against a recorded tape instead of Math.random, and
 *  say how many draws it took — drawing a different number is a difference. */
function rolled(tape, f) {
  const real = Math.random
  let used = 0
  Math.random = () => (used < tape.length ? unnum(tape[used++]) : (used++, NaN))
  try { return { out: f(), used } } finally { Math.random = real }
}

const FNS = {
  // The sheet layer. Inputs are plain JSON (finite numbers only), so they travel as they are.
  effectiveSheet: r => fx.effectiveSheet(r.character, r.trees),
  activeSources: r => fx.activeSources(r.character, r.trees),
  gearFeatures: r => fx.gearFeatures(r.character),
  shardFeatures: r => shards.shardFeatures(r.character, r.trees),
  carryMultiplier: r => fx.carryMultiplier(r.character, r.trees),
  currentBurden: r => burden.currentBurden(r.character),
  sheetEffects: r => mods.sheetEffects(r.graph, r.scope ?? undefined),
  compileEffects: r => mods.compileEffects(r.mods, r.skills ?? undefined),
  toNumber: r => Number(r.src),
  round: r => Math.round(unnum(r.src)),
  parseDice: r => dice.parseDice(r.src),
  rollDice: r => rolled(r.tape, () => dice.rollDice(unnum(r.count), unnum(r.sides))),
  rolledDiceTerms: r => rolled(r.tape, () => dice.rolledDiceTerms(r.exprs, r.double)),
  rerollDie: r => rolled(r.tape, () => dice.rerollDie(scope(r.die))),
  rollHeal: r => rolled(r.tape, () => dice.rollHeal(r.text ?? unnum(r.number))),
  evalExpr: r => expr.evalExpr(r.src, scope(r.scope)),
  freeIdents: r => expr.freeIdents(r.src),
  interpolate: r => expr.interpolate(r.src, scope(r.scope)),
  interpolations: r => expr.interpolations(r.src),
  hasIdent: r => expr.hasIdent(r.src),
  isHasIdent: r => expr.isHasIdent(r.src),
  // The JavaScript primitives the port re-implements in engine/core/src/js.rs.
  trim: r => r.src.trim(),
  lower: r => r.src.toLowerCase(),
  str: r => String(unnum(r.src)),
  /** toLowerCase() of every code point in [from, to), surrogates skipped. */
  lowerRange: r => {
    const out = []
    for (let cp = r.from; cp < r.to; cp++) if (cp < 0xd800 || cp > 0xdfff) out.push(String.fromCodePoint(cp).toLowerCase())
    return out
  },
  /** Which code points in [from, to) JavaScript's \s matches. */
  spaceRange: r => {
    const out = []
    for (let cp = r.from; cp < r.to; cp++) if (/^\s$/u.test(String.fromCodePoint(cp))) out.push(cp)
    return out
  },
}

for await (const line of createInterface({ input: process.stdin })) {
  let answer
  try {
    const req = JSON.parse(line)
    answer = { ok: encode(FNS[req.fn](req)) }
  } catch {
    answer = { threw: true }
  }
  process.stdout.write(JSON.stringify(answer) + '\n')
}
