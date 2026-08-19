/**
 * Guard for the bug documented in docs/Chamfered_clip-path_corners_fix.md.
 *
 * An element with a 45° chamfer `clip-path` that also draws a plain CSS
 * `border` renders BARE CORNERS: the border draws along the straight edges and
 * clip-path slices the diagonal off with no border pixels on it. It has now
 * been fixed independently at least five times, because nothing about the
 * source looks wrong — you have to spot two missing diagonals at real zoom.
 *
 * So it is checked here instead of noticed. Four failure modes, all of which
 * have been live in this codebase:
 *
 *   1. NOT REGISTERED — the rule chamfers and borders but no `0.7071` block
 *      covers it. The original bug.
 *   2. `background` SHORTHAND — resets background-image to none. If the rule
 *      sits after the shared block, it silently deletes the diagonals that
 *      block just painted, and the fix looks like it did not work.
 *   3. `border-color` IN A VARIANT — the border and the stripes both key off
 *      --bc, so setting border-color alone recolours the straight edges and
 *      leaves the diagonals behind, e.g. amber edges meeting beige corners.
 *   4. `box-shadow: inset` AS THE EDGE — the same bug reached through a
 *      different property. An inset shadow follows the border-box RECTANGLE,
 *      so a chamfer slices both diagonals bare exactly as it does a border.
 *      This one shipped on the Spellbook's slot cells and the guard walked
 *      straight past it, because it was only ever looking for `border`.
 *
 * Hexagons and other non-45° polygons are excluded: they need the two-layer
 * frame+inner fix instead, which the doc covers separately.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIRS = ['src/screens', 'src/components', 'src/styles']

function cssFiles(): string[] {
  const out: string[] = []
  for (const dir of DIRS) {
    let names: string[] = []
    try { names = readdirSync(join(ROOT, dir)) } catch { continue }
    for (const n of names) if (n.endsWith('.css')) out.push(join(dir, n))
  }
  return out
}

/** Blank out comments so they can't be mistaken for selectors or declarations.
 *  Newlines are kept and every other character becomes a space, so reported
 *  line numbers still point at the real line in the real file — a guard that
 *  names the wrong line is worse than no guard. */
const decomment = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))

type Rule = { sel: string; decl: string; line: number }

function rules(css: string): Rule[] {
  const out: Rule[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({
      sel: m[1].trim().replace(/\s+/g, ' '),
      decl: m[2],
      line: css.slice(0, m.index).split('\n').length,
    })
  }
  return out
}

/** The 45° cut-corner shape. Excludes hexagons (`50% 0`), which need the
 *  two-layer fix rather than the gradient one. */
function isChamfer(decl: string): boolean {
  if (!/clip-path\s*:\s*polygon/.test(decl)) return false
  if (/50%\s+0/.test(decl)) return false
  return /calc\(100%\s*-\s*(var\(--cut\)|[\d.]+px)\)/.test(decl)
}

/** A real border on the straight edges. A lone `border-left` accent does not
 *  create the bare-diagonal problem, so it does not count. */
const hasBorder = (decl: string) =>
  /(^|[;{\s])border\s*:\s*[^;]*(solid|dashed)/.test(decl)

const lastClass = (sel: string) => sel.split(/\s+/).pop() ?? sel

/** Selectors covered by a `0.7071` block in the same file. */
function covered(rs: Rule[]): Set<string> {
  const set = new Set<string>()
  for (const r of rs) {
    if (!/0\.7071/.test(r.decl)) continue
    for (const s of r.sel.split(',')) {
      const sel = s.trim()
      set.add(sel)
      set.add(lastClass(sel))
    }
  }
  return set
}

const files = cssFiles().map(f => ({ f, rs: rules(decomment(readFileSync(join(ROOT, f), 'utf8'))) }))

test('every chamfered+bordered rule has its corner diagonals painted', () => {
  const bad: string[] = []
  for (const { f, rs } of files) {
    const ok = covered(rs)
    for (const r of rs) {
      if (!isChamfer(r.decl) || !hasBorder(r.decl)) continue
      if (/0\.7071/.test(r.decl)) continue                       // paints its own
      if (ok.has(r.sel) || ok.has(lastClass(r.sel))) continue    // shared block
      bad.push(`${f}:${r.line}  ${r.sel}`)
    }
  }
  assert.deepEqual(bad, [], `Chamfered + bordered, but no corner diagonals — add the selector to the
file's 0.7071 block and declare --cut/--bc (and --bw if the border is not 1px).
See docs/Chamfered_clip-path_corners_fix.md.\n  ${bad.join('\n  ')}\n`)
})

test('no chamfered+bordered rule uses the `background` shorthand, which erases the fix', () => {
  const bad: string[] = []
  for (const { f, rs } of files) {
    for (const r of rs) {
      // Only rules that rely on the gradient recipe. A two-layer frame+inner
      // element (a filled shape with an inset ::before, and no border) has no
      // background-image to lose, and `background` is the correct way to fill
      // it — that is the house style for hexagons and framed panels.
      if (!isChamfer(r.decl) || !hasBorder(r.decl)) continue
      if (/(^|[;{\s])background\s*:/.test(r.decl)) bad.push(`${f}:${r.line}  ${r.sel}`)
    }
  }
  assert.deepEqual(bad, [], `\`background:\` resets background-image to none and takes the corner
diagonals with it. Use \`background-color:\`.\n  ${bad.join('\n  ')}\n`)
})

/** An inset box-shadow used as the visible edge. `inset 0 0 0 1px` and
 *  `inset 0 0 0 1.5px` are the ring form; an inset shadow with real offsets or
 *  blur is a soft interior glow and draws no edge, so it is not a candidate. */
const hasInsetRing = (decl: string) =>
  /box-shadow\s*:[^;]*\binset\s+0\s+0\s+0\s+[\d.]+px/.test(decl)

/** The inner half of a two-layer frame. These legitimately carry an inset ring
 *  — it is an interior highlight, and the OUTER element is what draws the edge,
 *  so the chamfer has a stroke on every side already. Named rather than
 *  pattern-matched: "ends in Inner" would let a genuinely broken rule through
 *  by being called `.somethingInner`, and each of these was checked by hand.
 *  Adding a name here is a claim that a sibling frame element paints the edge. */
const FRAMED_INNERS = new Set([
  'src/screens/Codex.module.css .inner',
  'src/screens/Equipment.module.css .pInner',
  'src/screens/Lore.module.css .bpInner',
  'src/screens/Shard.module.css .hpInner',
  'src/screens/ShardTree.module.css .pnInner',
  'src/components/ShopTakeover.module.css .pnInner',
])

test('no chamfered rule draws its only edge with an inset box-shadow', () => {
  const bad: string[] = []
  for (const { f, rs } of files) {
    for (const r of rs) {
      if (!isChamfer(r.decl) || !hasInsetRing(r.decl)) continue
      if (hasBorder(r.decl)) continue                 // the border tests own it
      if (/0\.7071/.test(r.decl)) continue            // paints its own diagonals
      if (FRAMED_INNERS.has(`${f.replace(/\\/g, '/')} ${r.sel}`)) continue
      bad.push(`${f}:${r.line}  ${r.sel}`)
    }
  }
  assert.deepEqual(bad, [], `An inset box-shadow follows the border-box RECTANGLE, so a chamfer cuts
both diagonals off it exactly as it does a plain border — the cell renders with
two bare corners. Use the frame+inner pattern (fill the shape with the edge
colour, then a ::before inset 1.5px for the interior), or the 0.7071 gradient
recipe. If this rule is the inner half of a frame that already draws the edge,
add it to FRAMED_INNERS above.
See docs/Chamfered_clip-path_corners_fix.md.\n  ${bad.join('\n  ')}\n`)
})

test('recipe-covered elements recolour via --bc, never border-color', () => {
  const bad: string[] = []
  for (const { f, rs } of files) {
    const ok = covered(rs)
    for (const r of rs) {
      // `border-color` on its own line; border-left-color etc. are fine, those
      // are straight edges where a plain border is correct.
      if (!/(^|[;\s])border-color\s*:/.test(r.decl)) continue
      if (!ok.has(r.sel) && !ok.has(lastClass(r.sel))) continue
      if (/0\.7071/.test(r.decl)) continue      // the block itself sets it
      bad.push(`${f}:${r.line}  ${r.sel}`)
    }
  }
  assert.deepEqual(bad, [], `The border and the corner stripes both key off --bc, so border-color
alone recolours the straight edges and leaves the diagonals behind. Set --bc.\n  ${bad.join('\n  ')}\n`)
})

test('the scanner actually sees the codebase (guards against matching nothing)', () => {
  // A silent zero-file or zero-rule scan would make every test above pass
  // vacuously, which is the one way this guard could rot without anyone knowing.
  assert.ok(files.length >= 10, `expected to scan the CSS modules, found ${files.length} files`)
  const chamfered = files.flatMap(({ rs }) => rs.filter(r => isChamfer(r.decl)))
  assert.ok(chamfered.length >= 50, `expected many chamfered rules, found ${chamfered.length}`)
  const withBorder = chamfered.filter(r => hasBorder(r.decl))
  assert.ok(withBorder.length >= 20, `expected many chamfered+bordered rules, found ${withBorder.length}`)
})
