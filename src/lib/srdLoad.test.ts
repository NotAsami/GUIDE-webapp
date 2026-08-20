// Run: node --test src/lib/srdLoad.test.ts
//
// The re-import skip rule. This is one of the two things standing between a
// re-run and quietly destroyed work (the other is the dataset gate), and it is
// the one that cannot be seen failing: an upsert reports success whether or not
// it just overwrote a DM's hand-authored effects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan } from '../../scripts/srd-load.mjs'
import { markEdited } from './autopublish.ts'

const row = (srd_key: string, name: string) => ({ srd_key, name })

test('a row that is not there yet is inserted', () => {
  const p = plan([row('srd-2024_longsword', 'Longsword')], [])
  assert.equal(p.insert.length, 1)
  assert.equal(p.update.length, 0)
  assert.equal(p.skip.length, 0)
})

test('an untouched SRD row is updated', () => {
  const p = plan(
    [row('srd-2024_longsword', 'Longsword')],
    [{ id: 'srd-2024_longsword', data: { source: 'srd' } }],
  )
  assert.equal(p.update.length, 1, 'a re-import refreshes rows nobody has edited')
  assert.equal(p.skip.length, 0)
})

test('A ROW A HUMAN EDITED IS NEVER OVERWRITTEN', () => {
  // The whole point. Without this, a schema-change re-run silently destroys
  // every effect authored onto an SRD item.
  const p = plan(
    [row('srd-2024_longsword', 'Longsword')],
    [{ id: 'srd-2024_longsword', data: { source: 'srd', modified: true } }],
  )
  assert.equal(p.update.length, 0, 'it must NOT be in the update set')
  assert.equal(p.insert.length, 0, 'nor quietly re-inserted')
  assert.deepEqual(p.skip, ['Longsword'], 'and it is reported BY NAME, not just counted')
})

test('one edited row does not stop the rest of the import', () => {
  const p = plan(
    [row('a', 'Axe'), row('b', 'Bow'), row('c', 'Club')],
    [
      { id: 'a', data: { modified: true } },
      { id: 'b', data: {} },
    ],
  )
  assert.deepEqual(p.skip, ['Axe'])
  assert.equal(p.update.length, 1)   // Bow
  assert.equal(p.insert.length, 1)   // Club
})

test('rows identify by srd_key, falling back to id', () => {
  // Features carry `id`; items carry `srd_key`. Both must find their existing row.
  const p = plan(
    [{ id: 'srd-2024_alert', name: 'Alert' }],
    [{ id: 'srd-2024_alert', data: { modified: true } }],
  )
  assert.deepEqual(p.skip, ['Alert'])
})

/* ------------------------------------------------------------------
   The other half of the rule: something must SET `modified`.

   For a while nothing did. The importer wrote `source`, the loader read
   `modified`, and the write path between them never joined the two — so the
   skip was inert, and a re-import would have reported "941 updated, 0 skipped"
   while erasing every effect hand-authored onto an SRD item. A guard that
   looks like protection and isn't is worse than no guard.
   ------------------------------------------------------------------ */

test('editing an SRD row marks it, so the loader will skip it next time', () => {
  const imported = { name: 'Longsword', source: 'srd', srd_key: 'srd-2024_longsword' }
  const edited = markEdited(imported)
  assert.equal((edited as { modified?: boolean }).modified, true)

  // and the loader honours it end to end
  const p = plan([imported], [{ id: 'srd-2024_longsword', data: edited }])
  assert.deepEqual(p.skip, ['Longsword'])
  assert.equal(p.update.length, 0)
})

test('a hand-authored row is left alone — it has no source and is never re-imported', () => {
  const mine = { name: 'Sanctity' }
  assert.equal(markEdited(mine), mine, 'same object, no needless copy')
  assert.equal((markEdited(mine) as { modified?: boolean }).modified, undefined)
})

test('marking is idempotent', () => {
  const once = markEdited({ name: 'X', source: 'srd' })
  assert.equal(markEdited(once), once, 'already marked: returns the same object')
})

/* ------------------------------------------------------------------
   Guard: every catalog write path stamps.

   The unit tests above prove markEdited works; they cannot prove it is
   CALLED. Deleting the call from a hook leaves every test passing and the
   protection silently inert again — which is precisely the state this whole
   mechanism was built to escape. Scanned, because no pure function can see
   whether a save path invokes a helper.
   ------------------------------------------------------------------ */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Every place a catalog row reaches the database, and the call that must
 *  guard it. Adding a seventh editor means adding it here. */
const WRITE_PATHS: { file: string; fn: string }[] = [
  { file: 'src/lib/autopublish.ts', fn: 'useAutoPublish — loot, class, race, background' },
  { file: 'src/lib/autopublish.ts', fn: 'useAutoSave — items, spells, effects, shops' },
  { file: 'src/screens/FeatureEditor.tsx', fn: 'FeatureEditor — manual publish' },
]

test('EVERY CATALOG WRITE PATH STAMPS AN EDITED SRD ROW', () => {
  const missing: string[] = []
  for (const { file, fn } of WRITE_PATHS) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    if (!src.includes('markEdited(')) missing.push(`${file} (${fn})`)
  }
  assert.deepEqual(missing, [],
    'These write catalog rows without marking an edited SRD row, so a re-import '
    + 'would overwrite hand-authored work:\n  ' + missing.join('\n  '))
})

test('autopublish stamps on BOTH its draft and publish paths', () => {
  // It picks one of two writers by error count; a stamp on only one branch
  // means an errored save silently un-protects the row.
  const src = readFileSync(join(ROOT, 'src/lib/autopublish.ts'), 'utf8')
  const calls = [...src.matchAll(/markEdited\(/g)].length
  assert.ok(calls >= 2, `expected a stamp in both hooks, found ${calls}`)
})
