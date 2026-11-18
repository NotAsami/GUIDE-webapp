/**
 * Dump every authoring catalog, and build the public seed from it.
 *
 *   node scripts/catalog-snapshot.mjs            read the live project, write both files
 *   node scripts/catalog-snapshot.mjs --offline  rebuild the seed from the existing snapshot
 *
 * TWO FILES, because one of them is public and one is not:
 *
 *   supabase/catalog_snapshot.sql  EVERYTHING — homebrew, shard trees and their
 *                                  secrets, drafts. Your backup. Gitignored: once
 *                                  a campaign runs, its catalog is spoilers.
 *   supabase/seed.sql              What a NEW install starts with: the SRD rows
 *                                  (with the effects authored on them), a few
 *                                  generic conditions, and one example shop and
 *                                  loot table. Committed, and what `supabase db
 *                                  reset` runs.
 *
 * The seed refuses to write if a kept row names an id that was left out — a
 * class feature pointing at a homebrew item would install broken.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env.local (the catalogs are DM-only by
 * RLS). That key bypasses every policy: it lives in .env.local and nowhere else.
 *
 * NOT dumped: `loot_open` and a shop's open state — session state, not authored
 * content. `updated_at` is left for the server to stamp on restore. `draft` IS
 * kept in the snapshot (unpublished work is what a backup is for) and drafts
 * are kept OUT of the seed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { catalog } from './engine-corpus.mjs'

const SNAPSHOT = new URL('../supabase/catalog_snapshot.sql', import.meta.url)
const SEED = new URL('../supabase/seed.sql', import.meta.url)

/** table -> the columns worth restoring, first one being the conflict key.
 *  `shard_tree_secrets` keys on `shard_id`, not `id` — the one table that does. */
const TABLES = [
  ['item_catalog', ['id', 'data']],
  ['spell_catalog', ['id', 'data']],
  ['effect_catalog', ['id', 'data']],
  ['feature_catalog', ['id', 'data', 'draft']],
  ['class_catalog', ['id', 'data', 'draft']],
  ['race_catalog', ['id', 'data', 'draft']],
  ['background_catalog', ['id', 'data', 'draft']],
  ['shard_tree_catalog', ['id', 'data']],
  ['shard_tree_secrets', ['shard_id', 'data']],
  ['loot_catalog', ['id', 'data', 'draft']],
  ['shop_catalog', ['id', 'data']],
]

/* ---------- what a new install gets ---------- */

/** Tables whose SRD rows ship. Everything not `srd-…` in them is homebrew. */
const SRD_TABLES = ['item_catalog', 'spell_catalog', 'feature_catalog', 'class_catalog', 'race_catalog', 'background_catalog']

/** Effects every table uses. Named, because the effect catalog has no SRD ids. */
const EFFECTS = ['fx-bless', 'fx-charmed', 'fx-frightened', 'fx-giant-strength', 'fx-haste', 'fx-poisoned', 'fx-silvered']

/** One shop and one loot table, so those screens are not empty on day one.
 *  Written here rather than dumped: the project's own are campaign content. */
const SHOP = {
  id: 'example-provisioner', name: 'The Provisioner', icon: 'fa-store',
  desc: 'An example shop. Edit its stock and prices in the Operator Console, or delete it.',
  stock: [['srd-2024_rations', 'unlimited'], ['srd-2024_torch', 'unlimited'], ['srd-2024_rope', 'unlimited'],
    ['srd-2024_backpack', 'unlimited'], ['srd-2024_bedroll', 'unlimited'], ['srd-2024_tinderbox', 'unlimited'],
    ['srd-2024_healers-kit', 'limited', 2], ['srd-2024_potion-of-healing', 'limited', 3]],
}
const LOOT = {
  id: 'example-cache', name: 'Abandoned Cache', icon: 'fa-box-open', kind: 'Chest', published: true,
  desc: 'An example loot table. Roll it from the Operator Console to grant what comes up.',
  rows: [
    { kind: 'item', item_id: 'srd-2024_dagger', min: 1, max: 1, chance: 40 },
    { kind: 'item', item_id: 'srd-2024_potion-of-healing', min: 1, max: 2, chance: 50 },
    { kind: 'item', item_id: 'srd-2024_rations', min: 1, max: 5, chance: 70 },
    { kind: 'coin', coin: 'gold', min: 2, max: 20, chance: 80 },
  ],
}

function seedRows(all) {
  const kept = {}
  for (const t of SRD_TABLES) kept[t] = (all[t] ?? []).filter(r => r.id.startsWith('srd-') && !r.draft)
  kept.effect_catalog = (all.effect_catalog ?? []).filter(r => EFFECTS.includes(r.id) && !r.draft)

  const items = new Map(kept.item_catalog.map(r => [r.id, r.data]))
  const item = id => items.get(id) ?? fail(`the example shop/loot names ${id}, which is not in the seed`)
  const { id: shopId, stock, ...shop } = SHOP
  kept.shop_catalog = [{ id: shopId, data: { ...shop, stock: stock.map(([id, mode, qty = 1]) =>
    ({ item_id: id, item: item(id), price: item(id).value ?? 0, unit: item(id).valueUnit ?? 'gp', mode, qty })) } }]
  const { id: lootId, ...loot } = LOOT
  for (const r of loot.rows) if (r.kind === 'item') item(r.item_id)
  kept.loot_catalog = [{ id: lootId, data: loot, draft: false }]

  /* NO DANGLING NAMES. Any id the project has that the seed lacks must not be
     mentioned by what the seed keeps. Matching the quoted string catches it
     wherever it hides — a grant, a starting kit, a loot row. */
  const keptIds = new Set(Object.values(kept).flat().map(r => r.id))
  const dropped = new Set(Object.values(all).flat().map(r => r.id).filter(id => !keptIds.has(id)))
  const problems = []
  for (const [t, rows] of Object.entries(kept)) {
    for (const r of rows) {
      for (const [, s] of JSON.stringify(r.data).matchAll(/"([^"\\]*)"/g)) {
        if (dropped.has(s)) problems.push(`${t} ${r.id} names ${s}, which the seed leaves out`)
      }
    }
  }
  if (problems.length) fail(`seed not written:\n  ${problems.join('\n  ')}`)
  return kept
}

function fail(msg) { console.error(msg); process.exit(1) }

/* ---------- SQL ---------- */

/** Postgres literal. Doubling the single quotes cannot collide with anything in the value. */
const lit = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const jsonLit = v => v === null || v === undefined ? 'null' : `${lit(JSON.stringify(v))}::jsonb`

function sql(header, tables) {
  let out = `${header}\nbegin;\n`
  let total = 0
  for (const [table, cols] of TABLES) {
    const rows = tables[table]
    if (!rows?.length) continue
    total += rows.length
    out += `\n-- ${table} — ${rows.length} rows\n`
    const setList = cols.slice(1).map(c => `${c} = excluded.${c}`).join(', ')
    for (const row of rows) {
      /* THE KEY IS POSITION 0, NOT THE NAME `id` — shard_tree_secrets keys on
         `shard_id`, and testing the name wrote its key as a jsonb literal. */
      const vals = [lit(row.id), jsonLit(row.data), ...(cols[2] ? [row.draft ? 'true' : 'null'] : [])].join(', ')
      out += `insert into ${table} (${cols.join(', ')}) values (${vals})\n  on conflict (${cols[0]}) do update set ${setList};\n`
    }
  }
  return [`${out}\ncommit;\n`, total]
}

/* ---------- read ---------- */

async function live() {
  const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? fail('SUPABASE_SERVICE_ROLE_KEY is not in .env.local')
  const all = {}
  for (const [table, cols] of TABLES) {
    const rows = []
    // Paged: PostgREST caps a response at 1000 rows and item_catalog is past it.
    for (let from = 0; ; from += 500) {
      const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${cols.join(',')}&order=${cols[0]}.asc`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 499}` },
      })
      if (!r.ok) fail(`${table}: ${r.status} ${await r.text()}`)
      const page = await r.json()
      rows.push(...page.map(p => ({ id: p[cols[0]], data: p.data, draft: p.draft === true })))
      if (page.length < 500) break
    }
    all[table] = rows
  }
  return all
}

const offline = process.argv.includes('--offline')
const all = offline ? catalog(SNAPSHOT) : await live()
const stamp = new Date().toISOString().slice(0, 10)

if (!offline) {
  const [text, n] = sql(`-- G.U.I.D.E. Codex — FULL catalog snapshot, ${stamp}. PRIVATE: gitignored.
--
-- Every authoring catalog, homebrew, drafts and shard secrets included. A backup
-- of this project, not something to publish. Restore with the Supabase SQL editor
-- or psql -f; every row is an upsert keyed on id, so re-running changes nothing.
-- Written by scripts/catalog-snapshot.mjs, which also derives supabase/seed.sql.
`, all)
  writeFileSync(SNAPSHOT, text)
  console.log(`${n} rows -> supabase/catalog_snapshot.sql (private)`)
}

const [text, n] = sql(`-- G.U.I.D.E. Codex — the starting catalog for a new install, ${stamp}.
--
-- The SRD 5.2 content (CC-BY-4.0, see docs/CREDITS.md) with the effects authored
-- on it, a few generic conditions, and one example shop and loot table. No
-- characters and no campaign. Run it after the migrations: \`supabase db reset\`
-- does that locally, or paste it into the Supabase SQL editor. Idempotent: every
-- row is an upsert keyed on id.
--
-- GENERATED by scripts/catalog-snapshot.mjs. Do not edit by hand.
`, seedRows(all))
writeFileSync(SEED, text)
console.log(`${n} rows -> supabase/seed.sql (public)`)
