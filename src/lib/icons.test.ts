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
