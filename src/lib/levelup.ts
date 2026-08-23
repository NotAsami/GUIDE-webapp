/**
 * Advancement — what a level actually costs the character row.
 *
 * The overlay is a CHECKLIST the DM confirms, not a rules engine: everything
 * here SUGGESTS, and `levelUpPatch` writes only what the DM committed. That is
 * the mockup's own framing and it survives contact with homebrew, which a table
 * of hard-coded class progressions would not.
 *
 * Two halves, both pure so `node --test` can load them:
 *
 *  1. `levelUpPlan` — reads the row and answers "what would +1 level do?".
 *     Every number in it comes from a helper that already existed
 *     (casterSlots, hpForLevel, castingNumbers, gateOpen); nothing is
 *     re-derived here.
 *  2. `levelUpPatch` — turns the plan plus the DM's choices into ONE
 *     CharacterUpdate. One write, so a half-applied level-up is not a state
 *     the row can be in.
 *
 * WHY THE `writable` FLAGS EXIST. `sheet.proficiencyBonus` and
 * `spellbook.saveDC`/`attackBonus` are STORED in this app, not derived on read
 * (see the deliberate note in lib/previewScope.ts). So a level-up has to write
 * them — but the Spellcasting card lets a DM set the DC by hand, and silently
 * recomputing it would throw that away with no error and no fallback. The rule:
 * write the new value only when the stored one still equals the formula's
 * answer at the OLD level. Anything else is the DM's, and is HELD.
 */
import {
  casterSlots, castingNumbers, featureSnapshot, gateLevel, gateOpen, hitDieAverage, CLASS_GRANT_PREFIX,
} from './classes.ts'
import { abilities, abilityMod } from './dnd.ts'
import { characterVars } from './graph.ts'
import { effectiveSheet } from './effects.ts'
import { pactSlotCount, pactSlotLevel } from './spells.ts'
import type { ExprScope } from './expr.ts'
import type {
  AbilityKey, CatalogClassRow, CatalogFeatureData, CatalogFeatureRow, CharacterRow,
  CharacterUpdate, ClassCasterType, ClassDef, Feature, HP, ShardTree, SpellSlot,
} from './database.types.ts'

/** The SRD's standard ability-score-improvement ladder.
 *
 *  ADVISORY, never a gate. Every class in the catalog authors ASI as one
 *  feature reference gated `level >= 4`, so the DATA cannot say which levels are
 *  ASI levels — and a Fighter (6, 14) or Rogue (10) has more than these five.
 *  The overlay's step is always open; this only decides which tag it wears. */
export const ASI_LEVELS = [4, 8, 12, 16, 19]

/** Proficiency bonus for a total character level — the SRD step function.
 *  The FIRST derivation of it in the codebase: `dnd.ts proficiency()` reads the
 *  stored value, because the DM is allowed to override it. */
export const profForLevel = (level: number) => Math.floor((Math.max(1, level) - 1) / 4) + 2

/** A class carrier is exactly `cls:<classId>` — a granted feature is
 *  `cls:<classId>:<featureId>`, so the absence of a second colon is what tells
 *  them apart (lib/classes.ts assignClass). */
const CARRIER_RE = /^cls:([^:]+)$/

export type ResolvedClass = {
  clsId: string | null
  cls: ClassDef | null
  subId: string | null
  sub: ClassDef | null
}

/**
 * Which catalog rows this character's class and subclass are.
 *
 * The carrier feature is the reliable link, because `identity.class` stores a
 * NAME and two rows may share one. But a character whose class was SEEDED
 * rather than assigned has no carrier at all, and that is not a rare edge —
 * it is most of the dev database. So the name match is a real fallback, not a
 * courtesy: without it the overlay has no hit die and no caster type.
 */
export function resolveClass(row: CharacterRow, classRows: CatalogClassRow[]): ResolvedClass {
  const byId = new Map(classRows.map(r => [r.id, r.data]))
  const out: ResolvedClass = { clsId: null, cls: null, subId: null, sub: null }

  for (const f of row.sheet?.features ?? []) {
    const m = CARRIER_RE.exec(f.id ?? '')
    if (!m) continue
    const data = byId.get(m[1])
    if (!data) continue
    if (data.parent) { out.subId = m[1]; out.sub = data } else { out.clsId = m[1]; out.cls = data }
  }

  if (!out.cls) {
    const name = (row.identity?.class ?? '').trim().toLowerCase()
    const hit = name ? classRows.find(r => !r.data.parent && r.data.name.trim().toLowerCase() === name) : undefined
    if (hit) { out.clsId = hit.id; out.cls = hit.data }
  }
  if (!out.sub) {
    const name = (row.identity?.archetype ?? '').trim().toLowerCase()
    const hit = name ? classRows.find(r => !!r.data.parent && r.data.name.trim().toLowerCase() === name) : undefined
    if (hit) { out.subId = hit.id; out.sub = hit.data }
  }
  return out
}

/** A feature a gate makes available, and the id it would be granted under. */
export type FeatureOffer = {
  /** `cls:<classId>:<featureId>` — the id assignClass would have used, so a
   *  later re-assign replaces rather than duplicates. */
  id: string
  featureId: string
  data: CatalogFeatureData
  /** The class or subclass that references it. */
  source: string
  /** The level floor its gate names, for the row's tag. */
  at: number | null
  /** True when the gate opens AT the new level — those arrive pre-checked. */
  fresh: boolean
}

export type LevelUpPlan = {
  charId: string
  name: string
  className: string
  archetype: string
  fromLevel: number
  toLevel: number

  hitDie: number
  /** 5e's "or N" shortcut — d6→4, d8→5, d10→6, d12→7. */
  avg: number
  conMod: number
  hitDiceFrom: string
  hitDiceTo: string

  abilityScores: Record<AbilityKey, number>

  profFrom: number
  profTo: number
  /** False when the stored bonus is not what the formula gives at fromLevel —
   *  the DM tuned it, so Apply holds it. */
  profWritable: boolean

  caster: ClassCasterType
  slotsFrom: number[]
  slotsTo: number[]
  pactFrom: { count: number; level: number } | null
  pactTo: { count: number; level: number } | null

  /** Casting numbers at the new proficiency, and whether Apply may write them. */
  castFrom: { saveDC: number; attackBonus: number } | null
  castTo: { saveDC: number; attackBonus: number } | null
  castWritable: boolean

  /** Effective max HP minus base — the shard/gear headroom `nextCurrentHp`
   *  clamps against, so step 01's note and the patch reach the same answer. */
  hpMaxBonus: number

  offers: FeatureOffer[]
  /** Set when there is no class row to read — the overlay renders an empty
   *  state instead of guessing a d8. */
  classMissing: boolean
}

/** The DM's answers. `hpGain` is the DIE RESULT, not the total — the CON mod is
 *  the plan's business, so a mode switch cannot forget to add it. */
export type LevelUpChoices = {
  die: number
  asiAlloc: Partial<Record<AbilityKey, number>>
  /** A catalog row when the DM took a feat instead of the ASI. */
  feat: CatalogFeatureRow | null
  /** Offer ids the DM left checked. */
  featureIds: string[]
}

const ABILS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

/** The gate scope at an arbitrary level. `characterVars` builds the character's
 *  real one; only `level` moves, because that is the only thing a level-up is
 *  allowed to pretend about. */
function scopeAt(row: CharacterRow, shardTrees: Record<string, ShardTree>, level: number): ExprScope {
  return { ...characterVars(row, shardTrees).scope, level }
}

/** Every gate on this class/subclass that is open at `toLevel` and has NOT
 *  already been granted.
 *
 *  Two lists in one, distinguished by `fresh`. The mockup only knows "new at
 *  this level", but a gate the DM unticks here would then be gone forever —
 *  the next level-up diffs from→to and would never mention it again. Offering
 *  every ungranted open gate makes the step self-healing, and costs a second
 *  boolean rather than new state on the row. */
function collectOffers(
  row: CharacterRow,
  resolved: ResolvedClass,
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree>,
  fromLevel: number,
  toLevel: number,
): FeatureOffer[] {
  /* TWO keys, because a feature can already be on the sheet under an id this
     never generated. Ros holds "Judgment Track" as `feat-<uuid>` from the Grant
     Feature card, while the Arbiter class references the same catalog row — so
     matching on the grant id alone offers him a second copy of a feature he has
     had all along. The `feature_id` back-ref is what makes them the same thing. */
  const had = new Set((row.sheet?.features ?? []).map(f => f.id))
  const hadTemplate = new Set(
    (row.sheet?.features ?? []).map(f => f.feature_id).filter((x): x is string => !!x))
  const before = scopeAt(row, shardTrees, fromLevel)
  const after = scopeAt(row, shardTrees, toLevel)
  const out: FeatureOffer[] = []

  for (const [id, def] of [[resolved.clsId, resolved.cls], [resolved.subId, resolved.sub]] as const) {
    if (!id || !def) continue
    for (const ref of def.features ?? []) {
      const data = featureData.get(ref.feature_id)
      if (!data) continue
      if (!gateOpen(ref.when, after)) continue
      const grantId = `${CLASS_GRANT_PREFIX}${id}:${ref.feature_id}`
      if (had.has(grantId) || hadTemplate.has(ref.feature_id)) continue
      out.push({
        id: grantId,
        featureId: ref.feature_id,
        data,
        source: def.name,
        at: gateLevel(ref.when),
        fresh: !gateOpen(ref.when, before),
      })
    }
  }
  // Fresh grants first — those are the ones this level actually unlocked.
  return out.sort((a, b) => Number(b.fresh) - Number(a.fresh) || (a.at ?? 99) - (b.at ?? 99))
}

/** The caster type that actually applies. A subclass that declares one WINS —
 *  that is what an Eldritch Knight does to a martial class — and 'none' on a
 *  subclass means "says nothing", not "revokes". Same rule subclassGrants uses. */
export function effectiveCaster(r: ResolvedClass): ClassCasterType {
  if (r.sub && r.sub.caster !== 'none') return r.sub.caster
  return r.cls?.caster ?? 'none'
}

export function levelUpPlan(
  row: CharacterRow,
  classRows: CatalogClassRow[],
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree> = {},
): LevelUpPlan {
  const sheet = row.sheet ?? {}
  const fromLevel = row.identity?.level ?? 1
  const toLevel = fromLevel + 1
  const resolved = resolveClass(row, classRows)

  const hitDie = resolved.cls?.hitDie ?? (parseInt((sheet.hitDice?.die ?? 'd8').slice(1), 10) || 8)
  const scores = abilities(sheet)
  const conMod = abilityMod(scores.con)

  const storedProf = sheet.proficiencyBonus ?? 2
  const profTo = profForLevel(toLevel)
  const profWritable = storedProf === profForLevel(fromLevel)

  const caster = effectiveCaster(resolved)
  const castAbility = (resolved.sub?.castingAbility ?? resolved.cls?.castingAbility)
  const sb = row.spellbook ?? {}

  const castFrom = castingNumbers(sheet, castAbility)
  const castTo = castingNumbers({ ...sheet, proficiencyBonus: profTo }, castAbility)
  // Same rule as the proficiency guard: only when what is stored is still what
  // the formula gave at the old level. A DM who typed a DC keeps it.
  // `caster === 'none'` short-circuits it: a martial class row may still carry a
  // stale castingAbility, and writing a save DC onto a Fighter is a confident
  // wrong number on a sheet that has no business having one.
  const castWritable = caster !== 'none' && !!castFrom
    && (sb.saveDC ?? castFrom.saveDC) === castFrom.saveDC
    && (sb.attackBonus ?? castFrom.attackBonus) === castFrom.attackBonus

  return {
    charId: row.id,
    name: row.name,
    className: resolved.cls?.name ?? row.identity?.class ?? 'Unclassed',
    archetype: resolved.sub?.name ?? row.identity?.archetype ?? '',
    fromLevel,
    toLevel,
    hitDie,
    avg: hitDieAverage(hitDie as ClassDef['hitDie']),
    conMod,
    hitDiceFrom: `${fromLevel}d${hitDie}`,
    hitDiceTo: `${toLevel}d${hitDie}`,
    abilityScores: scores,
    profFrom: storedProf,
    profTo,
    profWritable,
    caster,
    slotsFrom: casterSlots(caster, fromLevel),
    slotsTo: casterSlots(caster, toLevel),
    pactFrom: caster === 'pact' ? { count: pactSlotCount(fromLevel), level: pactSlotLevel(fromLevel) } : null,
    pactTo: caster === 'pact' ? { count: pactSlotCount(toLevel), level: pactSlotLevel(toLevel) } : null,
    castFrom,
    castTo,
    castWritable,
    hpMaxBonus: (effectiveSheet(row, shardTrees).hp?.max ?? (sheet.hp?.max ?? 0)) - (sheet.hp?.max ?? 0),
    offers: collectOffers(row, resolved, featureData, shardTrees, fromLevel, toLevel),
    classMissing: !resolved.cls,
  }
}

/** Total max-HP gain: the die result the DM committed, plus CON. */
export const hpGainOf = (plan: LevelUpPlan, die: number) => die + plan.conMod

/**
 * Where current HP lands after a gain.
 *
 * ONE PRODUCER, because it already shipped as two. The patch clamped correctly
 * while step 01's note recomputed the same number its own way, so the overlay
 * promised Ros 56 HP on a level-up that (rightly) left him on 72 — a confident
 * wrong number, no error, no fallback. Both call this now.
 *
 * The clamp stops a character drifting further above their ceiling; the
 * `Math.max` is what stops it CONFISCATING HP from someone already above it.
 */
export function nextCurrentHp(current: number, gain: number, nextMax: number, bonusMax = 0): number {
  return Math.max(current, Math.min(current + gain, nextMax + bonusMax))
}

/** How many ASI points are spent. */
export const asiUsed = (alloc: LevelUpChoices['asiAlloc']) =>
  ABILS.reduce((n, k) => n + (alloc[k] ?? 0), 0)

/**
 * One patch for the whole advancement.
 *
 * `row` is passed again rather than captured in the plan because the DM may have
 * spent five minutes in the overlay while realtime moved the row underneath —
 * spreading the CURRENT sections is what keeps a level-up from reverting an HP
 * change made while it was open.
 */
export function levelUpPatch(
  row: CharacterRow,
  plan: LevelUpPlan,
  choices: LevelUpChoices,
  shardTrees: Record<string, ShardTree> = {},
): CharacterUpdate {
  const sheet = row.sheet ?? {}
  const gain = hpGainOf(plan, choices.die)

  // HP. The BASE max is what is written — never an effectiveSheet value, which
  // carries shard/gear bonuses and would bake them into canon. Current rises by
  // the same amount (levelling does not heal) but is clamped to the new
  // EFFECTIVE ceiling, so a character sitting at a shard-boosted maximum does
  // not drift further above it.
  const hp = (sheet.hp ?? { current: 0, max: 0 }) as HP
  const baseMax = hp.max ?? 0
  const bonusMax = (effectiveSheet(row, shardTrees).hp?.max ?? baseMax) - baseMax
  const nextMax = baseMax + gain
  const nextCurrent = nextCurrentHp(hp.current ?? 0, gain, nextMax, bonusMax)

  // Hit dice. `max` IS the level (assignClass says the same), so a stale seeded
  // value is corrected rather than incremented. `current` gains one die and
  // keeps whatever was already spent spent.
  const hd = sheet.hitDice ?? { current: plan.fromLevel, max: plan.fromLevel, die: `d${plan.hitDie}` }
  const nextHitDice = {
    die: hd.die || `d${plan.hitDie}`,
    max: plan.toLevel,
    current: Math.min((hd.current ?? 0) + 1, plan.toLevel),
  }

  // Abilities — the ASI writes the BASE score, the same one the Ability Scores
  // card edits. A racial/feature "+2 DEX" is a graph boost layered on read, and
  // stays that way.
  let nextAbilities = sheet.abilities
  const bumped = ABILS.filter(k => (choices.asiAlloc[k] ?? 0) > 0)
  if (bumped.length && nextAbilities) {
    const next = { ...nextAbilities }
    for (const k of bumped) next[k] = Math.min(20, next[k] + (choices.asiAlloc[k] ?? 0))
    nextAbilities = next
  }

  // Features: the checked offers, plus a feat if one was taken.
  const keep = new Set(choices.featureIds)
  const grants: Feature[] = plan.offers
    .filter(o => keep.has(o.id))
    .map(o => ({ ...o.data, id: o.id, feature_id: o.featureId, source: o.source, level: plan.toLevel }))
  if (choices.feat) grants.push({ ...featureSnapshot(choices.feat), kind: 'levelup', level: plan.toLevel })

  const nextSheet = {
    ...sheet,
    hp: { ...hp, current: nextCurrent, max: nextMax },
    hitDice: nextHitDice,
    ...(nextAbilities ? { abilities: nextAbilities } : {}),
    ...(plan.profWritable ? { proficiencyBonus: plan.profTo } : {}),
    ...(grants.length ? { features: [...(sheet.features ?? []), ...grants] } : {}),
  }

  // Spell slots. Pact Magic derives BOTH its count and its level from character
  // level on read (lib/spells.ts), so there is nothing to write for a warlock —
  // writing a nine-entry ladder would be the crippled table the design rejects.
  const sb = row.spellbook ?? {}
  const writeSlots = plan.caster !== 'none' && plan.caster !== 'pact'
  const prev = new Map((sb.slots ?? []).map(s => [s.level, s]))
  const slots: SpellSlot[] = plan.slotsTo.map((total, i) => ({
    level: i + 1,
    total,
    expended: Math.min(prev.get(i + 1)?.expended ?? 0, total),
  }))

  const spellbookPatch = {
    ...(writeSlots ? { slots } : {}),
    ...(plan.castWritable && plan.castTo ? { saveDC: plan.castTo.saveDC, attackBonus: plan.castTo.attackBonus } : {}),
  }

  return {
    identity: { ...(row.identity ?? {}), level: plan.toLevel },
    sheet: nextSheet,
    ...(Object.keys(spellbookPatch).length ? { spellbook: { ...sb, ...spellbookPatch } } : {}),
  }
}
