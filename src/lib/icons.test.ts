// Run: node --test src/lib/icons.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ICONS, ICON_GROUPS } from './icons.ts'

/**
 * Every glyph the eight per-editor arrays offered before they were merged into
 * one list. Frozen deliberately: a DM has already picked some of these and the
 * value is stored on the catalog row, so dropping one from the palette means an
 * existing feature/class/item shows an icon its own editor can no longer offer —
 * and the picker just renders nothing selected, which reads as a lost setting
 * rather than a missing option.
 */
const WAS_OFFERED = [
  'fa-anchor', 'fa-angles-up', 'fa-arrow-down-short-wide', 'fa-arrow-up-right-dots',
  'fa-arrows-rotate', 'fa-bed', 'fa-biohazard', 'fa-bolt',
  'fa-bone', 'fa-book', 'fa-book-bible', 'fa-book-open',
  'fa-book-skull', 'fa-box', 'fa-brain', 'fa-bullseye',
  'fa-burst', 'fa-chess-rook', 'fa-clock', 'fa-coins',
  'fa-comment', 'fa-compass', 'fa-cross', 'fa-crosshairs',
  'fa-crow', 'fa-diamond', 'fa-dice-d20', 'fa-dna',
  'fa-door-open', 'fa-dragon', 'fa-droplet', 'fa-drum',
  'fa-drumstick-bite', 'fa-dumbbell', 'fa-explosion', 'fa-eye',
  'fa-feather', 'fa-fire', 'fa-fire-flame-curved', 'fa-flask',
  'fa-gavel', 'fa-gem', 'fa-ghost', 'fa-hammer',
  'fa-hand-fist', 'fa-hand-sparkles', 'fa-hands-praying', 'fa-handshake',
  'fa-hat-wizard', 'fa-heart-pulse', 'fa-helmet-safety', 'fa-hourglass-half',
  'fa-key', 'fa-khanda', 'fa-leaf', 'fa-link',
  'fa-location-arrow', 'fa-lock', 'fa-lungs', 'fa-map',
  'fa-mask', 'fa-masks-theater', 'fa-meteor', 'fa-microscope',
  'fa-moon', 'fa-mortar-pestle', 'fa-mountain', 'fa-music',
  'fa-paw', 'fa-radiation', 'fa-ring', 'fa-scroll',
  'fa-seedling', 'fa-shield', 'fa-shield-halved', 'fa-shield-heart',
  'fa-shirt', 'fa-shoe-prints', 'fa-shop', 'fa-shuffle',
  'fa-signal', 'fa-skull', 'fa-snowflake', 'fa-spider',
  'fa-staff-snake', 'fa-star', 'fa-store', 'fa-sun',
  'fa-tower-broadcast', 'fa-tree', 'fa-triangle-exclamation', 'fa-user',
  'fa-user-tie', 'fa-utensils', 'fa-vial', 'fa-wand-sparkles',
  'fa-water', 'fa-wave-square', 'fa-wind',
] as const

test('THE MERGE LOST NOTHING — every icon the old pickers offered is still here', () => {
  const have = new Set(ICONS)
  const gone = WAS_OFFERED.filter(i => !have.has(i))
  assert.deepEqual(gone, [], `dropped from the palette: ${gone.join(', ')}`)
})

test('one list, no duplicates', () => {
  // A duplicate renders twice in every picker and is invisible in review.
  const seen = new Map()
  for (const i of ICONS) seen.set(i, (seen.get(i) ?? 0) + 1)
  const dupes = [...seen].filter(([, n]) => n > 1).map(([i]) => i)
  assert.deepEqual(dupes, [])
})

test('every entry is a well-formed Font Awesome name', () => {
  // `fa-solid ${icon}` is how these are rendered, so a stray prefix or a
  // capital silently produces an empty box.
  for (const i of ICONS) assert.match(i, /^fa-[a-z0-9-]+$/, `bad icon name: ${i}`)
})

test('the groups are the list — no icon hides outside a section', () => {
  // ICONS is derived from ICON_GROUPS, so this pins that they cannot drift
  // apart if someone later hand-maintains the flat array.
  const fromGroups = ICON_GROUPS.flatMap(g => g.icons)
  assert.deepEqual([...ICONS], fromGroups)
  for (const g of ICON_GROUPS) assert.ok(g.icons.length > 0, `empty group: ${g.label}`)
})

test('the palette is actually bigger than the biggest list it replaced', () => {
  // The feature editor had 69 and was the outlier the user noticed; the shop
  // editor had 12. The point of the merge was that every editor gets the rich one.
  assert.ok(ICONS.length > 250, `only ${ICONS.length} icons`)
})

/* ==================================================================
   Every authored icon goes through <Icon>.

   `gi:lorc/aura` interpolated into `className={`fa-solid ${…}`}` produces
   `class="fa-solid gi:lorc/aura"` — Font Awesome has no such glyph, so the
   element renders as NOTHING. No error, no fallback box, just a hole where
   the icon was; the Inventory grid tile did exactly this while the list row
   directly beneath it, which already used <Icon>, drew the same item fine.

   That is the cost of two render paths for one value: adding a second icon
   set fixed 128 call sites and silently missed the four that had been written
   by hand.
   ================================================================== */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function tsxFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) tsxFiles(`${dir}/${e.name}`, out)
    else if (e.name.endsWith('.tsx')) out.push(`${dir}/${e.name}`)
  }
  return out
}

/**
 * Interpolations that read from a hardcoded map or literal union of `fa-`
 * names, which by construction can never hold a `gi:` value.
 *
 * Each entry is a claim about its source, not a shrug — the day one of these
 * maps takes an authored value it has to come OFF this list and go through
 * <Icon> instead.
 */
const FA_ONLY: { match: string; why: string }[] = [
  { match: '${K.ic}', why: 'GraphEffects op-kind chips — literal fa- names in a local const' },
  { match: '${FLAG_ICON[', why: 'roll flag glyphs — fixed map, one entry per RollFlag' },
  { match: '${CAT_CORNER[', why: 'item-category corner mark — fixed map, one per ItemCategory' },
  { match: '${iconFor(', why: 'party class glyph — CLASS_ICONS lookup, falls back to fa-user' },
  { match: '${g}', why: 'identity Menu Glyph picker — iterates the hardcoded GLYPHS array' },
  { match: '${def.corner}', why: 'public-vitals card corner — literal on the field definition' },
]

/** The glyph slot of a `fa-solid ${…}` template, and whether every value it
 *  can produce is a literal.
 *
 *  Presence of a literal is NOT enough, which is the trap the first version of
 *  this guard fell into: `${item.icon ?? 'fa-cube'}` contains `'fa-cube'` and
 *  is still the exact bug — the fallback is a literal, the VALUE is authored
 *  data. So the literals are blanked to `LIT`, the ternary conditions are
 *  struck out, and what must remain is nothing but LITs and the `:` between
 *  them. A condition may read anything it likes; a value may not. */
function literalOnly(expr: string): boolean {
  const lit = expr.replace(/'[^']*'/g, 'LIT')
  const values = lit.replace(/[^?:]*\?(?![.?])/g, '')   // strike the conditions
  return /^[\sLIT:]*$/.test(values) && values.includes('LIT')
}

/** Every glyph slot in the file: the interpolation immediately after
 *  `fa-solid `, wherever in the template it sits — `${styles.x} fa-solid ${…}`
 *  is a real shape, so anchoring on the backtick would miss it. */
function glyphSlots(src: string): { expr: string; index: number }[] {
  return [...src.matchAll(/fa-solid \$\{([^}]*)\}/g)].map(m => ({ expr: m[1], index: m.index! }))
}

test('EVERY AUTHORED ICON RENDERS THROUGH <Icon>, never raw into a fa-solid class', () => {
  const bare: string[] = []
  for (const f of tsxFiles()) {
    if (f.endsWith('components/Icon.tsx')) continue   // the one place that may branch
    const src = readFileSync(join(ROOT, f), 'utf8')
    for (const { expr, index } of glyphSlots(src)) {
      if (literalOnly(expr)) continue
      if (FA_ONLY.some(p => `${'${'}${expr}}`.includes(p.match))) continue
      bare.push(`${f}:${src.slice(0, index).split('\n').length}  ${'${'}${expr}}`)
    }
  }
  assert.deepEqual(bare, [],
    'These interpolate a value into a Font Awesome class. A game-icons value '
    + '(gi:…) renders as an invisible nothing there.\n'
    + 'Use <Icon name={…}/>, or add to FA_ONLY with the reason the source can '
    + 'only ever hold fa- names:\n  ' + bare.join('\n  '))
})

test('the icon scanner actually sees the codebase', () => {
  // Without this the regex could stop matching and the guard above would pass
  // forever — the failure mode of every source scan.
  const all = tsxFiles().map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  assert.ok(glyphSlots(all).length > 10, 'found almost no glyph slots — regex drifted')
  assert.ok(all.includes('<Icon name='), 'found no <Icon> call sites at all')
})

test('literalOnly tells a fallback apart from a choice', () => {
  // The distinction the whole guard rests on, pinned directly so a future
  // tweak to the regex cannot quietly re-open the case that shipped.
  assert.ok(literalOnly("cond ? 'fa-moon' : 'fa-campground'"), 'ternary over literals is safe')
  assert.ok(literalOnly("a ? 'fa-x' : b ? 'fa-y' : 'fa-z'"), 'chained ternary over literals is safe')
  assert.ok(literalOnly("s === 'pending' ? 'fa-spinner fa-spin' : 'fa-coins'"), 'a literal condition is still a condition')
  assert.ok(!literalOnly("item.icon ?? 'fa-cube'"), 'THE SHIPPED BUG: authored value with a literal fallback')
  assert.ok(!literalOnly("cond ? item.icon : 'fa-x'"), 'authored value in one branch')
  assert.ok(!literalOnly('spellIcon(sp)'), 'a call returns whatever it returns')
  assert.ok(!literalOnly('FLAG_ICON[f]'), 'a lookup reads a value')
})

test('every excuse in FA_ONLY still matches something', () => {
  const all = tsxFiles().map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n')
  for (const p of FA_ONLY) {
    assert.ok(all.includes(p.match), `stale exemption, matches nothing: "${p.match}"`)
  }
})
