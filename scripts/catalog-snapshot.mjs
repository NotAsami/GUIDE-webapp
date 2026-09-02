/**
 * Dump every authoring catalog to one idempotent SQL file.
 *
 * `shard_tree_secrets` IS included. That table exists to keep concealed node
 * mechanics from players, and this repository is public — but this Supabase
 * project has never held a real campaign, so its "secrets" are developer
 * fixtures with nothing to spoil. If a campaign is ever run on a project, its
 * secrets do not belong in a public snapshot; split them out again then.
 *
 * NOT included: `loot_open` (loot mid-roll at the table) and shop open-state,
 * which are session state rather than authored content — a restore should not
 * reopen a shop somebody closed.
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

/** Page through PostgREST — the default cap is 1000 and item_catalog is past it. */
async function fetchAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 500) {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${cols.join(',')}&order=${cols[0]}.asc`, {
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
-- Every authoring catalog, shard_tree_secrets included. That table exists to
-- keep concealed node mechanics from players and this repository is public,
-- but this Supabase project has never held a real campaign — the secrets are
-- developer fixtures. Run a campaign on a project and its secrets stop
-- belonging in a public snapshot.
--
-- NOT here: loot_open, and the open/closed state of a shop. Session state, not
-- authored content — a restore should not reopen a shop somebody closed.
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
    /* THE KEY IS POSITION 0, NOT THE NAME `id` — shard_tree_secrets keys on
       `shard_id`, and testing the name wrote its key as a jsonb literal
       (`'"cinder"'::jsonb`), which restores as a quoted string and matches
       nothing. Caught by diffing the file back against the database. */
    const vals = cols.map((c, k) => (k === 0 ? lit(row[c]) : jsonLit(row[c]))).join(', ')
    appendFileSync(OUT,
      `insert into ${table} (${cols.join(', ')}) values (${vals})\n` +
      `  on conflict (${cols[0]}) do update set ${setList};\n`)
  }
  console.log(`${table.padEnd(20)} ${String(rows.length).padStart(4)} rows`)
}

appendFileSync(OUT, '\ncommit;\n')
console.log(`\n${total} rows -> supabase/catalog_snapshot.sql`)
