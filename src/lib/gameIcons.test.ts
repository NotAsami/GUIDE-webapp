// Run: node --test src/lib/gameIcons.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { GAME_ICONS, GAME_ICON_AUTHORS } from './gameIconsManifest.ts'
import { GI_PREFIX, gameIconAuthor, gameIconUrl, iconLabel, isGameIcon } from './icons.ts'

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
