import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCatalogQuery, matchesCatalogQuery, hasPositiveTerm } from './catalogSearch.ts'

const torch = { name: 'Torch', tags: ['fire_damage', 'light'] }
const sword = { name: 'Longsword', tags: [] }
const bare = { name: 'Rations' }

const hit = (raw: string, entry: { name?: string; tags?: string[] }) =>
  matchesCatalogQuery(entry, parseCatalogQuery(raw))

test('an empty box keeps the whole list', () => {
  assert.equal(parseCatalogQuery('   ').mode, 'all')
  assert.equal(hit('', torch), true)
  assert.equal(hit('   ', sword), true)
})

test('plain text matches the name, case-insensitively and part-way', () => {
  assert.equal(hit('long', sword), true)
  assert.equal(hit('LONGSWORD', sword), true)
  assert.equal(hit('bow', sword), false)
})

test('plain text also matches tags, so a word need not be looked for twice', () => {
  assert.equal(hit('fire', torch), true)
  assert.equal(hit('fire', sword), false)
})

test('tag: narrows to tags only, excluding a name that would otherwise hit', () => {
  // "Torch" is in the name but is not a tag, so tag:torch must miss.
  assert.equal(hit('tag:torch', torch), false)
  assert.equal(hit('tag:fire', torch), true)
})

test('tag: query is normalised the way authored tags are', () => {
  // normalizeTag folds case and turns spaces into underscores.
  assert.equal(hit('tag:FIRE DAMAGE', torch), true)
  assert.equal(hit('tag:  fire_damage  ', torch), true)
})

test('a half-typed "tag:" does not blank the list', () => {
  assert.equal(parseCatalogQuery('tag:').mode, 'all')
  assert.equal(hit('tag:', sword), true)
})

test('an entry with no tags at all is safe to match against', () => {
  assert.equal(hit('rations', bare), true)
  assert.equal(hit('tag:anything', bare), false)
})

/* ---------- multiple terms, and negation ---------- */

const relicBlade = { name: 'Sunblade', tags: ['martial', 'relic'] }
const plainBlade = { name: 'Longsword', tags: ['martial'] }

test('two positive terms AND together', () => {
  assert.equal(hit('tag:martial tag:relic', relicBlade), true)
  assert.equal(hit('tag:martial tag:relic', plainBlade), false)
})

test('THE CASE THIS WAS WIDENED FOR: tag:martial !relic', () => {
  assert.equal(hit('tag:martial !relic', plainBlade), true)
  assert.equal(hit('tag:martial !relic', relicBlade), false)
  // and it must not quietly drop items that were never martial
  assert.equal(hit('tag:martial !relic', torch), false)
})

test('negation works in both forms', () => {
  assert.equal(hit('tag:martial !tag:relic', relicBlade), false)
  assert.equal(hit('tag:martial !tag:relic', plainBlade), true)
})

test('a negative term reads the name too, not only tags', () => {
  assert.equal(hit('!longsword', plainBlade), false)
  assert.equal(hit('!longsword', relicBlade), true)
})

test('negation alone means everything except', () => {
  assert.equal(hit('!relic', plainBlade), true)
  assert.equal(hit('!relic', relicBlade), false)
  // ...which a search box allows and a pool should not silently accept
  assert.equal(hasPositiveTerm(parseCatalogQuery('!relic')), false)
  assert.equal(hasPositiveTerm(parseCatalogQuery('tag:martial !relic')), true)
  assert.equal(hasPositiveTerm(parseCatalogQuery('')), false)
})

test('a half-typed term filters nothing rather than blanking the list', () => {
  // Each of these is a keystroke on the way to something real.
  assert.equal(parseCatalogQuery('!').mode, 'all')
  assert.equal(parseCatalogQuery('tag:').mode, 'all')
  assert.equal(parseCatalogQuery('!tag:').mode, 'all')
  assert.equal(hit('tag:martial !', plainBlade), true)
})

test('splitting on spaces did not break a tag typed with one', () => {
  // The old grammar read everything after `tag:` as one value. This now parses
  // as `tag:fire` AND `damage`, and still matches — a plain term reads tags.
  assert.equal(hit('tag:FIRE DAMAGE', torch), true)
  assert.equal(hit('tag:FIRE DAMAGE', sword), false)
  assert.equal(hit('tag:  fire_damage  ', torch), true)
})

test('an entry with no tags survives a negative term', () => {
  // `bare` has no tags array at all — the guard is that this reads as "does not
  // match relic", not as a crash or a silent exclusion.
  assert.equal(hit('!relic', bare), true)
  assert.equal(hit('rations !relic', bare), true)
})
