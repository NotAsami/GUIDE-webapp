/**
 * SRD 5.2 import — STAGE 2: load the reviewed JSON into Supabase.
 *
 *   node scripts/srd-load.mjs --dry     # plan only: what would insert, update, skip
 *   node scripts/srd-load.mjs           # write
 *
 * ── TWO GUARANTEES, and they are the whole point of this file ───────────────
 *
 * 1. THE GATE RUNS FIRST, on every run. scripts/srd-verify.mjs is the same
 *    check stage 1 uses, and a failure aborts before a single row is written.
 *    The first import had a human reading the output; a re-import after a
 *    schema change does not, and that is exactly when a broken transform would
 *    otherwise reach the database unnoticed.
 *
 * 2. A MODIFIED ROW IS NEVER OVERWRITTEN. Rows carry `modified` once a human
 *    has edited them. Re-import updates the untouched ones, skips the edited
 *    ones, and lists what it skipped by name. Without this, one re-run
 *    destroys every hand-authored effect on every SRD row — silently, because
 *    an upsert reports success either way.
 *
 * ── CREDENTIALS ─────────────────────────────────────────────────────────────
 * The catalog tables are DM-only (`exists (select 1 from dm_users …)`), so the
 * anon key the app ships with cannot write here — by design. This script needs
 * SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
 *
 * That key must live in .env.local (gitignored) and nowhere else. It is not
 * the app's key and must never reach the browser bundle: anything prefixed
 * VITE_ is compiled into the client, which is why this one deliberately is not.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { verify, report } from './srd-verify.mjs'

const DIR = 'srd-data'
const DRY = process.argv.includes('--dry')

/** Which file goes to which table, and how a row identifies itself. */
const TARGETS = [
  { file: 'items.json', table: 'item_catalog', shape: 'data' },
  { file: 'spells.json', table: 'spell_catalog', shape: 'data' },
  { file: 'races.json', table: 'race_catalog', shape: 'draft' },
  { file: 'features.json', table: 'feature_catalog', shape: 'draft' },
  { file: 'backgrounds.json', table: 'background_catalog', shape: 'draft' },
]

function env(name) {
  if (process.env[name]) return process.env[name]
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    const line = readFileSync(f, 'utf8').split('\n').find(l => l.startsWith(name + '='))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

const read = file => {
  const p = join(DIR, file)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}

/**
 * What a load would do, as a pure function — so the rule that protects
 * hand-authored work is testable without a database.
 *
 * THE SKIP is the whole reason this is not a plain upsert. `modified` is set by
 * the app the moment a human edits an imported row; without honouring it, one
 * re-run after a schema change overwrites every hand-authored effect on every
 * SRD row, and reports success while doing it.
 *
 * @param rows      the transformed JSON
 * @param existing  [{ id, data }] already in the table
 */
export function plan(rows, existing) {
  const byId = new Map(existing.map(r => [r.id, r.data ?? {}]))
  const insert = [], update = [], skip = []
  for (const row of rows) {
    const id = row.srd_key ?? row.id
    const prev = byId.get(id)
    if (!prev) { insert.push({ id, row }); continue }
    if (prev.modified) { skip.push(row.name ?? id); continue }
    update.push({ id, row })
  }
  return { insert, update, skip }
}

async function main() {
  // ── the gate, before anything else ──
  const data = {
    items: read('items.json'), spells: read('spells.json'), races: read('races.json'),
    features: read('features.json'), backgrounds: read('backgrounds.json'),
  }
  if (!Object.values(data).some(x => x.length)) {
    console.error(`No JSON in ${DIR}/. Run: node scripts/srd-import.mjs`)
    process.exit(1)
  }
  if (!report(verify(data), 'srd-data')) {
    console.error('\nRefusing to load. Fix the transform and re-run stage 1.')
    process.exit(1)
  }

  const url = env('VITE_SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url) { console.error('VITE_SUPABASE_URL is not set.'); process.exit(1) }
  if (!key) {
    console.error(
      '\nSUPABASE_SERVICE_ROLE_KEY is not set.\n'
      + '\nThe catalog tables are DM-only, so the anon key cannot write to them.\n'
      + 'Add the service_role key to .env.local (NOT prefixed VITE_, or it would\n'
      + 'be compiled into the browser bundle):\n'
      + '\n  SUPABASE_SERVICE_ROLE_KEY=eyJ...\n'
      + '\nProject settings → API → service_role. Treat it like a password.\n')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`\nSRD 5.2 · stage 2 · ${DRY ? 'DRY RUN — nothing will be written' : 'writing'}\n`)

  const summary = []
  for (const { file, table, shape } of TARGETS) {
    const rows = data[file.replace('.json', '')] ?? read(file)
    if (!rows.length) continue

    // What is already there, and which of it a human has touched.
    const { data: existing, error } = await db.from(table).select('id, data')
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }

    const { insert, update, skip } = plan(rows, existing ?? [])

    if (!DRY) {
      const payload = [...insert, ...update].map(({ id, row }) =>
        shape === 'draft'
          ? { id, data: { ...row, published: true }, draft: null }
          : { id, data: row })
      for (let i = 0; i < payload.length; i += 200) {
        const { error: e } = await db.from(table).upsert(payload.slice(i, i + 200), { onConflict: 'id' })
        if (e) { console.error(`${table}: ${e.message}`); process.exit(1) }
      }
    }

    summary.push({ table, insert: insert.length, update: update.length, skip })
  }

  console.log('| table | insert | update | skipped (edited) |')
  console.log('|---|--:|--:|--:|')
  for (const s of summary) console.log(`| ${s.table} | ${s.insert} | ${s.update} | ${s.skip.length} |`)

  const skipped = summary.flatMap(s => s.skip.map(n => `${s.table}: ${n}`))
  console.log('\nSkipped because a human had edited them:')
  console.log(skipped.length ? skipped.map(x => `  - ${x}`).join('\n') : '  (none)')

  if (DRY) console.log('\nDRY RUN — nothing was written. Re-run without --dry to apply.')
}

/* Only when RUN, never when imported. `plan` above is exported so the skip
   rule can be tested without a database, and a module that loads the world
   (and exits the process) as a side effect of being imported cannot be. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e); process.exit(1) })
}
