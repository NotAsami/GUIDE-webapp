// Run: node --test src/lib/levelup.test.ts
//
// Level-up is the app's first writer of `identity.level`, and everything it
// touches is a NUMBER — the failure mode is not a crash, it is a sheet that
// looks deliberate and is wrong. So these assert the values, not the shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  CatalogClassRow, CatalogFeatureData, CatalogFeatureRow, CharacterRow, ClassDef,
} from './database.types.ts'
import {
  ASI_LEVELS, asiUsed, effectiveCaster, hpGainOf, levelUpPatch, levelUpPlan, nextCurrentHp,
  pendingLevelStale, profForLevel, recallLevelPatch, releaseLevelPatch, resolveClass,
  takeLevelPatch,
} from './levelup.ts'

// ── fixtures ────────────────────────────────────────────────────────────────

const FEATURE = (name: string): CatalogFeatureData => ({ name, category: 'class' })

const featureData = new Map<string, CatalogFeatureData>([
  ['f_early', FEATURE('Martial Reserve')],
  ['f_at8', FEATURE('Indomitable')],
  ['f_at12', FEATURE('Far Verdict')],
  ['f_sub', FEATURE('Warden Stance')],
])

const ARBITER: ClassDef = {
  name: 'Arbiter', icon: 'fa-scale-balanced', desc: '', hitDie: 10, primaryAbility: 'str',
  saveProficiencies: ['str', 'con'], skillChoices: [], skillChooseN: 0, proficiencies: {},
  startingEquipment: [], caster: 'half', castingAbility: 'wis', tags: [], vars: [], graph: [],
  features: [
    { feature_id: 'f_early', when: 'level >= 1' },
    { feature_id: 'f_at8', when: 'level >= 8' },
    { feature_id: 'f_at12', when: 'level >= 12' },
  ],
  published: true,
}

const WARDEN: ClassDef = {
  ...ARBITER, name: 'Warden', parent: 'arbiter', caster: 'none',
  features: [{ feature_id: 'f_sub', when: 'level >= 8' }],
}

const WIZARD: ClassDef = { ...ARBITER, name: 'Wizard', hitDie: 6, caster: 'full', castingAbility: 'int', features: [] }
const WARLOCK: ClassDef = { ...ARBITER, name: 'Warlock', hitDie: 8, caster: 'pact', castingAbility: 'cha', features: [] }

const CLASSES: CatalogClassRow[] = [
  { id: 'arbiter', data: ARBITER, draft: null, updated_at: '' },
  { id: 'warden', data: WARDEN, draft: null, updated_at: '' },
  { id: 'wizard', data: WIZARD, draft: null, updated_at: '' },
  { id: 'warlock', data: WARLOCK, draft: null, updated_at: '' },
]

/** Level 7 Arbiter with a carrier: prof +3 (what the formula gives at 7), CON
 *  16 (+3), 52/52 HP, 7d10 all unspent, half-caster slots for level 7. */
function char(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'c1', owner: 'o', name: 'Ros Chrisstone',
    identity: { class: 'Arbiter', level: 7 },
    sheet: {
      abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 16, cha: 12 },
      hp: { current: 52, max: 52 },
      hitDice: { current: 7, max: 7, die: 'd10' },
      proficiencyBonus: 3,
      features: [{ id: 'cls:arbiter', name: 'Arbiter' }, { id: 'cls:arbiter:f_early', name: 'Martial Reserve' }],
    },
    resources: {}, inventory: [], equipped: {},
    spellbook: { spellcasting: true, ability: 'wis', saveDC: 14, attackBonus: 6, slots: [] },
    ...over,
  } as CharacterRow
}

const plan = (row = char(), classes = CLASSES) => levelUpPlan(row, classes, featureData)
const NO_CHOICE = { asiAlloc: {}, feat: null, featureIds: [] }

// ── derivations ─────────────────────────────────────────────────────────────

test('profForLevel is the SRD step function', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profForLevel), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
})

test('ASI_LEVELS is advisory only — the ladder, not a gate', () => {
  assert.deepEqual(ASI_LEVELS, [4, 8, 12, 16, 19])
})

test('resolveClass reads the carrier id, not the identity name', () => {
  // Two rows could share a name; the carrier is the actual link.
  const r = resolveClass(char(), CLASSES)
  assert.equal(r.clsId, 'arbiter')
  assert.equal(r.cls?.name, 'Arbiter')
})

test('resolveClass falls back to the identity name when there is no carrier', () => {
  // Cornelius in the dev DB: class seeded, never assigned, so no `cls:` feature.
  const seeded = char({ identity: { class: 'Warlock', level: 3 }, sheet: { ...char().sheet, features: [] } })
  const r = resolveClass(seeded, CLASSES)
  assert.equal(r.clsId, 'warlock')
  assert.equal(r.cls?.hitDie, 8)
})

test('two carriers sort by the parent flag, not by order', () => {
  const ek = resolveClass(char({
    sheet: { ...char().sheet, features: [{ id: 'cls:arbiter', name: 'A' }, { id: 'cls:warden', name: 'W' }] },
  }), CLASSES)
  assert.equal(ek.clsId, 'arbiter')
  assert.equal(ek.subId, 'warden')
  // Warden declares 'none', which means "says nothing" — the parent's half stands.
  assert.equal(effectiveCaster(ek), 'half')
})

test('a subclass that declares a caster type overrides the parent', () => {
  const arcane: ClassDef = { ...WARDEN, caster: 'third' }
  const rows: CatalogClassRow[] = [...CLASSES, { id: 'arcane', data: arcane, draft: null, updated_at: '' }]
  const r = resolveClass(char({
    sheet: { ...char().sheet, features: [{ id: 'cls:arbiter', name: 'A' }, { id: 'cls:arcane', name: 'X' }] },
  }), rows)
  assert.equal(effectiveCaster(r), 'third')
})

// ── the plan ────────────────────────────────────────────────────────────────

test('the plan reads level, hit die and CON off the row', () => {
  const p = plan()
  assert.equal(p.fromLevel, 7)
  assert.equal(p.toLevel, 8)
  assert.equal(p.hitDie, 10)
  assert.equal(p.avg, 6)
  assert.equal(p.conMod, 3)
  assert.equal(p.hitDiceFrom, '7d10')
  assert.equal(p.hitDiceTo, '8d10')
})

test('proficiency is writable when the stored value still matches the formula', () => {
  const p = plan()
  assert.equal(p.profFrom, 3)
  assert.equal(p.profTo, 3)         // 7 -> 8 does not step
  assert.equal(p.profWritable, true)
})

test('a hand-tuned proficiency bonus is HELD, not overwritten', () => {
  const homebrew = char({ sheet: { ...char().sheet, proficiencyBonus: 5 } })
  const p = plan(homebrew)
  assert.equal(p.profWritable, false)
  const patch = levelUpPatch(homebrew, p, { die: 6, ...NO_CHOICE })
  assert.equal(patch.sheet?.proficiencyBonus, 5)
})

test('a stepping level writes the new proficiency bonus', () => {
  const l8 = char({ identity: { class: 'Arbiter', level: 8 }, sheet: { ...char().sheet, proficiencyBonus: 3 } })
  const p = plan(l8)
  assert.equal(p.profTo, 4)
  assert.equal(p.profWritable, true)
  assert.equal(levelUpPatch(l8, p, { die: 6, ...NO_CHOICE }).sheet?.proficiencyBonus, 4)
})

// ── HP ──────────────────────────────────────────────────────────────────────

test('max AND current both rise by die + CON — levelling does not heal', () => {
  const row = char({ sheet: { ...char().sheet, hp: { current: 31, max: 52 } } })
  const patch = levelUpPatch(row, plan(row), { die: 4, ...NO_CHOICE })
  assert.equal(hpGainOf(plan(row), 4), 7)
  assert.equal(patch.sheet?.hp?.max, 59)
  assert.equal(patch.sheet?.hp?.current, 38)
})

test('temp HP is untouched by the gain', () => {
  const row = char({ sheet: { ...char().sheet, hp: { current: 52, max: 52, temp: 7 } } })
  const patch = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE })
  assert.equal(patch.sheet?.hp?.temp, 7)
  assert.equal(patch.sheet?.hp?.max, 61)
})

test('current clamps to the new max rather than drifting above it', () => {
  // Nothing boosts max here, so a current already at the ceiling stays at it.
  const row = char({ sheet: { ...char().sheet, hp: { current: 52, max: 52 } } })
  const patch = levelUpPatch(row, plan(row), { die: 10, ...NO_CHOICE })
  assert.equal(patch.sheet?.hp?.max, 65)
  assert.equal(patch.sheet?.hp?.current, 65)
})

// ── hit dice ────────────────────────────────────────────────────────────────

test('levelling never LOWERS current HP, even from above the ceiling', () => {
  // Ros in the dev DB: 72 current against a base max of 52. The clamp must not
  // read that as licence to take 11 HP off him.
  const row = char({ sheet: { ...char().sheet, hp: { current: 72, max: 52, temp: 7 } } })
  const patch = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE })
  assert.equal(patch.sheet?.hp?.max, 61)
  assert.equal(patch.sheet?.hp?.current, 72)
})

test('the note and the write agree — one producer for the projected current HP', () => {
  // This shipped as two: the patch clamped correctly while step 01's note did
  // its own arithmetic and promised Ros 56 HP on a write that left him at 72.
  for (const hp of [{ current: 31, max: 52 }, { current: 52, max: 52 }, { current: 72, max: 52, temp: 7 }]) {
    const row = char({ sheet: { ...char().sheet, hp } })
    const p = plan(row)
    const gain = hpGainOf(p, 6)
    const written = levelUpPatch(row, p, { die: 6, ...NO_CHOICE }).sheet?.hp?.current
    const shown = nextCurrentHp(hp.current, gain, hp.max + gain, p.hpMaxBonus)
    assert.equal(shown, written, `note and patch disagree for ${JSON.stringify(hp)}`)
  }
})

test('hit dice max IS the level, and a spent die stays spent', () => {
  const row = char({ sheet: { ...char().sheet, hitDice: { current: 4, max: 7, die: 'd10' } } })
  const hd = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE }).sheet?.hitDice
  assert.equal(hd?.max, 8)
  assert.equal(hd?.current, 5)   // 3 were spent; still 3 spent
  assert.equal(hd?.die, 'd10')
})

test('a stale seeded hit-dice max is corrected, not incremented', () => {
  // Cornelius: Warlock 3 with hitDice.max 5. 3 -> 4 must land on 4, not 6.
  const row = char({
    identity: { class: 'Warlock', level: 3 },
    sheet: { ...char().sheet, features: [], hitDice: { current: 5, max: 5, die: 'd8' } },
  })
  const hd = levelUpPatch(row, plan(row), { die: 5, ...NO_CHOICE }).sheet?.hitDice
  assert.equal(hd?.max, 4)
  assert.equal(hd?.current, 4)
})

// ── spell slots ─────────────────────────────────────────────────────────────

test('slots come from casterSlots at the new level, with expended clamped down', () => {
  const row = char({
    spellbook: { ...char().spellbook, slots: [{ level: 1, total: 4, expended: 4 }, { level: 2, total: 3, expended: 1 }] },
  })
  const slots = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE }).spellbook?.slots
  // Half caster at 8 reads the full table at ceil(8/2) = 4 -> [4,3,0,...]
  assert.deepEqual(slots?.slice(0, 3).map(s => s.total), [4, 3, 0])
  assert.equal(slots?.[0].expended, 4)
  assert.equal(slots?.[1].expended, 1)
  assert.equal(slots?.length, 9)
})

test('expended is clamped when a slot count would shrink', () => {
  const row = char({ spellbook: { ...char().spellbook, slots: [{ level: 3, total: 9, expended: 9 }] } })
  const slots = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE }).spellbook?.slots
  assert.equal(slots?.[2].total, 0)
  assert.equal(slots?.[2].expended, 0)
})

test('a pact caster gets no slot ladder written at all', () => {
  const row = char({
    identity: { class: 'Warlock', level: 3 },
    sheet: { ...char().sheet, features: [] },
    spellbook: { spellcasting: true, ability: 'cha', pactMagic: true, saveDC: 13, attackBonus: 5 },
  })
  const p = plan(row)
  assert.equal(p.caster, 'pact')
  assert.deepEqual(p.pactTo, { count: 2, level: 2 })
  assert.equal(levelUpPatch(row, p, { die: 5, ...NO_CHOICE }).spellbook?.slots, undefined)
})

test('a non-caster gets no spellbook patch at all', () => {
  const rows: CatalogClassRow[] = [{ id: 'arbiter', data: { ...ARBITER, caster: 'none' }, draft: null, updated_at: '' }]
  const row = char()
  const p = plan(row, rows)
  assert.equal(p.caster, 'none')
  assert.equal(levelUpPatch(row, p, { die: 6, ...NO_CHOICE }).spellbook, undefined)
})

// ── casting numbers ─────────────────────────────────────────────────────────

test('save DC and attack bonus re-seed when prof steps and nothing was tuned', () => {
  // WIS 16 (+3), prof 3 -> 4 at level 9. Stored DC 14 = 8 + 3 + 3, so untouched.
  const l8 = char({ identity: { class: 'Arbiter', level: 8 } })
  const p = plan(l8)
  assert.equal(p.castWritable, true)
  const sb = levelUpPatch(l8, p, { die: 6, ...NO_CHOICE }).spellbook
  assert.equal(sb?.saveDC, 15)
  assert.equal(sb?.attackBonus, 7)
})

test('a hand-tuned save DC is HELD when prof steps', () => {
  const l8 = char({ identity: { class: 'Arbiter', level: 8 }, spellbook: { ...char().spellbook, saveDC: 17 } })
  const p = plan(l8)
  assert.equal(p.castWritable, false)
  const sb = levelUpPatch(l8, p, { die: 6, ...NO_CHOICE }).spellbook
  assert.equal(sb?.saveDC, 17)
  assert.equal(sb?.attackBonus, 6)
})

// ── features ────────────────────────────────────────────────────────────────

test('a gate opening at the new level is offered fresh, under the assignClass id', () => {
  const p = plan()
  const fresh = p.offers.filter(o => o.fresh)
  assert.deepEqual(fresh.map(o => o.id), ['cls:arbiter:f_at8'])
  assert.equal(fresh[0].at, 8)
  assert.equal(fresh[0].source, 'Arbiter')
})

test('an already-granted feature is never offered twice', () => {
  const p = plan()
  assert.equal(p.offers.some(o => o.id === 'cls:arbiter:f_early'), false)
})

test('a gate already open but never granted is offered UNCHECKED, not lost', () => {
  // Same character minus the f_early grant: level 1's gate is open, was missed.
  const missed = char({ sheet: { ...char().sheet, features: [{ id: 'cls:arbiter', name: 'Arbiter' }] } })
  const p = plan(missed)
  const stale = p.offers.find(o => o.id === 'cls:arbiter:f_early')
  assert.ok(stale, 'the missed grant must still be offered')
  assert.equal(stale.fresh, false)
  // Fresh ones sort first so the step reads as "new at this level" by default.
  assert.equal(p.offers[0].fresh, true)
})

test('a feature already held under a HAND-GRANT id is not offered again', () => {
  // Ros in the dev DB: "Judgment Track" arrived through Grant Feature as
  // `feat-<uuid>`, and the Arbiter class references the same catalog row. Only
  // the feature_id back-ref says they are the same thing.
  const handGranted = char({
    sheet: {
      ...char().sheet,
      features: [
        { id: 'cls:arbiter', name: 'Arbiter' },
        { id: 'feat-744cd48f', name: 'Indomitable', feature_id: 'f_at8' },
      ],
    },
  })
  assert.equal(plan(handGranted).offers.some(o => o.featureId === 'f_at8'), false)
})

test('a gate that is still closed at the new level is not offered', () => {
  assert.equal(plan().offers.some(o => o.id === 'cls:arbiter:f_at12'), false)
})

test('subclass gates are collected under their own class id', () => {
  const withSub = char({
    sheet: { ...char().sheet, features: [{ id: 'cls:arbiter', name: 'A' }, { id: 'cls:warden', name: 'W' }] },
  })
  const ids = plan(withSub).offers.map(o => o.id)
  assert.ok(ids.includes('cls:warden:f_sub'))
})

test('only CHECKED offers are written, and they carry the acquisition level', () => {
  const row = char()
  const p = plan(row)
  const none = levelUpPatch(row, p, { die: 6, ...NO_CHOICE })
  assert.equal(none.sheet?.features?.length, 2, 'nothing checked writes nothing')

  const took = levelUpPatch(row, p, { die: 6, asiAlloc: {}, feat: null, featureIds: ['cls:arbiter:f_at8'] })
  const added = took.sheet?.features?.find(f => f.id === 'cls:arbiter:f_at8')
  assert.equal(added?.name, 'Indomitable')
  assert.equal(added?.feature_id, 'f_at8')
  assert.equal(added?.level, 8)
  assert.equal(took.sheet?.features?.length, 3)
})

test('a feat is snapshotted with a fresh instance id and tagged levelup', () => {
  const row = char()
  const feat: CatalogFeatureRow = {
    id: 'cat_alert', data: { name: 'Alert', category: 'feat' }, draft: null, updated_at: '',
  }
  const patch = levelUpPatch(row, plan(row), { die: 6, asiAlloc: {}, feat, featureIds: [] })
  const added = patch.sheet?.features?.find(f => f.name === 'Alert')
  assert.ok(added?.id.startsWith('feat-'), 'a feat is an instance, not a class grant')
  assert.equal(added?.feature_id, 'cat_alert')
  assert.equal(added?.kind, 'levelup')
})

// ── ASI ─────────────────────────────────────────────────────────────────────

test('an ASI writes the BASE ability score', () => {
  const row = char()
  const patch = levelUpPatch(row, plan(row), { die: 6, asiAlloc: { str: 1, con: 1 }, feat: null, featureIds: [] })
  assert.equal(patch.sheet?.abilities?.str, 19)
  assert.equal(patch.sheet?.abilities?.con, 17)
  assert.equal(patch.sheet?.abilities?.dex, 14, 'untouched abilities survive')
})

test('an ASI cannot push a score past 20', () => {
  const row = char({ sheet: { ...char().sheet, abilities: { str: 19, dex: 14, con: 16, int: 10, wis: 16, cha: 12 } } })
  const patch = levelUpPatch(row, plan(row), { die: 6, asiAlloc: { str: 2 }, feat: null, featureIds: [] })
  assert.equal(patch.sheet?.abilities?.str, 20)
})

test('asiUsed counts the bank', () => {
  assert.equal(asiUsed({}), 0)
  assert.equal(asiUsed({ str: 2 }), 2)
  assert.equal(asiUsed({ str: 1, wis: 1 }), 2)
})

// ── the whole patch ─────────────────────────────────────────────────────────

test('level is the one identity field that moves', () => {
  const row = char({ identity: { class: 'Arbiter', level: 7, archetype: 'Warden', reputation: 4 } })
  const id = levelUpPatch(row, plan(row), { die: 6, ...NO_CHOICE }).identity
  assert.equal(id?.level, 8)
  assert.equal(id?.archetype, 'Warden')
  assert.equal(id?.reputation, 4)
})

test('a character with no resolvable class is flagged rather than guessed at', () => {
  const p = plan(char({ identity: { class: 'Sommelier', level: 3 }, sheet: { ...char().sheet, features: [] } }))
  assert.equal(p.classMissing, true)
  // The die still falls back to what the sheet says rather than a bare 8.
  assert.equal(p.hitDie, 10)
})

// ── RELEASING A LEVEL ───────────────────────────────────────────────────────
//
// The player cannot compute a plan: `class_catalog` and `feature_catalog` have
// no player policy, so their select returns ZERO ROWS. Everything below exists
// because the plan therefore has to survive a round trip through the sheet and
// come back out meaning exactly what it meant when the DM built it.

const FEAT_ROWS: CatalogFeatureRow[] = [
  { id: 'srd_alert', data: { name: 'Alert', category: 'feat' }, draft: null, updated_at: '' },
]

const released = (row = char()) =>
  releaseLevelPatch(row, plan(row), FEAT_ROWS, '2026-08-23T20:14:00.000Z').sheet!.pendingLevel!

test('RELEASE PARKS THE WHOLE PLAN — a player who cannot read the catalogs still gets one', () => {
  const p = released()
  assert.equal(p.plan.fromLevel, 7)
  assert.equal(p.plan.toLevel, 8)
  assert.equal(p.plan.hitDie, 10)
  assert.equal(p.releasedAt, '2026-08-23T20:14:00.000Z')
  // The offers carry their catalog DATA, not ids: an id would render as a blank
  // row on the one screen that has to show it.
  assert.equal(p.plan.offers.find(o => o.featureId === 'f_at8')?.data.name, 'Indomitable')
  assert.deepEqual(p.feats.map(f => f.data.name), ['Alert'])
})

test('release leaves the rest of the sheet alone', () => {
  const row = char()
  const next = releaseLevelPatch(row, plan(row), FEAT_ROWS).sheet!
  assert.deepEqual(next.hp, row.sheet!.hp)
  assert.deepEqual(next.features, row.sheet!.features)
  assert.equal(next.proficiencyBonus, 3)
})

test('RE-RELEASING REPLACES rather than stacking — one level at a time', () => {
  const row = char()
  const first = char({ sheet: releaseLevelPatch(row, plan(row), FEAT_ROWS, 'A').sheet })
  const second = releaseLevelPatch(first, plan(first), FEAT_ROWS, 'B').sheet!.pendingLevel!
  assert.equal(second.releasedAt, 'B', 'the newer release wins')
  assert.equal(second.plan.toLevel, 8, 'and it is still ONE level, not two queued')
})

test('recall removes the release and nothing else', () => {
  const row = char()
  const withRelease = char({ sheet: releaseLevelPatch(row, plan(row), FEAT_ROWS).sheet })
  const after = recallLevelPatch(withRelease).sheet!
  assert.equal(after.pendingLevel, undefined)
  assert.deepEqual(after.hp, row.sheet!.hp, 'an untaken level wrote nothing, so nothing is undone')
  assert.deepEqual(after.hitDice, row.sheet!.hitDice)
})

test('A RELEASED PLAN APPLIES IDENTICALLY to the one the DM would have walked', () => {
  // The whole promise of releasing: the player is handed the DM's plan, not a
  // reconstruction of it. Same row, same choices, same patch.
  const row = char()
  const live = levelUpPatch(row, plan(row), { ...NO_CHOICE, die: 6 })
  const parked = char({ sheet: releaseLevelPatch(row, plan(row), FEAT_ROWS).sheet })
  const taken = takeLevelPatch(parked, parked.sheet!.pendingLevel!, { ...NO_CHOICE, die: 6 })
  assert.deepEqual(taken.identity, live.identity)
  assert.deepEqual(taken.sheet!.hp, live.sheet!.hp)
  assert.deepEqual(taken.sheet!.hitDice, live.sheet!.hitDice)
  assert.deepEqual(taken.spellbook, live.spellbook)
})

test('TAKING CLEARS THE RELEASE IN THE SAME WRITE, and still writes the level', () => {
  // levelUpPatch spreads the CURRENT sheet — which still carries the
  // pendingLevel it is spending. Clear it anywhere but on top of that result
  // and the card goes on offering a level the player already took.
  const row = char()
  const parked = char({ sheet: releaseLevelPatch(row, plan(row), FEAT_ROWS).sheet })
  const patch = takeLevelPatch(parked, parked.sheet!.pendingLevel!, { ...NO_CHOICE, die: 6 })
  assert.equal(patch.sheet!.pendingLevel, undefined, 'the release must be spent')
  assert.equal(patch.identity!.level, 8, 'and the level must still move')
  assert.equal(patch.sheet!.hp!.max, 61, '52 + 6 + CON 3')
  assert.equal(patch.sheet!.hitDice!.max, 8)
})

test('taking does not disturb the OTHER parked decisions', () => {
  const withKit = char({
    sheet: { ...char().sheet, pendingSkills: { classId: 'arbiter', className: 'Arbiter', from: ['athletics'], count: 1 } },
  })
  const parked = char({ sheet: releaseLevelPatch(withKit, plan(withKit), FEAT_ROWS).sheet })
  const patch = takeLevelPatch(parked, parked.sheet!.pendingLevel!, { ...NO_CHOICE, die: 6 })
  assert.equal(patch.sheet!.pendingSkills?.count, 1, 'a skill pick is not a level-up casualty')
})

test('STALE ONLY WHEN THE LEVEL MOVED — the plan cannot be recomputed player-side', () => {
  const row = char()
  const p = released(row)
  assert.equal(pendingLevelStale(row, p), false, 'still on the level it was built for')
  assert.equal(pendingLevelStale(char({ identity: { class: 'Arbiter', level: 8 } }), p), true, 'levelled since')
  assert.equal(pendingLevelStale(char({ identity: { class: 'Arbiter', level: 6 } }), p), true, 'de-levelled since')
})

test('a level taken makes its own release stale, which is what stops a double take', () => {
  const row = char()
  const parked = char({ sheet: releaseLevelPatch(row, plan(row), FEAT_ROWS).sheet })
  const p = parked.sheet!.pendingLevel!
  const patch = takeLevelPatch(parked, p, { ...NO_CHOICE, die: 6 })
  const after = { ...parked, ...patch } as CharacterRow
  assert.equal(pendingLevelStale(after, p), true)
})

// ── PREREQUISITES ARE ENFORCED BY THE WRITE ─────────────────────────────────
//
// The overlay locks the row; this is what makes it a rule rather than a
// courtesy. A disabled checkbox is one `disabled` prop away from being gone,
// and the bug that prompted this was exactly that: the offers list rendered
// four fields and never looked at `prerequisite` at all, while the feat picker
// beside it did.

/** An Arbiter whose level-9 feature needs a level-2 one. */
const DEPENDENT = new Map<string, CatalogFeatureData>([
  ...featureData,
  ['f_reckless', FEATURE('Reckless Attack')],
  ['f_brutal', { name: 'Brutal Strike', category: 'class', prerequisite: 'Reckless Attack Feature' }],
])

const DEP_CLASS: CatalogClassRow[] = [{
  id: 'arbiter',
  data: { ...ARBITER, features: [
    { feature_id: 'f_reckless', when: 'level >= 2' },
    { feature_id: 'f_brutal', when: 'level >= 8' },
  ] },
  draft: null, updated_at: '',
}]

const depPlan = (row: CharacterRow) => levelUpPlan(row, DEP_CLASS, DEPENDENT)

test('AN UNMET PREREQUISITE IS NOT GRANTED, even when it was ticked', () => {
  // Level 7 Arbiter who never took Reckless Attack. Both offers are open at 8;
  // ticking only Brutal Strike must not write it.
  const row = char()
  const p = depPlan(row)
  const patch = levelUpPatch(row, p, { ...NO_CHOICE, die: 6, featureIds: ['cls:arbiter:f_brutal'] })
  const names = (patch.sheet?.features ?? []).map(f => f.name)
  assert.equal(names.includes('Brutal Strike'), false, 'the prerequisite is unmet')
})

test('THE BATCH SATISFIES ITSELF — taking both in one level works', () => {
  const row = char()
  const p = depPlan(row)
  const patch = levelUpPatch(row, p, {
    ...NO_CHOICE, die: 6,
    featureIds: ['cls:arbiter:f_reckless', 'cls:arbiter:f_brutal'],
  })
  const names = (patch.sheet?.features ?? []).map(f => f.name)
  assert.ok(names.includes('Reckless Attack'))
  assert.ok(names.includes('Brutal Strike'), 'the dependency is granted in the same write')
})

test('a prerequisite already on the sheet satisfies it', () => {
  const row = char({
    sheet: { ...char().sheet, features: [
      { id: 'cls:arbiter', name: 'Arbiter' },
      { id: 'cls:arbiter:f_reckless', name: 'Reckless Attack', feature_id: 'f_reckless' },
    ] },
  })
  const patch = levelUpPatch(row, depPlan(row), { ...NO_CHOICE, die: 6, featureIds: ['cls:arbiter:f_brutal'] })
  assert.ok((patch.sheet?.features ?? []).some(f => f.name === 'Brutal Strike'))
})

test('AN UNREADABLE PREREQUISITE STILL NEVER BLOCKS — homebrew stays grantable', () => {
  const odd = new Map<string, CatalogFeatureData>([
    ...featureData,
    ['f_odd', { name: 'Dragon Slayer', category: 'class', prerequisite: 'Must have slain a dragon' }],
  ])
  const cls: CatalogClassRow[] = [{
    id: 'arbiter', data: { ...ARBITER, features: [{ feature_id: 'f_odd', when: 'level >= 8' }] },
    draft: null, updated_at: '',
  }]
  const row = char()
  const p = levelUpPlan(row, cls, odd)
  const patch = levelUpPatch(row, p, { ...NO_CHOICE, die: 6, featureIds: ['cls:arbiter:f_odd'] })
  assert.ok((patch.sheet?.features ?? []).some(f => f.name === 'Dragon Slayer'))
})

test('a feature with NO prerequisite is unaffected — the old behaviour is intact', () => {
  const row = char()
  const patch = levelUpPatch(row, plan(row), { ...NO_CHOICE, die: 6, featureIds: ['cls:arbiter:f_at8'] })
  assert.ok((patch.sheet?.features ?? []).some(f => f.name === 'Indomitable'))
})
