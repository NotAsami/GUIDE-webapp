import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCatalogQuery, matchesCatalogQuery } from './catalogSearch.ts'

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
