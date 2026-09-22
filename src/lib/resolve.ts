/**
 * THE RESOLVE — a roll's numbers decrypting onto their result, in the toast and
 * the Roll Context Panel alike. Design canvas:
 * https://claude.ai/artifact/2Uiut2sgN1dmdiasqjah2g
 *
 * PRESENTATION ONLY. Nothing here decides a number. Every surface renders the
 * real value from frame 0 and lays noise over it until that value's lock time,
 * so a screen reader, a copy or a slow device only ever has the result.
 *
 * ONE CLOCK: the roll's own `at`. The toast and the panel compute the same lock
 * times from it, so they lock on the same frames, and a surface opened
 * mid-resolve joins in phase instead of starting over. Anything past its lock —
 * every history entry — simply paints settled.
 *
 * Pure so `node --test` can load it; the React half is components/Resolve.tsx.
 */

/** A noise glyph lives one frame. */
export const FRAME = 40
/** The first die locks here. Long enough to read as a resolve, short enough
 *  that the number is never what the player waits on. */
export const FIRST = 180
const STAGGER = 45
/** The last die of any roll locks by FIRST + SPAN (315 ms)… */
const SPAN = 135
/** …and a line's total 85 ms after its last die: every total by 400 ms. */
export const TAIL = 85
/** A dropped die dims this long after the last die of its line locks. */
export const DIM = 40
/** The longest settle animation (the nat-20 flare). A lock younger than this
 *  still animates; an older one paints still, which is what stops a history
 *  entry flashing every time the panel opens. */
export const SETTLE = 520

/** Offsets in ms from the roll: when each die locks, per line, and each line's
 *  total. The stagger shrinks with the die count so 8d6 lands on the same
 *  budget as 1d20. A line with no dice (a save DC) was never rolled: 0. */
export function schedule(counts: number[]): { dice: number[][]; totals: number[] } {
  const n = counts.reduce((a, c) => a + c, 0)
  const s = n > 1 ? Math.min(STAGGER, SPAN / (n - 1)) : 0
  let k = 0
  const dice = counts.map(c => Array.from({ length: c }, () => FIRST + s * k++))
  return { dice, totals: dice.map(d => (d.length ? d[d.length - 1] + TAIL : 0)) }
}

type LineLike = { kind: string; dice: { v: number; sides: number; dropped?: boolean }[] }

export type LineClock = {
  /** Epoch ms each die locks. */
  dice: number[]
  total: number
  /** When a dropped die dims — both dice lock bright first, then the loser. */
  dim: number
  /** When the roll's outcome is known: the kept d20's lock. Crit and fumble
   *  chrome, the Hit/Miss verdict and crit-only dice wait for it. */
  decide: number
}

/** Lock times for every line of a roll, as epoch ms from its `at`.
 *
 *  A BURST is a reroll of one die: that die resolves again on its own (n = 1),
 *  and its line's total re-locks after it. Everything else keeps the times it
 *  already passed. */
export function entryClock(
  at: number, lines: LineLike[], burst?: { at: number; line: number; die: number } | null,
): { lines: LineClock[]; decide: number; done: number } {
  const s = schedule(lines.map(l => l.dice.length))
  const out = s.dice.map((d, i) => ({
    dice: d.map(o => at + o), total: at + s.totals[i], dim: at + (d.length ? d[d.length - 1] + DIM : 0),
  }))
  const dLine = lines.findIndex(l => l.kind !== 'damage' && l.dice.length > 0)
  const kept = dLine < 0 ? -1 : Math.max(0, lines[dLine].dice.findIndex(d => !d.dropped))
  let decide = dLine < 0 ? at : out[dLine].dice[kept]
  const b = burst ? out[burst.line] : undefined
  if (burst && b) {
    b.dice[burst.die] = burst.at + FIRST
    b.total = burst.at + FIRST + TAIL
    b.dim = burst.at + FIRST + DIM
    if (burst.line === dLine) decide = burst.at + FIRST
  }
  return {
    lines: out.map(l => ({ ...l, decide })),
    decide,
    done: Math.max(at, ...out.map(l => l.total)),
  }
}

/** A rider's own dice, rolled after the fact — the same schedule on its own clock. */
export function burstClock(at: number, n: number): { dice: number[]; total: number } {
  const s = schedule([n])
  return { dice: s.dice[0].map(o => at + o), total: at + s.totals[0] }
}

/** The kept d20's natural face, when it is one worth marking. A dropped 20 is
 *  not a natural 20 — under disadvantage it LOST — so it never flares. */
export function natOf(line: LineLike): 'nat20' | 'nat1' | undefined {
  if (line.kind === 'damage') return undefined
  const kept = line.dice.find(d => !d.dropped && d.sides === 20)
  return kept?.v === 20 ? 'nat20' : kept?.v === 1 ? 'nat1' : undefined
}

/* Cipher, not digits: a frame held by jank would otherwise be a readable wrong
   number, which is exactly what the resolve must never show. */
const CIPHER = '▒░▓#%/◊╳&§'

function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x27d4eb2f)
  h ^= h >>> 13
  return h >>> 0
}

/** `len` noise glyphs for one frame. Deterministic per (seed, frame), so a
 *  re-render inside a frame does not reshuffle. */
export function noise(len: number, seed: number, frame: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CIPHER[hash(seed * 13 + i, frame) % CIPHER.length]
  return out
}
