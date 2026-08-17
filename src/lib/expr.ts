/** Expression engine for the feature graph — slice 1a of
 *  docs/GUIDE_Codex_Graph_Engine.md (§29 parser, §33 whitelists, §35 arrays, §36 types).
 *
 *  Pure, and TOTAL: every rejection — syntax, unknown identifier, type error — returns
 *  null so the audit can block it at author time. Nothing throws at roll time.
 *
 *  Dice come back UNROLLED, as strings. The evaluator must not roll: crit doubles damage
 *  dice, and a rider that arrives pre-rolled can't be doubled (§13). Dice are also what
 *  make the arithmetic partial — `2d6 * 1d4` has no meaning as an unrolled string — which
 *  is why the rejections below are the point of this module, not an afterthought (§29).
 */

/** §36. `num` carries a flat part and unrolled dice terms; `arr` exists only as a
 *  literal, for level-indexed progression tables (§35). */
export type FormulaValue =
  | { t: 'num'; flat: number; dice: string[] }
  | { t: 'bool'; v: boolean }
  | { t: 'arr'; v: number[] }
  | { t: 'str'; v: string }

/** The scope IS the whitelist — an identifier absent from it is a rejection.
 *  `number | boolean` mirrors `VarDef.type: 'num' | 'bool'` (§30). */
export type ExprScope = Record<string, number | boolean>

/** §33's two whitelists. A variable formula's scope is built from VAR_IDENTS plus the
 *  declared variables; a contribution formula's adds ROLL_IDENTS. A variable that could
 *  read `cast` would stop being a function of character state and become a function of
 *  one particular roll, which is what the variable DAG's memo depends on not happening. */
export const VAR_IDENTS = ['level', 'prof', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'hp', 'hpMax', 'saveDc'] as const
export const ROLL_IDENTS = ['cast'] as const

// ---------------------------------------------------------------------------

class Reject extends Error {}
/** ponytail: the message is thrown away by evalExpr's null contract. When the editor
 *  wants "why", export a second entry point returning { value } | { err } — the parser
 *  needs no change. */
function reject(msg: string): never {
  throw new Reject(msg)
}

const num = (flat: number, dice: string[] = []): FormulaValue => ({ t: 'num', flat, dice })
const bool = (v: boolean): FormulaValue => ({ t: 'bool', v })
const str = (v: string): FormulaValue => ({ t: 'str', v })

function asNum(v: FormulaValue): { flat: number; dice: string[] } {
  if (v.t !== 'num') reject(`expected a number, got ${v.t}`)
  return v
}
/** A number with no dice — required anywhere a value must be comparable or countable. */
function plain(v: FormulaValue): number {
  const n = asNum(v)
  if (n.dice.length) reject('a dice value is not allowed here')
  return n.flat
}
function asBool(v: FormulaValue): boolean {
  if (v.t !== 'bool') reject(`expected a boolean, got ${v.t}`)
  return v.v
}

/** Emits `-1d4` (Bane — §12 has only an `add` op, so there is no other spelling).
 *  dice.ts parseDice() rejects that leading sign today, so 1c must teach it before
 *  anything rolls these, or the rider vanishes at the roller instead of erroring
 *  at the audit. See §39, obligation 1. */
const negDice = (dice: string[]) => dice.map((s) => (s.startsWith('-') ? s.slice(1) : `-${s}`))

/** `n * 2d6` multiplies the COUNT, not a result (§14). Own regex rather than dice.ts
 *  parseDice(): that one is anchored whole-string with an optional trailing modifier,
 *  and rejects the leading sign this grammar emits for `-1d4`. These strings are ones
 *  the lexer produced, so the match always succeeds. */
function scaleDice(dice: string[], k: number): string[] {
  return dice.flatMap((s) => {
    const m = /^(-?)(\d+)d(\d+)$/.exec(s)!
    const count = (m[1] ? -1 : 1) * parseInt(m[2], 10) * k
    return count === 0 ? [] : [`${count < 0 ? '-' : ''}${Math.abs(count)}d${m[3]}`]
  })
}

function apply(op: string, l: FormulaValue, r: FormulaValue): FormulaValue {
  switch (op) {
    case '+':
    case '-': {
      const a = asNum(l)
      const b = asNum(r)
      return op === '-'
        ? num(a.flat - b.flat, [...a.dice, ...negDice(b.dice)])
        : num(a.flat + b.flat, [...a.dice, ...b.dice])
    }
    case '*': {
      const a = asNum(l)
      const b = asNum(r)
      if (a.dice.length && b.dice.length) reject('dice on both sides of *')
      const [dv, sv] = a.dice.length ? [a, b] : [b, a]
      if (!dv.dice.length) return num(a.flat * b.flat)
      // `(1d6 + 2) * wis` — an unrolled dice term added to a flat can't be scaled (§36).
      if (dv.flat !== 0) reject('cannot scale a dice term added to a flat value')
      if (sv.dice.length) reject('dice on both sides of *')
      if (!Number.isInteger(sv.flat)) reject('a dice count must stay a whole number')
      return num(0, scaleDice(dv.dice, sv.flat))
    }
    case '/': {
      const a = plain(l)
      const b = plain(r)
      if (b === 0) reject('division by zero')
      return num(Math.floor(a / b)) // §14: 5e never wants a fraction
    }
    case '<': return bool(plain(l) < plain(r))
    case '<=': return bool(plain(l) <= plain(r))
    case '>': return bool(plain(l) > plain(r))
    case '>=': return bool(plain(l) >= plain(r))
    case '==':
    case '!=': {
      if (l.t !== r.t) reject('== operands differ in type')
      if (l.t === 'arr') reject('arrays are not comparable')
      const eq = l.t === 'num' ? plain(l) === plain(r)
        : l.t === 'str' ? l.v === (r as { t: 'str'; v: string }).v
        : asBool(l) === asBool(r)
      return bool(op === '==' ? eq : !eq)
    }
    // Both sides forced through asBool: JS && would skip the right-hand type check.
    case '&&': {
      const a = asBool(l)
      const b = asBool(r)
      return bool(a && b)
    }
    case '||': {
      const a = asBool(l)
      const b = asBool(r)
      return bool(a || b)
    }
  }
  reject(`unknown operator ${op}`)
}

// --- lexer -----------------------------------------------------------------

type Tok =
  | { k: 'n'; v: number } | { k: 'd'; v: string } | { k: 'i'; v: string }
  | { k: 's'; v: string } | { k: 'p'; v: string }

/** Two-character operators first, so `<=` never lexes as `<` then `=`. */
const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '<', '>', '!', '(', ')', '[', ']', ',', '?', ':']

function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const ws = /^\s+/.exec(rest)
    if (ws) {
      i += ws[0].length
      continue
    }
    // Dice before number, or `2d6` lexes as `2` followed by an identifier `d6`.
    const d = /^(\d+)d(\d+)/.exec(rest)
    if (d) {
      out.push({ k: 'd', v: `${d[1]}d${d[2]}` })
      i += d[0].length
      continue
    }
    const n = /^\d+(?:\.\d+)?/.exec(rest)
    if (n) {
      out.push({ k: 'n', v: parseFloat(n[0]) })
      i += n[0].length
      continue
    }
    // §25's conditional phrase: {upgraded ? "and restrains the target." : "."}.
    // Literals only — there is no string arithmetic, so a ternary choosing between
    // two of them is the entire feature.
    if (rest[0] === '"') {
      const end = rest.indexOf('"', 1)
      if (end < 0) reject('unterminated string')
      out.push({ k: 's', v: rest.slice(1, end) })
      i += end + 1
      continue
    }
    const id = /^[a-z][a-zA-Z0-9]*/.exec(rest) // §30's identifier shape
    if (id) {
      out.push({ k: 'i', v: id[0] })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => rest.startsWith(o))
    if (!op) reject(`unexpected character ${JSON.stringify(rest[0])}`)
    out.push({ k: 'p', v: op })
    i += op.length
  }
  return out
}

/** Every identifier a formula references, in source order, deduped. Lex-only:
 *  an identifier token IS a reference, so this needs no parse and there is still
 *  no AST. Returns [] when the source doesn't even lex — evalExpr rejects it
 *  anyway, so a broken formula reads as one with no dependencies.
 *
 *  This is what the variable DAG builds its edges from. */
export function freeIdents(src: string): string[] {
  try {
    const names = lex(src)
      .filter((t): t is { k: 'i'; v: string } => t.k === 'i')
      .map(t => t.v)
      .filter(v => v !== 'true' && v !== 'false')
    return [...new Set(names)]
  } catch {
    return []
  }
}

/** Precedence climbing (§29). Ternary sits below all of these and is right-associative,
 *  so `a ? 1 : b ? 2 : 3` chains the way §21's nextJudgementState needs. */
const PREC: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6,
}

// --- entry point -----------------------------------------------------------

/** Evaluate `src` against `scope`. Returns null on ANY rejection; never throws.
 *  Parses and evaluates in one pass — nothing downstream inspects a formula's
 *  structure, so there is no AST to build. */
export function evalExpr(src: string, scope: ExprScope): FormulaValue | null {
  const toks: Tok[] = []
  let pos = 0

  const at = (v: string) => {
    const t = toks[pos]
    return !!t && t.k === 'p' && t.v === v
  }
  const eat = (v: string) => {
    if (!at(v)) reject(`expected ${v}`)
    pos++
  }

  function expr(): FormulaValue {
    const c = binary(0)
    if (!at('?')) return c
    pos++
    const cond = asBool(c)
    const a = expr()
    eat(':')
    const b = expr()
    // Both branches are evaluated: §36 requires them to share a `t`, and a type error
    // in the untaken branch is an authoring bug the audit must catch now.
    if (a.t !== b.t) reject('ternary branches differ in type')
    return cond ? a : b
  }

  function binary(min: number): FormulaValue {
    let left = unary()
    for (;;) {
      const t = toks[pos]
      if (!t || t.k !== 'p') break
      const p = PREC[t.v]
      if (p === undefined || p < min) break
      pos++
      left = apply(t.v, left, binary(p + 1)) // p + 1 → left-associative
    }
    return left
  }

  function unary(): FormulaValue {
    if (at('-')) {
      pos++
      const v = asNum(unary())
      return num(0 - v.flat, negDice(v.dice)) // 0 - x, not -x, to avoid -0
    }
    if (at('!')) {
      pos++
      return bool(!asBool(unary()))
    }
    return postfix()
  }

  function postfix(): FormulaValue {
    let v = primary()
    while (at('[')) {
      pos++
      const i = plain(expr())
      eat(']')
      if (v.t !== 'arr') reject('cannot index a non-array')
      // §35: 0-indexed, and out of range clamps to the nearest end — no error at level 21.
      v = num(v.v[Math.min(v.v.length - 1, Math.max(0, Math.trunc(i)))])
    }
    return v
  }

  function primary(): FormulaValue {
    const t = toks[pos]
    if (!t) reject('unexpected end of expression')
    pos++
    if (t.k === 'n') return num(t.v)
    if (t.k === 'd') return num(0, [t.v])
    if (t.k === 's') return str(t.v)
    if (t.k === 'i') {
      if (t.v === 'true' || t.v === 'false') return bool(t.v === 'true')
      // The scope IS the whitelist (§33): one lookup enforces both permitted sets,
      // differing only in what the caller put in the scope.
      if (!Object.hasOwn(scope, t.v)) reject(`unknown identifier ${t.v}`)
      const raw = scope[t.v]
      return typeof raw === 'boolean' ? bool(raw) : num(raw)
    }
    if (t.v === '(') {
      const v = expr()
      eat(')')
      return v
    }
    if (t.v === '[') {
      const items: number[] = []
      for (;;) {
        items.push(plain(expr())) // §35: numeric and dice-free
        if (!at(',')) break
        pos++
      }
      eat(']')
      return { t: 'arr', v: items }
    }
    reject(`unexpected ${t.v}`)
  }

  try {
    toks.push(...lex(src))
    const v = expr()
    if (pos < toks.length) reject('trailing input')
    return v
  } catch (e) {
    if (e instanceof Reject) return null
    throw e
  }
}

// --- §25's inline compute --------------------------------------------------

/** `{...}` spans, non-greedy and non-nesting. Prose is prose; an expression that
 *  needs a brace inside a brace has outgrown being written in a sentence. */
const INTERP = /\{([^{}]*)\}/g

/** Every interpolated source in a piece of prose, in order.
 *
 *  The audit needs this for two things the author would otherwise only discover
 *  at the table: an identifier that does not exist, and a variable that IS read —
 *  only for display — being reported as never used. */
export function interpolations(text: string): string[] {
  return [...(text ?? '').matchAll(INTERP)].map(m => m[1])
}

/** How a value reads inside a sentence. A bare boolean is deliberately refused:
 *  "you deal true damage" is not prose, and §25's own example routes booleans
 *  through a ternary to a phrase. */
function display(v: FormulaValue): string | null {
  if (v.t === 'str') return v.v
  if (v.t === 'num') {
    if (!v.dice.length) return String(v.flat)
    const d = v.dice.join(' + ')
    return v.flat ? `${d} ${v.flat > 0 ? '+' : '−'} ${Math.abs(v.flat)}` : d
  }
  return null
}

/** §25: `{level * 2}` in rule text renders as `16`. Display only — this never
 *  touches a number the engine computed, it only stops a description quietly
 *  lying as the character levels.
 *
 *  A span that does not evaluate is left EXACTLY as it was written and named in
 *  `bad`. Silently dropping it would hide the fault from author and player both;
 *  the audit catches these at authoring time, and resolve() reports any that
 *  still reach a roll. */
export function interpolate(text: string, scope: ExprScope): { text: string; bad: string[] } {
  const bad: string[] = []
  const out = (text ?? '').replace(INTERP, (raw, src: string) => {
    const v = evalExpr(src, scope)
    const shown = v && display(v)
    if (shown === null || shown === undefined) {
      bad.push(src.trim())
      return raw
    }
    return shown
  })
  return { text: out, bad }
}
