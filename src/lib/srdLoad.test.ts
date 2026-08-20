// Run: node --test src/lib/srdLoad.test.ts
//
// The re-import skip rule. This is one of the two things standing between a
// re-run and quietly destroyed work (the other is the dataset gate), and it is
// the one that cannot be seen failing: an upsert reports success whether or not
// it just overwrote a DM's hand-authored effects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plan, deadRefs } from '../../scripts/srd-load.mjs'
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

/* ------------------------------------------------------------------
   Guard: no catalog form calls a hook after its early return.

   Replacing onSaveDraft/onPublish with useAutoPublish put a HOOK where two
   plain functions used to sit. In four forms that position was BELOW the
   `if (!draft) return`, so the render after a delete — the one where draft
   becomes null — called fewer hooks than the render before it, and React tore
   the tree down: "Rendered fewer hooks than expected."

   Invisible to TypeScript and to every unit test. It shows up only at runtime,
   on the one render nobody thinks to re-test after a refactor.
   ------------------------------------------------------------------ */

test('NO CATALOG FORM CALLS A HOOK AFTER ITS EARLY RETURN', () => {
  const src = readFileSync(join(ROOT, 'src/screens/OperatorConsole.tsx'), 'utf8').split('\n')
  const FN = /^function [A-Z]/
  const HOOK = /useAutoPublish<|useAutoSave\(\{/
  const GUARD = /^\s*if \(!draft\) \{/

  const bad: string[] = []
  src.forEach((line, i) => {
    if (!HOOK.test(line)) return
    let st = i
    while (st > 0 && !FN.test(src[st])) st--
    const name = src[st].slice(9).split('(')[0]
    for (let j = st; j < i; j++) {
      if (GUARD.test(src[j])) { bad.push(name + ': early return at ' + (j + 1) + ', hook at ' + (i + 1)); break }
    }
  })

  assert.deepEqual(bad, [],
    'A hook below an early return means React counts different numbers of hooks '
    + 'on the render where draft is null — which is the render a delete causes:\n  '
    + bad.join('\n  '))
})

/* ---------- rows the import stops producing ---------- */

test('a row the import no longer produces is removed', () => {
  const p = plan([], [{ id: 'srd-2024_cantrips', data: { source: 'srd', name: 'Cantrips' } }])
  assert.deepEqual(p.orphan.map(o => o.name), ['Cantrips'])
})

test('AN ORPHAN A HUMAN EDITED IS KEPT, not deleted', () => {
  // Deleting is the one operation here that destroys work, so the `modified`
  // flag has to protect against it exactly as it protects against overwrite.
  const p = plan([], [{ id: 'srd-2024_rage', data: { source: 'srd', name: 'Rage', modified: true } }])
  assert.equal(p.orphan.length, 0, 'must NOT be deleted')
  assert.deepEqual(p.orphanKept, ['Rage'], 'and it is reported so it is not silently kept forever')
})

test('hand-authored rows are never touched by orphan cleanup', () => {
  // No `source: 'srd'`, so this importer did not create it and has no business
  // removing it — however absent it is from the incoming set.
  const p = plan([], [{ id: 'sanctity', data: { name: 'Sanctity' } }])
  assert.equal(p.orphan.length, 0)
  assert.equal(p.orphanKept.length, 0)
})

test('a row something still points at is never deleted', () => {
  // The two protections collide: `modified` keeps an edited class, and that
  // class keeps pointing at features the cleanup wants to remove. Deleting them
  // would leave it with dangling refs — the failure the race import already had.
  const existing = [{ id: 'srd-2024_cantrips', data: { source: 'srd', name: 'Cantrips' } }]
  const free = plan([], existing, new Set())
  assert.deepEqual(free.orphan.map(o => o.name), ['Cantrips'], 'unreferenced: removed')

  const held = plan([], existing, new Set(['srd-2024_cantrips']))
  assert.equal(held.orphan.length, 0, 'referenced: NOT removed')
  assert.deepEqual(held.orphanKept, ['Cantrips (still referenced)'])
})

/* ------------------------------------------------------------------
   Guard: the class progression table reads at the right level.

   The columns of the class table (Rages, Weapon Mastery, Sorcery Points) are
   imported as level-indexed derived variables, `[0,2,2,…][level]`. Index 0 is
   the level-0 slot §35 reserves, so an array built without it is off by one at
   EVERY level — and it fails the way this codebase's worst bugs fail: no error,
   no blank, just a Barbarian told they have 2 weapon masteries at level 4 when
   they have 3. Nothing about the output looks wrong.

   Pinned against the SRD by hand for one class, plus the structural rule for
   all of them.
   ------------------------------------------------------------------ */

test('CLASS TABLE COLUMNS READ AT THE LEVEL, not one below it', async () => {
  const { evalExpr } = await import('./expr.ts')
  const classes = JSON.parse(readFileSync(join(ROOT, 'srd-data/classes.json'), 'utf8'))
  const features = JSON.parse(readFileSync(join(ROOT, 'srd-data/features.json'), 'utf8'))
  // Both homes — a column sits on its feature when one shares its name.
  const allVars = [
    ...classes.flatMap((c: { name: string; vars?: object[] }) => (c.vars ?? []).map(v => ({ owner: c.name, v }))),
    ...features.flatMap((f: { folder?: string; name: string; vars?: object[] }) =>
      (f.vars ?? []).map(v => ({ owner: `${f.folder}/${f.name}`, v }))),
  ] as { owner: string; v: { name: string; formula?: string } }[]
  const find = (name: string) => allVars.find(x => x.v.name === name)?.v

  const mastery = find('weaponMastery')
  assert.ok(mastery, 'weaponMastery must exist somewhere')
  // SRD 5.2 Barbarian: 2 weapon masteries at level 1, 3 at level 4, 4 at level 10.
  for (const [level, want] of [[1, 2], [3, 2], [4, 3], [9, 3], [10, 4], [20, 4]] as const) {
    const got = evalExpr(mastery.formula, { level })
    assert.equal(got.t === 'num' && got.flat, want, `weaponMastery at level ${level}`)
  }
  const rages = find('rages')!
  assert.equal((evalExpr(rages.formula, { level: 1 }) as { flat: number }).flat, 2)
  assert.equal((evalExpr(rages.formula, { level: 17 }) as { flat: number }).flat, 6)

  // Structural, across every class: 21 entries (level 0 plus levels 1–20), and
  // the level-0 slot is never a real value.
  for (const { owner, v } of allVars) {
    const m = /^\[([^\]]*)\]\[level\]$/.exec(v.formula ?? '')
    assert.ok(m, `${owner}.${v.name} is not a level-indexed table: ${v.formula}`)
    const cells = m[1].split(',')
    assert.equal(cells.length, 21, `${owner}.${v.name} must cover level 0 plus 1–20`)
    assert.equal(cells[0], '0', `${owner}.${v.name} must reserve index 0`)
  }
  assert.ok(allVars.length >= 25, `expected the class tables to be imported, saw ${allVars.length} columns`)
})

test('the columns the app already owns are NOT imported a second time', () => {
  // Proficiency bonus is canon (+3 at level 7) and spell slots come from
  // ClassDef.caster. A class-level copy of either is the same defect that has
  // shipped twice already: one authored value, two render paths.
  const classes = JSON.parse(readFileSync(join(ROOT, 'srd-data/classes.json'), 'utf8'))
  const bad = classes.flatMap((c: { name: string; vars?: { name: string }[] }) =>
    (c.vars ?? []).filter(v => /^(proficiencyBonus|slots?[1-9])/.test(v.name)).map(v => `${c.name}.${v.name}`))
  assert.deepEqual(bad, [])
})

/* ------------------------------------------------------------------
   Guard: the dangling-ref repair asks the right question.

   Deleting a feature leaves every class that granted it pointing at nothing.
   The repair drops those pointers — which is safe, because a pointer to a
   deleted row is already broken, and it is the ONE thing allowed to touch a
   `modified` row, since dead refs collect precisely on the rows the import
   may not rewrite.

   It is only safe while the test is "does the target exist". A one-off version
   asked "is the target in the SRD import" instead and deleted a homebrew
   class's only feature, because the feature was homebrew too. That is the case
   pinned below.
   ------------------------------------------------------------------ */

test('DEAD REFS ARE DROPPED, live ones are not', () => {
  const live = new Set(['a', 'b'])
  assert.equal(deadRefs({ features: [{ feature_id: 'a' }, { feature_id: 'b' }] }, live), null,
    'all resolve — the row must not be rewritten at all')
  assert.deepEqual(deadRefs({ features: [{ feature_id: 'a' }, { feature_id: 'gone' }] }, live),
    [{ feature_id: 'a' }])
  assert.equal(deadRefs({}, live), null, 'a row with no features is untouched')
  assert.deepEqual(deadRefs({ features: [{ when: 'level >= 3' }] }, live), [],
    'a ref with no feature_id points at nothing either')
})

test('A HOMEBREW REF SURVIVES — the predicate is existence, not provenance', () => {
  // Arbiter is the DM's own class and judgment_track their own feature. Neither
  // comes from the SRD; both exist. Nothing here may be touched.
  const live = new Set(['judgment_track', 'srd-2024_barbarian_rage'])
  assert.equal(deadRefs({ name: 'Arbiter', features: [{ feature_id: 'judgment_track' }] }, live), null)
  // And the gate still catches a genuinely deleted one alongside it.
  assert.deepEqual(
    deadRefs({ features: [{ feature_id: 'judgment_track' }, { feature_id: 'srd-2024_wizard_slots-1st' }] }, live),
    [{ feature_id: 'judgment_track' }])
})

test('a ref keeps its gate condition when the row is repaired', () => {
  // The repair rebuilds the array; dropping `when` would silently ungate every
  // surviving feature to level 1.
  const kept = deadRefs({ features: [{ feature_id: 'a', when: 'level >= 5' }, { feature_id: 'x' }] }, new Set(['a']))
  assert.deepEqual(kept, [{ feature_id: 'a', when: 'level >= 5' }])
})

/* ------------------------------------------------------------------
   Guard: a dice column splits into the number that actually moves.

   `[1d6,2d6][level]` cannot be written — the array type holds numbers and the
   dice live on the value type — so "NdM" is decomposed into count and faces,
   and only the one that varies becomes a variable. Getting the halves the wrong
   way round is silent: a Rogue with `martialArts`-style faces would read 6 at
   every level and look like a perfectly ordinary die size.
   ------------------------------------------------------------------ */

test('DICE COLUMNS SPLIT INTO THE HALF THAT MOVES, and label which half', () => {
  // A column's variable may sit on the class OR on the feature of the same
  // name — see the ownership test below — so look in both.
  const classes = JSON.parse(readFileSync(join(ROOT, 'srd-data/classes.json'), 'utf8'))
  const features = JSON.parse(readFileSync(join(ROOT, 'srd-data/features.json'), 'utf8'))
  const varOf = (cls: string, name: string) => {
    const onClass = classes.find((c: { name: string }) => c.name === cls)
      ?.vars?.find((v: { name: string }) => v.name === name)
    if (onClass) return onClass
    return features
      .filter((f: { folder?: string }) => f.folder === `SRD/${cls}`)
      .flatMap((f: { vars?: { name: string }[] }) => f.vars ?? [])
      .find((v: { name: string }) => v.name === name)
  }
  const at = (formula: string, level: number) =>
    Number(formula.slice(1, formula.indexOf(']')).split(',')[level])

  // Rogue: the d6 never changes, the COUNT does — 1d6 at 1, 2d6 at 3, 10d6 at 19.
  const sneak = varOf('Rogue', 'sneakAttackDice')
  assert.ok(sneak, 'Sneak Attack must yield a dice-count variable')
  assert.match(sneak.label, /number of dice/)
  assert.deepEqual([1, 3, 19, 20].map(l => at(sneak.formula, l)), [1, 2, 10, 10])
  assert.equal(varOf('Rogue', 'sneakAttackDie'), undefined, 'a constant d6 is not a variable')

  // Monk and Bard: always one die, and the SIZE moves.
  const monk = varOf('Monk', 'martialArtsDie')
  assert.match(monk.label, /die size/)
  assert.deepEqual([1, 5, 11, 17].map(l => at(monk.formula, l)), [6, 8, 10, 12])
  assert.equal(varOf('Monk', 'martialArtsDice'), undefined, 'the count is always 1')

  // "Bardic Die" must not become `bardicDieDie`.
  const bard = varOf('Bard', 'bardicDie')
  assert.ok(bard, 'Bardic Die must yield bardicDie')
  assert.deepEqual([1, 5, 10, 15].map(l => at(bard.formula, l)), [6, 8, 10, 12])
})

test('spellcasting is a class property, so no class grants it as a feature', () => {
  const features = JSON.parse(readFileSync(join(ROOT, 'srd-data/features.json'), 'utf8'))
  const bad = features
    .filter((f: { name: string }) => f.name === 'Spellcasting' || f.name === 'Pact Magic')
    .map((f: { name: string; folder: string }) => `${f.folder}/${f.name}`)
  assert.deepEqual(bad, [])
})

/* ------------------------------------------------------------------
   Guard: a column's variable lives where the feature can carry it.

   `weaponMastery` on the CLASS exists only for a character who has that class.
   Grant the Weapon Mastery feature on its own — to another class, as a one-off
   reward, which the Grant Feature card exists to do — and its prose renders
   the literal "{weaponMastery}", because the feature travelled and the variable
   stayed behind. That is not a rendering fault; the value genuinely is not in
   that character's scope.

   So a column whose name matches a feature of the same class belongs ON that
   feature. Columns with no matching feature are class-wide and stay put.
   ------------------------------------------------------------------ */

test('A COLUMN NAMED AFTER A FEATURE TRAVELS WITH IT', () => {
  const features = JSON.parse(readFileSync(join(ROOT, 'srd-data/features.json'), 'utf8'))
  const classes = JSON.parse(readFileSync(join(ROOT, 'srd-data/classes.json'), 'utf8'))

  const feat = (folder: string, name: string) =>
    features.find((f: { folder?: string; name: string }) => f.folder === folder && f.name === name)

  // Both Weapon Masteries carry their own progression.
  for (const cls of ['Barbarian', 'Fighter']) {
    const f = feat(`SRD/${cls}`, 'Weapon Mastery')
    assert.ok(f, `${cls} must have a Weapon Mastery feature`)
    assert.deepEqual((f.vars ?? []).map((v: { name: string }) => v.name), ['weaponMastery'],
      `${cls}'s Weapon Mastery must carry weaponMastery, or granting it alone renders the braces`)
    const onClass = classes.find((c: { name: string }) => c.name === cls)
    assert.ok(!(onClass.vars ?? []).some((v: { name: string }) => v.name === 'weaponMastery'),
      'and it must not ALSO sit on the class — one authored value, one home')
  }
  assert.ok(feat('SRD/Rogue', 'Sneak Attack').vars.some((v: { name: string }) => v.name === 'sneakAttackDice'))
  assert.ok(feat('SRD/Monk', 'Martial Arts').vars.some((v: { name: string }) => v.name === 'martialArtsDie'))

  // Class-wide columns have no feature of that name and stay on the class.
  const wizard = classes.find((c: { name: string }) => c.name === 'Wizard')
  assert.ok((wizard.vars ?? []).some((v: { name: string }) => v.name === 'preparedSpells'))
  assert.equal(feat('SRD/Wizard', 'Prepared Spells'), undefined)
})

test("a feature's own prose counts as reading its variable", async () => {
  // Otherwise moving a progression variable onto the feature that prints it
  // earns a "never used" warning for doing the right thing.
  const { auditNode } = await import('./graph.ts')
  const node = {
    vars: [{ name: 'weaponMastery', kind: 'derived' as const, formula: '[0,2,2][level]' }],
    prose: ['mastery of {weaponMastery} kinds of weapons'],
  }
  assert.deepEqual(auditNode(node).filter(a => /never used/i.test(a.t)), [])
  // …and the warning still fires when nothing reads it at all.
  assert.equal(auditNode({ ...node, prose: ['no spans here'] }).filter(a => /never used/i.test(a.t)).length, 1)
})
