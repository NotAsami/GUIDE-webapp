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
import * as expr from '../src/lib/expr.ts'

const num = n => (Object.is(n, -0) ? '-0' : String(n))
const unnum = s => (s === '-0' ? -0 : Number(s))
const encode = v => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' ? num(x) : x)) ?? 'null')
const scope = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'string' ? unnum(v) : v]))

const FNS = {
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
