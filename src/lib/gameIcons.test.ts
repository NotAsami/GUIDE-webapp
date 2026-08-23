// Run: node --test src/lib/gameIcons.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { GAME_ICONS, GAME_ICON_AUTHORS } from './gameIconsManifest.ts'
import { GI_PREFIX, ICONS, gameIconAuthor, gameIconUrl, iconLabel, iconMatches, isGameIcon } from './icons.ts'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

test('AN UNPREFIXED VALUE IS STILL FONT AWESOME — no data migration', () => {
  // Hundreds of catalog rows store a bare `fa-*`. If the branch got this wrong
  // every one of them would render as an empty mask, which looks like a broken
  // stylesheet rather than a wrong code path.
  assert.equal(isGameIcon('fa-shield-halved'), false)
  assert.equal(isGameIcon(undefined), false)
  assert.equal(isGameIcon(''), false)
  assert.equal(isGameIcon('gi:lorc/aura'), true)
})

test('a game icon resolves to a real file on disk', () => {
  // A typo in the URL builder renders nothing at all — a blank space where an
  // icon should be, indistinguishable from a CSS bug.
  const url = gameIconUrl('gi:lorc/aura')
  assert.equal(url, '/icons/lorc/aura.svg')
  assert.ok(existsSync(join(ROOT, 'public', url)), `no such file: public${url}`)
})

test('EVERY icon the picker can offer exists', () => {
  // The manifest is generated from the folder, so this is really a guard
  // against the two drifting: icons deleted from disk without regenerating, or
  // a manifest checked in from a different tree.
  const missing = GAME_ICONS.filter(n => !existsSync(join(ROOT, 'public', gameIconUrl(GI_PREFIX + n))))
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} manifest entries have no file`)
})

test('the manifest covers the whole library', () => {
  assert.ok(GAME_ICONS.length > 4000, `only ${GAME_ICONS.length} icons`)
  assert.ok(GAME_ICON_AUTHORS.length > 30, `only ${GAME_ICON_AUTHORS.length} authors`)
  assert.equal(new Set(GAME_ICONS).size, GAME_ICONS.length, 'duplicate entries')
})

test('the author is recoverable from the value — the licence needs it', () => {
  // CC BY 3.0 asks for "Icons made by {author}", and the folder is the only
  // record of who made which. Flattening the directories would lose it.
  assert.equal(gameIconAuthor('gi:lorc/aura'), 'lorc')
  assert.equal(gameIconAuthor('gi:caro-asercion/axe-swing'), 'caro-asercion')
  assert.equal(gameIconAuthor('fa-shield-halved'), '', 'Font Awesome has no per-icon author')
})

test('every author in the manifest is a real folder', () => {
  for (const n of GAME_ICONS) {
    assert.ok(GAME_ICON_AUTHORS.includes(gameIconAuthor(GI_PREFIX + n)), `unknown author in ${n}`)
  }
})

test('labels read as words in both sets, so one search box can match both', () => {
  assert.equal(iconLabel('gi:lorc/holy-symbol'), 'holy symbol')
  assert.equal(iconLabel('fa-shield-halved'), 'shield halved')
})

test('EVERY ICON IS FINDABLE BY THE NAME IT HAS ON DISK', () => {
  // The picker used to search the LABEL, where hyphens have become spaces. The
  // file is `bone-knife.svg`, game-icons.net calls it `bone-knife`, and that is
  // what gets typed — so 2,824 of 4,180 glyphs answered "Nothing matches" to
  // their own name and read as absent from a library they were sitting in.
  const lost = GAME_ICONS.filter(n => !iconMatches(GI_PREFIX + n, n.split('/')[1]))
  assert.deepEqual(lost.slice(0, 5), [], `${lost.length} icons cannot be found by their own filename`)
})

test('a Font Awesome class finds its own icon, pasted whole', () => {
  const lost = ICONS.filter(i => !iconMatches(i, i))
  assert.deepEqual(lost.slice(0, 5), [], `${lost.length} FA icons do not match their own class`)
})

test('the two spellings of one name meet in the middle', () => {
  // Both directions: hyphens in the query, spaces in the query.
  assert.ok(iconMatches('gi:lorc/bone-knife', 'bone-knife'))
  assert.ok(iconMatches('gi:lorc/bone-knife', 'bone knife'))
  assert.ok(iconMatches('gi:lorc/bone-knife', 'BONE-KNIFE'), 'case folds too')
  assert.ok(iconMatches('fa-shield-halved', 'fa-shield'), 'a leading fa- is not part of the name')
  assert.ok(!iconMatches('gi:lorc/bone-knife', 'boneknife'), 'a separator is still a separator')
})

test('BOTH KINDS OF ICON RENDER THE SAME TAG', () => {
  // Not cosmetics. Colour reaches an icon through descendant selectors written
  // against the tag — `.frIcFrame i`, `.nbtn i`, `.nInner i` — so a game icon
  // rendered as <span> took the mask fine and ignored every tint rule in the
  // feature editor, the grant widget and both shard trees. It looked like game
  // icons "cannot be coloured"; around twenty rules were simply missing them.
  // Split the tags again and every one of them breaks again, silently.
  const src = readFileSync(join(ROOT, 'src', 'components', 'Icon.tsx'), 'utf8')
  const tags = [...src.matchAll(/^\s*<([a-z][a-z0-9]*)$/gm)].map(m => m[1])
  assert.equal(tags.length, 2, `expected two render branches, found ${tags.length}`)
  assert.deepEqual([...new Set(tags)], ['i'],
    `the two branches render <${tags.join('> and <')}> — CSS cannot tell them apart if they differ`)
})
