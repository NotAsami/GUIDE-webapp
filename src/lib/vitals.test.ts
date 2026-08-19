// Run: node --test src/lib/vitals.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, EquippedItem, ShardTree } from './database.types.ts'
import { publicVitals, vitalsEqual } from './vitals.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function character(over: Partial<CharacterRow>): CharacterRow {
  return {
    id: 'c1', owner: 'u1', name: 'Test',
    identity: {}, sheet: {}, resources: {}, inventory: [], equipped: {},
    shards: {}, spellbook: {}, lore: {}, progress: {}, public_vitals: null, updated_at: '',
    ...over,
  } as CharacterRow
}

const BASE = {
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
  hp: { current: 40, max: 52, temp: 4 },
  ac: 15, speed: 30,
}

const ring: EquippedItem = { id: 'i1', name: 'Ring of Protection', slot: 'ring1', effects: { ac: 1 } }
const tree: ShardTree = {
  id: 'sh1', name: 'T', rarity: 'common', module: 'm', icon: 'fa-gem', capacity: 10,
  published: true, baseMods: { maxHp: 5 }, branches: { core: 'Core' },
  nodes: [{ id: 'core', name: 'Core', tier: 0, branch: 'core', angle: 0, cost: 0, icon: 'fa-gem', prereqs: [], effect: '' }],
}

test('THE DERIVED NUMBERS ARE THE POINT — AC and max HP include gear and shards', () => {
  // If these were the raw sheet values there would be no reason for this column
  // to exist: list_party_roster() could project sheet.ac directly.
  const c = character({
    sheet: BASE,
    equipped: { ring1: ring },
    shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core'] } },
  })
  const v = publicVitals(c, { sh1: tree })
  assert.equal(v.ac, 16, '15 authored + 1 from the ring')
  assert.equal(v.hpMax, 57, '52 authored + 5 from the shard')
  assert.equal(v.hp, 40)
  assert.equal(v.temp, 4)
})

test('without the shard catalog it falls back to the authored numbers', () => {
  // Worth pinning: a caller that forgets the trees gets the base, quietly. That
  // is why lib/character.ts takes them from Layout rather than defaulting.
  const c = character({
    sheet: BASE,
    shards: { slot1: { shardId: 'sh1', earned: 5, attuned: ['core'] } },
  })
  assert.equal(publicVitals(c).hpMax, 52, 'no trees, no shard bonus')
})

test('death saves come through as counts', () => {
  const c = character({ sheet: BASE, resources: { deathSaves: { successes: 2, failures: 1 } } })
  const v = publicVitals(c)
  assert.equal(v.deathOk, 2)
  assert.equal(v.deathFail, 1)
})

test('a character with no death saves reads zero, not undefined', () => {
  const v = publicVitals(character({ sheet: BASE }))
  assert.equal(v.deathOk, 0)
  assert.equal(v.deathFail, 0)
})

test('conditions expose their NAME and kind, never their mechanics', () => {
  // The hole should stay the size of the thing going through it: enough to draw
  // a pip and a tooltip, nothing that says what the effect does.
  const c = character({
    sheet: BASE,
    resources: {
      activeEffects: [
        { id: 'e1', name: 'Poisoned', kind: 'cond', icon: 'fa-skull', effects: { abilities: { str: -2 } }, source: 'Giant Spider' },
      ],
    },
  })
  const v = publicVitals(c)
  assert.deepEqual(v.effects, [{ name: 'Poisoned', kind: 'cond', icon: 'fa-skull' }])
  const leaked = JSON.stringify(v)
  assert.ok(!leaked.includes('Giant Spider'), 'no source')
  assert.ok(!leaked.includes('abilities'), 'no mechanics')
})

test('nothing else on the row leaks into the public slice', () => {
  const c = character({
    sheet: { ...BASE, coins: { gold: 999 }, features: [{ id: 'f', name: 'Secret Feature' }] },
    inventory: [{ id: 'i', name: 'Diary of Shame' }] as never,
    lore: { backstory: 'classified' } as never,
    spellbook: { spells: [{ id: 's', name: 'Wish' }] } as never,
  })
  const dumped = JSON.stringify(publicVitals(c))
  for (const secret of ['999', 'Secret Feature', 'Diary of Shame', 'classified', 'Wish']) {
    assert.ok(!dumped.includes(secret), `leaked: ${secret}`)
  }
  assert.deepEqual(Object.keys(publicVitals(c)).sort(),
    ['ac', 'deathFail', 'deathOk', 'effects', 'hp', 'hpMax', 'temp'])
})

test('vitalsEqual skips the write when nothing a watcher sees moved', () => {
  // Most player writes — a journal entry, moving an item between bags — change
  // nothing here, and should not write a column nobody will re-render for.
  const c = character({ sheet: BASE })
  const v = publicVitals(c)
  assert.ok(vitalsEqual(v, publicVitals(c)))
  assert.ok(!vitalsEqual(null, v), 'a row that has never been written must write')
})

test('vitalsEqual notices every field it is meant to', () => {
  const base = publicVitals(character({ sheet: BASE }))
  const moved = [
    { ...base, hp: 1 }, { ...base, hpMax: 1 }, { ...base, temp: 1 }, { ...base, ac: 1 },
    { ...base, deathOk: 1 }, { ...base, deathFail: 1 },
    { ...base, effects: [{ name: 'Bless', kind: 'buff' as const }] },
  ]
  for (const m of moved) assert.ok(!vitalsEqual(base, m), `missed a change: ${JSON.stringify(m)}`)
})

test('a condition changing NAME is a change, even at the same count', () => {
  // Poisoned wearing off and Blessed landing in the same tick is still news.
  const a = { hp: 1, hpMax: 1, temp: 0, ac: 1, deathOk: 0, deathFail: 0, effects: [{ name: 'Poisoned', kind: 'cond' as const }] }
  const b = { ...a, effects: [{ name: 'Blessed', kind: 'buff' as const }] }
  assert.ok(!vitalsEqual(a, b))
})

// -- the write paths ---------------------------------------------------------

/**
 * Guard: every write to `characters` must carry the vitals recompute with it.
 *
 * `public_vitals` is a CACHE, and a cache with more than one producer is a
 * cache that drifts. There are two writers today — the player's own sheet
 * (lib/character.ts) and the DM console (lib/dm.ts) — and both fold the same
 * pure `publicVitals` into the same patch. A third writer added later that
 * forgets it would not fail typecheck, would not throw, and would not look
 * wrong on the screen that wrote it: it would quietly leave another player's
 * HUD showing an AC that is one ring out of date.
 *
 * Scanned rather than unit-tested because the thing being checked IS the
 * coupling: that no update statement exists without the recompute beside it.
 */
test('EVERY writer of a character row recomputes the cache', () => {
  const files = readdirSync(join(ROOT, 'src', 'lib'))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  /** The exact expression handed to `.update(` — balanced to its closing paren,
   *  so `{ ...patch, ...withVitals }` is not confused with the `withVitals`
   *  DEFINITION that happens to sit a few lines above the call. */
  const argAt = (src: string, open: number): string => {
    let depth = 0
    for (let i = open; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(' || ch === '{' || ch === '[') depth++
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return src.slice(open + 1, i)
      }
    }
    return src.slice(open + 1)
  }

  const writers: string[] = []
  for (const f of files) {
    const src = readFileSync(join(ROOT, 'src', 'lib', f), 'utf8')
    const re = /from\(\s*'characters'\s*\)[\s\S]{0,240}?\.update\(/g
    for (let m = re.exec(src); m; m = re.exec(src)) {
      writers.push(f)
      const arg = argAt(src, m.index + m[0].length - 1)

      // Folded straight into the call, or into a patch built just above it.
      let folded = arg.includes('withVitals')
      const ident = folded ? null : arg.trim().match(/^([A-Za-z_$][\w$]*)\s*$/)?.[1]
      if (ident) {
        const decl = src.slice(0, m.index).lastIndexOf(`const ${ident} =`)
        if (decl >= 0) folded = src.slice(decl, m.index).includes('withVitals')
      }

      assert.ok(folded,
        `${f}: .update(${arg.trim().slice(0, 60)}) writes a character row without `
        + `the vitals recompute. Fold \`...withVitals(<the merged row>)\` into the `
        + `patch — see lib/vitals.ts for why the cache cannot have a second producer.`)
    }
  }
  assert.deepEqual(writers, ['character.ts', 'character.ts', 'dm.ts'],
    'the set of character writers changed — a new one must fold in the cache too')
})
