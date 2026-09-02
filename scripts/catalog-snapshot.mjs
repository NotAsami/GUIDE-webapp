/**
 * Dump the RULES catalogs to one idempotent SQL file.
 *
 * Deliberately NOT every catalog table: `shard_tree_secrets` exists to hide
 * concealed node mechanics from players, and this repo is public. Shard trees,
 * shops and loot are left out with it — campaign state rather than rules.
 *
 * `updated_at` is not written: it is the server's, and a restore should stamp
 * the moment of restore rather than resurrect a stale timestamp. `draft` IS
 * written where the table has one, because an unpublished draft is authoring in
 * progress and losing it is the thing a backup exists to prevent.
 */
import { writeFileSync, appendFileSync } from 'node:fs'

const OUT = 'C:/Users/samot/PycharmProjects/GUIDE-webapp/supabase/catalog_snapshot.sql'
const env = Object.fromEntries(
  (await import('node:fs')).readFileSync('C:/Users/samot/PycharmProjects/GUIDE-webapp/.env.local', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))

/** table -> the columns worth restoring, first one being the key. */
const TABLES = [
  ['item_catalog', ['id', 'data']],
  ['spell_catalog', ['id', 'data']],
  ['effect_catalog', ['id', 'data']],
  ['feature_catalog', ['id', 'data', 'draft']],
  ['class_catalog', ['id', 'data', 'draft']],
  ['race_catalog', ['id', 'data', 'draft']],
  ['background_catalog', ['id', 'data', 'draft']],
]

/** Page through PostgREST — the default cap is 1000 and item_catalog is past it. */
async function fetchAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 500) {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${cols.join(',')}&order=id.asc`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Range: `${from}-${from + 499}`,
      },
    })
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`)
    const page = await r.json()
    out.push(...page)
    if (page.length < 500) return out
  }
}

/** Postgres literal. Dollar-quoting would need a tag nothing in the value uses;
 *  doubling the single quotes is simpler and cannot collide. */
const lit = v => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const jsonLit = v => v === null || v === undefined ? 'null' : `${lit(JSON.stringify(v))}::jsonb`

const stamp = new Date().toISOString().slice(0, 10)
writeFileSync(OUT, `-- G.U.I.D.E. Codex — rules catalog snapshot, ${stamp}
--
-- Paste into the Supabase SQL editor and Run, or psql -f. Idempotent: every row
-- is an upsert keyed on id, so running it twice changes nothing and running it
-- against a newer database only overwrites the rows it names.
--
-- WHAT IS NOT HERE, and why: shard_tree_secrets, shard_tree_catalog,
-- shop_catalog and loot_catalog. The first exists to keep concealed node
-- mechanics from players and this repository is public; the rest are campaign
-- state rather than rules. Back those up somewhere private.
--
-- \`updated_at\` is omitted so a restore stamps itself. \`draft\` is included:
-- an unpublished draft is work in progress, which is exactly what a backup is
-- for.

begin;
`)

let total = 0
for (const [table, cols] of TABLES) {
  const rows = await fetchAll(table, cols)
  total += rows.length
  appendFileSync(OUT, `\n-- ${table} — ${rows.length} rows\n`)
  const setList = cols.slice(1).map(c => `${c} = excluded.${c}`).join(', ')
  for (const row of rows) {
    const vals = cols.map(c => (c === 'id' ? lit(row[c]) : jsonLit(row[c]))).join(', ')
    appendFileSync(OUT,
      `insert into ${table} (${cols.join(', ')}) values (${vals})\n` +
      `  on conflict (id) do update set ${setList};\n`)
  }
  console.log(`${table.padEnd(20)} ${String(rows.length).padStart(4)} rows`)
}

appendFileSync(OUT, '\ncommit;\n')
console.log(`\n${total} rows -> supabase/catalog_snapshot.sql`)
