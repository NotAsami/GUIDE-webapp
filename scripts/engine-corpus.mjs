/**
 * The catalog, as test data for the engine port.
 *
 * supabase/catalog_snapshot.sql is every authored row in the project — SRD and
 * homebrew, graphs included — already committed. Reading it back gives the
 * side-by-side tests the real content to run both engines over, with nothing
 * to export and nothing private: the snapshot's own header explains why it is
 * safe to publish.
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

/** table → [{ id, data }] */
export function catalog() {
  const sql = readFileSync(new URL('../supabase/catalog_snapshot.sql', import.meta.url), 'utf8')
  const tables = {}
  const head = /^insert into (\w+) \([^)]*\) values \(/gm
  for (let m; (m = head.exec(sql));) {
    const [id, afterId] = literal(sql, head.lastIndex)
    const [json] = literal(sql, sql.indexOf("'", afterId))
    ;(tables[m[1]] ??= []).push({ id, data: JSON.parse(json) })
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
