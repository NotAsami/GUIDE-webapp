/**
 * The catalog, as test data: the rows of supabase/seed.sql (the public seed every
 * install starts from) read back into objects. Also used by catalog-snapshot.mjs
 * to rebuild the seed from a private snapshot without touching the network.
 */
import { readFileSync } from 'node:fs'

/** One SQL string literal starting at `i` (which must be a quote); `''` is an escaped quote. */
function literal(sql, i) {
  let out = ''
  for (i++; i < sql.length; i++) {
    if (sql[i] !== "'") out += sql[i]
    else if (sql[i + 1] === "'") { out += "'"; i++ }
    else return [out, i + 1]
  }
  throw new Error('unterminated SQL string')
}

const SEED = new URL('../supabase/seed.sql', import.meta.url)

/** table → [{ id, data, draft }] from one of our generated SQL files (one row per
 *  `insert … values ('<id>', '<json>'::jsonb[, <draft>])`). */
export function catalog(file = SEED) {
  const sql = readFileSync(file, 'utf8')
  const tables = {}
  const head = /^insert into (\w+) \([^)]*\) values \(/gm
  for (let m; (m = head.exec(sql));) {
    const [id, afterId] = literal(sql, head.lastIndex)
    const [json, afterJson] = literal(sql, sql.indexOf("'", afterId))
    const draft = /^::jsonb, (true|false|null)\)/.exec(sql.slice(afterJson, afterJson + 20))?.[1]
    ;(tables[m[1]] ??= []).push({ id, data: JSON.parse(json), draft: draft === 'true' })
  }
  return tables
}

/** A level-10 character with nothing on it — the blank each catalog row is placed on. */
export function level10(over = {}) {
  return {
    id: 'pc-10', identity: { level: 10 },
    sheet: {
      hp: { current: 84, max: 84 }, proficiencyBonus: 4, speed: 30,
      abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      features: [],
    },
    spellbook: { spellcasting: true, saveDC: 15, attackBonus: 7, spells: [] },
    equipped: {}, inventory: [], shards: {}, resources: {},
    ...over,
  }
}
