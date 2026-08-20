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
  { file: 'classes.json', table: 'class_catalog', shape: 'draft' },
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
/** Feature refs on `row` that point at nothing, or null if they all resolve.
 *
 *  A REPAIR, not an overwrite, which is why it is allowed to touch a row marked
 *  `modified`. Deleting a feature leaves every class that granted it holding a
 *  pointer to nothing, and the editor renders that as "undefined was referenced
 *  but no longer exists". Nothing a human authored is lost by dropping a
 *  pointer to something that is already gone.
 *
 *  THE PREDICATE IS "DOES THE TARGET EXIST", and getting that wrong is not
 *  hypothetical: a one-off version of this asked "is the target in the SRD
 *  import" instead, and stripped a homebrew class's only feature because the
 *  feature was homebrew too. `liveIds` must therefore be every id in
 *  feature_catalog, not the ids this importer produced.
 */
export function deadRefs(row, liveIds) {
  const refs = row?.features ?? []
  const kept = refs.filter(r => r?.feature_id && liveIds.has(r.feature_id))
  return kept.length === refs.length ? null : kept
}

export function plan(rows, existing, protectedIds = new Set()) {
  const byId = new Map(existing.map(r => [r.id, r.data ?? {}]))
  const insert = [], update = [], skip = []
  const incoming = new Set()
  for (const row of rows) {
    const id = row.srd_key ?? row.id
    incoming.add(id)
    const prev = byId.get(id)
    if (!prev) { insert.push({ id, row }); continue }
    if (prev.modified) { skip.push(row.name ?? id); continue }
    update.push({ id, row })
  }

  /* ROWS THE IMPORT NO LONGER PRODUCES.
   *
   * An upsert alone leaves them behind forever. That is not hypothetical: the
   * first class import shipped 98 rows built from the class progression TABLE
   * — "Proficiency Bonus", "Cantrips", "Sorcery Points", each carrying the
   * literal text "[Column data]" — and fixing the transform did nothing about
   * the copies already in the database.
   *
   * Scoped hard, because deleting rows is the one thing here that destroys
   * work: only rows this importer created (`source: 'srd'`), only those absent
   * from the incoming set, and never one a human has touched — a modified row
   * is reported as orphaned and left exactly where it is.
   */
  const orphan = [], orphanKept = []
  for (const r of existing) {
    const d = r.data ?? {}
    if (d.source !== 'srd' || incoming.has(r.id)) continue
    if (d.modified) { orphanKept.push(d.name ?? r.id); continue }
    /* STILL REFERENCED. The two protections collide here: `modified` stops an
       edited class being overwritten, and that edited class keeps pointing at
       features this cleanup wants to remove. Deleting them would leave it with
       dangling refs — the same "undefined was referenced but no longer exists"
       the race import produced. Nothing gets deleted while something points at
       it, whoever owns the pointer. */
    if (protectedIds.has(r.id)) { orphanKept.push(`${d.name ?? r.id} (still referenced)`); continue }
    orphan.push({ id: r.id, name: d.name ?? r.id })
  }

  return { insert, update, skip, orphan, orphanKept }
}

async function main() {
  // ── the gate, before anything else ──
  const data = {
    items: read('items.json'), spells: read('spells.json'), races: read('races.json'),
    features: read('features.json'), backgrounds: read('backgrounds.json'),
    classes: read('classes.json'),
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

  /* RETIRE FIRST, THEN COUNT REFERENCES — or the two protections deadlock.
     Orphan cleanup holds a feature because a row still points at it; the
     repair only drops pointers to features that are already gone. A feature
     referenced by an edited class therefore survives every future run, which
     is how six of the seven Spellcasting rows deleted cleanly and the Wizard's
     stayed forever.
     The retiring set is SRD rows this import no longer produces, and the
     pointers dropped are only those on OTHER SRD rows. A homebrew class that
     deliberately grants an SRD feature keeps its pointer, and the feature is
     held and reported instead — a DM's grant is a reason to keep something,
     not a technicality to route around. */
  const incomingFeatureIds = new Set((data.features ?? []).map(f => f.srd_key ?? f.id))
  {
    const { data: feats } = await db.from('feature_catalog').select('id, data')
    const retiring = new Set((feats ?? [])
      .filter(f => (f.data ?? {}).source === 'srd' && !incomingFeatureIds.has(f.id))
      .map(f => f.id))
    if (retiring.size && !DRY) {
      for (const t of ['class_catalog', 'race_catalog', 'background_catalog']) {
        const { data: rows } = await db.from(t).select('id, data')
        for (const r of rows ?? []) {
          if ((r.data ?? {}).source !== 'srd') continue
          const refs = r.data.features ?? []
          const kept = refs.filter(x => !retiring.has(x?.feature_id))
          if (kept.length === refs.length) continue
          const { error: e } = await db.from(t).update({ data: { ...r.data, features: kept } }).eq('id', r.id)
          if (e) { console.error(`${t}: ${e.message}`); process.exit(1) }
          console.log(`  ${r.data.name}: released ${refs.length - kept.length} ref(s) to retired features`)
        }
      }
    }
  }

  /* Every feature id anything will still point at once this run finishes:
     from the incoming classes/races/backgrounds, AND from whatever is already
     in those tables — because a row skipped as `modified` keeps its refs. */
  const referenced = new Set()
  const collect = rows => {
    for (const r of rows ?? []) for (const ref of r.features ?? []) {
      if (ref?.feature_id) referenced.add(ref.feature_id)
    }
  }
  collect(data.classes); collect(data.races); collect(data.backgrounds)
  /* Existing rows count ONLY where this run will not rewrite them — a row about
     to receive a clean feature list must not vote with its old one, or nothing
     is ever removable. So: rows the import no longer produces, and rows skipped
     because a human edited them. */
  const incomingIds = new Set([...(data.classes ?? []), ...(data.races ?? []), ...(data.backgrounds ?? [])]
    .map(r => r.srd_key ?? r.id))
  for (const t of ['class_catalog', 'race_catalog', 'background_catalog']) {
    const { data: rows } = await db.from(t).select('id, data')
    collect((rows ?? [])
      .filter(r => !incomingIds.has(r.id) || (r.data ?? {}).modified)
      .map(r => r.data ?? {}))
  }

  const summary = []
  for (const { file, table, shape } of TARGETS) {
    const rows = data[file.replace('.json', '')] ?? read(file)
    if (!rows.length) continue

    // What is already there, and which of it a human has touched.
    const { data: existing, error } = await db.from(table).select('id, data')
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }

    const { insert, update, skip, orphan, orphanKept } =
      plan(rows, existing ?? [], table === 'feature_catalog' ? referenced : new Set())

    if (!DRY) {
      const payload = [...insert, ...update].map(({ id, row }) =>
        shape === 'draft'
          ? { id, data: { ...row, published: true }, draft: null }
          : { id, data: row })
      for (let i = 0; i < payload.length; i += 200) {
        const { error: e } = await db.from(table).upsert(payload.slice(i, i + 200), { onConflict: 'id' })
        if (e) { console.error(`${table}: ${e.message}`); process.exit(1) }
      }
      if (orphan.length) {
        const { error: e } = await db.from(table).delete().in('id', orphan.map(o => o.id))
        if (e) { console.error(`${table}: ${e.message}`); process.exit(1) }
      }
    }

    summary.push({ table, insert: insert.length, update: update.length, skip, orphan, orphanKept })
  }

  /* REPAIR PASS, after the deletes. Any row still pointing at a feature this
     run removed would render as a dangling reference — including the rows the
     skip rule protected, which is precisely where dead refs collect, because
     those are the rows the import is not allowed to rewrite. */
  const repaired = []
  if (!DRY) {
    const { data: feats } = await db.from('feature_catalog').select('id')
    const live = new Set((feats ?? []).map(f => f.id))
    for (const t of ['class_catalog', 'race_catalog', 'background_catalog']) {
      const { data: rows } = await db.from(t).select('id, data')
      for (const r of rows ?? []) {
        const kept = deadRefs(r.data ?? {}, live)
        if (!kept) continue
        const n = (r.data.features ?? []).length - kept.length
        const { error: e } = await db.from(t).update({ data: { ...r.data, features: kept } }).eq('id', r.id)
        if (e) { console.error(`${t}: ${e.message}`); process.exit(1) }
        repaired.push(`${t}: ${r.data.name ?? r.id} — ${n} dead ref${n === 1 ? '' : 's'} dropped`)
      }
    }
  }

  console.log('| table | insert | update | removed | skipped (edited) |')
  console.log('|---|--:|--:|--:|--:|')
  for (const s of summary) {
    console.log(`| ${s.table} | ${s.insert} | ${s.update} | ${s.orphan.length} | ${s.skip.length} |`)
  }

  const gone = summary.flatMap(s => s.orphan.map(o => `${s.table}: ${o.name}`))
  if (gone.length) {
    console.log(`\nRemoved — this import no longer produces them (${gone.length}):`)
    console.log(gone.slice(0, 12).map(x => `  - ${x}`).join('\n'))
    if (gone.length > 12) console.log(`  …and ${gone.length - 12} more`)
  }
  const keptOrphans = summary.flatMap(s => s.orphanKept.map(n => `${s.table}: ${n}`))
  if (keptOrphans.length) {
    console.log('\nOrphaned but EDITED, so left alone:')
    console.log(keptOrphans.map(x => `  - ${x}`).join('\n'))
  }

  if (repaired.length) {
    console.log('\nRepaired — these pointed at features that no longer exist:')
    console.log(repaired.map(x => `  - ${x}`).join('\n'))
  }

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
