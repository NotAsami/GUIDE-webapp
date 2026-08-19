/**
 * What a class decides, and how it reaches a character.
 *
 * Three jobs, all pure so they can be tested without a database:
 *
 *  1. `casterSlots` — the spell-slot progression, DERIVED. A class row stores a
 *     caster TYPE, never a table; see the note in database.types.ts for why.
 *  2. `gateLevel` — reads the level floor out of a feature reference's `when`,
 *     which is what lets the editor group the feature list into a progression
 *     ladder instead of carrying a twenty-row grid beside it.
 *  3. `assignClass` — the snapshot boundary. A class is a template; this is the
 *     one place it becomes state on a character.
 */
import { evalExpr, type ExprScope } from './expr.ts'
import { pactSlotCount, pactSlotLevel } from './spells.ts'
import { characterVars } from './graph.ts'
import { abilities, abilityMod, proficiency } from './dnd.ts'
import { grantKitItems, snapshotKit } from './kit.ts'
import type {
  CatalogFeatureData, CatalogItemData, CharacterRow, CharacterUpdate, ClassCasterType,
  ClassDef, EquippedGear, Feature, InventoryItem, Json, PendingPath, PendingPathOption,
  Proficiencies, ShardTree, SpellSlot,
} from './database.types.ts'

/** The SRD full-caster progression: rows are character level 1..20, columns are
 *  spell level 1..9. Index 0 of the outer array is level 1 — there is no level-0
 *  row, unlike GraphEffect.byLevel which pads one.
 *
 *  This is the ONLY slot table in the codebase. Half and third casters are this
 *  same table read at a different row (see casterSlots), which is the SRD's own
 *  construction rather than a shortcut. */
export const SLOT_TABLE_FULL: readonly (readonly number[])[] = [
  /* L1  */ [2, 0, 0, 0, 0, 0, 0, 0, 0],
  /* L2  */ [3, 0, 0, 0, 0, 0, 0, 0, 0],
  /* L3  */ [4, 2, 0, 0, 0, 0, 0, 0, 0],
  /* L4  */ [4, 3, 0, 0, 0, 0, 0, 0, 0],
  /* L5  */ [4, 3, 2, 0, 0, 0, 0, 0, 0],
  /* L6  */ [4, 3, 3, 0, 0, 0, 0, 0, 0],
  /* L7  */ [4, 3, 3, 1, 0, 0, 0, 0, 0],
  /* L8  */ [4, 3, 3, 2, 0, 0, 0, 0, 0],
  /* L9  */ [4, 3, 3, 3, 1, 0, 0, 0, 0],
  /* L10 */ [4, 3, 3, 3, 2, 0, 0, 0, 0],
  /* L11 */ [4, 3, 3, 3, 2, 1, 0, 0, 0],
  /* L12 */ [4, 3, 3, 3, 2, 1, 0, 0, 0],
  /* L13 */ [4, 3, 3, 3, 2, 1, 1, 0, 0],
  /* L14 */ [4, 3, 3, 3, 2, 1, 1, 0, 0],
  /* L15 */ [4, 3, 3, 3, 2, 1, 1, 1, 0],
  /* L16 */ [4, 3, 3, 3, 2, 1, 1, 1, 0],
  /* L17 */ [4, 3, 3, 3, 2, 1, 1, 1, 1],
  /* L18 */ [4, 3, 3, 3, 3, 1, 1, 1, 1],
  /* L19 */ [4, 3, 3, 3, 3, 2, 1, 1, 1],
  /* L20 */ [4, 3, 3, 3, 3, 2, 2, 1, 1],
] as const

const NO_SLOTS = [0, 0, 0, 0, 0, 0, 0, 0, 0]

/** The character level at which each caster type gets its first slot. A half
 *  caster reading row `ceil(1/2) = 1` would otherwise hand a level-1 Paladin two
 *  first-level slots it does not have. */
const FIRST_SLOT_AT: Record<ClassCasterType, number> = { none: 0, full: 1, half: 2, third: 3, pact: 1 }

/**
 * The nine slot totals this class grants at `charLevel`.
 *
 * Half and third casters ARE the full table, read at `ceil(L/2)` and `ceil(L/3)`
 * — that is how the SRD builds them, and it collapses three tables into one
 * constant. Verified against the printed rows in classes.test.ts rather than
 * trusted: Paladin 5 -> full 3, Eldritch Knight 13 -> full 5.
 *
 * Pact Magic returns zeros here on purpose. Its slots are not a ladder at all —
 * they are one level and a count, both from lib/spells.ts — so folding them into
 * a nine-entry array would be the "crippled slot table" the design rejects.
 */
export function casterSlots(caster: ClassCasterType, charLevel: number): number[] {
  if (caster === 'none' || caster === 'pact') return [...NO_SLOTS]
  if (charLevel < FIRST_SLOT_AT[caster]) return [...NO_SLOTS]
  const div = caster === 'half' ? 2 : caster === 'third' ? 3 : 1
  const row = Math.ceil(Math.min(20, Math.max(1, charLevel)) / div)
  return [...SLOT_TABLE_FULL[row - 1]]
}

/** The highest spell level a caster type ever reaches, and the character level
 *  it first reaches it at. Drives the progression fold's summary line, so a DM
 *  never has to open the grid to learn the shape. */
export function casterCap(caster: ClassCasterType): { level: number; at: number } | null {
  if (caster === 'none') return null
  if (caster === 'pact') return { level: pactSlotLevel(20), at: 9 }
  const topOf = (slots: number[]) => slots.reduce((n, v, i) => (v > 0 ? i + 1 : n), 0)
  const ceiling = topOf(casterSlots(caster, 20))
  for (let l = 1; l <= 20; l++) {
    if (topOf(casterSlots(caster, l)) === ceiling) return { level: ceiling, at: l }
  }
  return null
}

/**
 * HIT POINTS ARE NOT A SEPARATE FIELD — they fall out of the hit die.
 *
 *   Hit Points at 1st Level:      <die> + your Constitution modifier
 *   Hit Points at Higher Levels:  1d<die> (or <avg>) + your Con modifier,
 *                                 per class level after 1st
 *
 * Authoring them beside `hitDie` would be two answers to one question, and the
 * pair would disagree the first time somebody edited the die. These derive it.
 *
 * `hitDieAverage` is 5e's own "or N" shortcut for players who take the average
 * instead of rolling: d6→4, d8→5, d10→6, d12→7.
 */
export const hitDieAverage = (die: ClassDef['hitDie']): number => die / 2 + 1

/** Max HP for a character of this class at `level`, taking the average on every
 *  level after the first. A DM who rolls instead overrides it on the sheet —
 *  this is the number to START from, not a claim about what was rolled. */
export function hpForLevel(die: ClassDef['hitDie'], conMod: number, level: number): number {
  const lv = Math.max(1, level)
  return (die + conMod) + (lv - 1) * (hitDieAverage(die) + conMod)
}

/** The two spellcasting formulas a class decides, in the book's own words.
 *  Shown in the editor rather than typed: the NUMBERS need a character (their
 *  ability score, their proficiency bonus), but the FORMULA is the class's
 *  answer and belongs where the class is authored. castingNumbers computes the
 *  values at assign; this states the rule that produces them. */
export function castingRules(ability?: string): { dc: string; atk: string } {
  const ab = ability ? ability.toUpperCase() : 'your casting ability'
  return { dc: `8 + proficiency bonus + ${ab}`, atk: `proficiency bonus + ${ab}` }
}

/** The two sentences a class book prints, in its own words. One producer, so
 *  the editor readout and the assign preview cannot phrase it differently. */
export function hitPointRules(die: ClassDef['hitDie']): { first: string; higher: string } {
  return {
    first: `${die} + your Constitution modifier`,
    higher: `1d${die} (or ${hitDieAverage(die)}) + your Constitution modifier per level after 1st`,
  }
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th']
export const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`

export const CASTER_LABEL: Record<ClassCasterType, string> = {
  none: 'Not a caster', full: 'Full caster', half: 'Half caster',
  third: 'Third caster', pact: 'Pact Magic',
}

/** The one-line summary in the progression fold's header — the whole shape of
 *  the table, so the fold can stay closed.
 *
 *  Deliberately does NOT name the caster type: the select directly above the
 *  fold already says "Full caster", and repeating it here pushed the line past
 *  the header's width and truncated the part that is actually news. */
export function casterSummary(caster: ClassCasterType): string {
  if (caster === 'none') return 'No spellcasting — no slot table'
  if (caster === 'pact') return 'Up to 4 slots, all 5th level from L9 · short rest'
  const cap = casterCap(caster)
  const total = casterSlots(caster, 20).reduce((a, b) => a + b, 0)
  return `First slot L${FIRST_SLOT_AT[caster]}`
    + (cap ? ` · ${ordinal(cap.level)}-level from L${cap.at}` : '')
    + ` · ${total} at cap`
}

/**
 * The level floor a gate expression implies, or null when it has none.
 *
 * This is what turns the feature list into a progression ladder: rows group
 * under the level their own condition names, so the ladder is a VIEW of the
 * gates rather than a second copy of them. An absent `when` reads as level 1,
 * because a reference with no condition is granted from the start.
 *
 * Anything it cannot read falls to null and lands in the CONDITIONAL group with
 * its expression shown verbatim — including anything containing `!`, because
 * `!(level >= 3)` means the opposite of what the number in it says and a
 * mis-sorted row is worse than an unsorted one.
 */
export function gateLevel(when?: string): number | null {
  const src = (when ?? '').trim()
  if (!src) return 1
  if (src.includes('!')) return null
  const ge = /\blevel\s*>=\s*(\d+)/.exec(src)
  if (ge) return Math.max(1, parseInt(ge[1], 10))
  const gt = /\blevel\s*>\s*(\d+)/.exec(src)
  if (gt) return Math.max(1, parseInt(gt[1], 10) + 1)
  const eq = /\blevel\s*===?\s*(\d+)/.exec(src)
  if (eq) return Math.max(1, parseInt(eq[1], 10))
  return null
}

/** Is this gate satisfied in `scope`? A gate that does not resolve to a boolean
 *  is NOT satisfied — assigning on an unreadable condition would grant something
 *  the author did not ask for, and the DM can still grant it by hand. */
export function gateOpen(when: string | undefined, scope: ExprScope): boolean {
  if (!when?.trim()) return true
  const v = evalExpr(when, scope)
  return v?.t === 'bool' ? v.v : false
}

/** Merge only the keys the class actually states. A plain spread would blank the
 *  languages a background gave with `undefined`. */
function mergeProficiencies(base: Proficiencies, add: Proficiencies): Proficiencies {
  const out: Proficiencies = { ...base }
  for (const k of Object.keys(add) as (keyof Proficiencies)[]) {
    const v = add[k]
    if (v && v.length) out[k] = v
  }
  return out
}

/** Every feature this class put on the character wears this prefix, so a second
 *  assign REPLACES rather than duplicating, and switching class clears the old
 *  one's grants. The carrier is `cls:<classId>`, a grant is
 *  `cls:<classId>:<featureId>`. */
export const CLASS_GRANT_PREFIX = 'cls:'

/** The two spellcasting numbers a class can answer for, once it names its
 *  casting ability: DC 8 + prof + mod, attack prof + mod.
 *
 *  SEEDED AT ASSIGN, never recomputed on read. `spellbook.saveDC` stays the one
 *  source of truth — the expression engine reads `saveDc` straight off it
 *  (lib/graph.ts baseScope), and the DM can still override both in the
 *  Spellcasting card afterwards. Returns null when the sheet has no ability
 *  scores yet, because 8 + prof + abilityMod(0) is a confident wrong number
 *  rather than a missing one. */
export function castingNumbers(
  sheet: { abilities?: Record<string, number>; proficiencyBonus?: number },
  castingAbility?: string,
): { saveDC: number; attackBonus: number } | null {
  if (!castingAbility || !sheet.abilities) return null
  const score = abilities(sheet as never)[castingAbility as keyof ReturnType<typeof abilities>]
  if (typeof score !== 'number') return null
  const mod = abilityMod(score)
  const prof = proficiency(sheet as never)
  return { saveDC: 8 + prof + mod, attackBonus: prof + mod }
}

export type AssignResult = {
  patch: CharacterUpdate
  /** Feature names actually granted, for the console's activity log. */
  granted: string[]
  /** Referenced features whose gate is not open yet, with the gate text. */
  pending: { name: string; when: string }[]
  /** How many starting-kit decisions were handed to the player. */
  kitChoices: number
  /** How many kit items were granted outright (the no-choice ones). */
  kitGranted: number
  /** How many skills the player is being asked to choose. */
  skillPicks: number
  /** Max HP this class implies at the character's level, averaging every level
   *  after the first. Null when the sheet has no ability scores. */
  hpFromClass: number | null
  /** Whether the patch actually writes it — false when the sheet already has HP
   *  that a recompute would destroy. */
  hpSeeded: boolean
}

/**
 * Everything a path would put on a character — its carrier, the features whose
 * gates are open, and the caster profile it imposes.
 *
 * One producer, two consumers: `assignSubclass` writes it directly when the DM
 * picks, and `snapshotPaths` bakes it into the parked prompt when the player
 * will. Two copies of "what does this path grant" would drift the first time a
 * path gained anything.
 */
export function subclassGrants(
  character: CharacterRow,
  subId: string,
  sub: ClassDef,
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree> = {},
): { features: Feature[]; spellbook?: Partial<CharacterRow['spellbook']>; granted: string[]; pending: { name: string; when: string }[] } {
  const level = character.identity?.level ?? 1
  const sheet = character.sheet ?? {}

  const scope: ExprScope = { ...characterVars(character, shardTrees).scope }
  for (const v of sub.vars ?? []) {
    if (v.kind === 'derived' || !v.name) continue
    if (!(v.name in scope)) scope[v.name] = v.initial ?? (v.type === 'bool' ? false : 0)
  }

  const mine = `${CLASS_GRANT_PREFIX}${subId}`
  const carrier: Feature = {
    id: mine,
    name: sub.name,
    category: 'class',
    kind: 'levelup',
    source: sub.name,
    icon: sub.icon,
    color: sub.color,
    light_description: sub.desc,
    tags: sub.tags,
    vars: sub.vars,
    graph: sub.graph,
  }

  const granted: string[] = []
  const pending: { name: string; when: string }[] = []
  const grants: Feature[] = []
  for (const ref of sub.features ?? []) {
    const d = featureData.get(ref.feature_id)
    if (!d) continue
    if (!gateOpen(ref.when, scope)) { pending.push({ name: d.name, when: ref.when ?? '' }); continue }
    granted.push(d.name)
    grants.push({ ...d, id: `${mine}:${ref.feature_id}`, feature_id: ref.feature_id, source: sub.name })
  }

  if (sub.caster === 'none') return { features: [carrier, ...grants], granted, pending }

  const sb = character.spellbook ?? {}
  const cast = castingNumbers(sheet, sub.castingAbility)
  const prevSlots = new Map((sb.slots ?? []).map(x => [x.level, x]))
  const slots: SpellSlot[] = casterSlots(sub.caster, level).map((total, i) => ({
    level: i + 1, total, expended: Math.min(prevSlots.get(i + 1)?.expended ?? 0, total),
  }))

  return {
    features: [carrier, ...grants],
    granted,
    pending,
    spellbook: {
      spellcasting: true,
      ...(sub.castingAbility ? { ability: sub.castingAbility } : {}),
      ...(cast ?? {}),
      pactMagic: sub.caster === 'pact',
      ...(sub.caster === 'pact' ? {} : { slots }),
    },
  }
}

/**
 * Bake every path a class offers into a prompt the player can answer.
 *
 * Parked whatever the character's level — the card decides when to surface it,
 * which is what lets a level-3 choice appear at level 3 with no level-up hook.
 * Null when the class offers no paths, or has none authored: a prompt with an
 * empty list is worse than no prompt.
 */
export function snapshotPaths(
  character: CharacterRow,
  cls: ClassDef,
  classId: string,
  paths: { id: string; data: ClassDef }[],
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree> = {},
): PendingPath | null {
  if ((cls.subclassLevel ?? 0) <= 0 || !paths.length) return null
  const options: PendingPathOption[] = paths.map(p => {
    const g = subclassGrants(character, p.id, p.data, featureData, shardTrees)
    return {
      id: p.id,
      name: p.data.name,
      desc: p.data.desc,
      icon: p.data.icon,
      color: p.data.color,
      features: g.features,
      ...(g.spellbook ? { spellbook: g.spellbook } : {}),
    }
  })
  return {
    classId,
    className: cls.name,
    label: cls.subclassLabel || 'Path',
    level: cls.subclassLevel ?? 1,
    options,
  }
}

/**
 * Stamp a SUBCLASS onto a character, leaving its parent class untouched.
 *
 * The prefix is what keeps the two apart. A class assign clears everything
 * under `cls:`, because changing class throws the whole thing away — paths
 * included. A path assign clears only `cls:<its own id>`, because the parent's
 * carrier and granted features must survive it. Sharing one clear would make
 * picking a path delete the class that offered it.
 *
 * A path is otherwise the same object: it can grant features, declare
 * variables, contribute rules, and — the reason it is a row at all — change the
 * caster type, which is what an Eldritch Knight does to a martial class.
 */
export function assignSubclass(
  character: CharacterRow,
  subId: string,
  sub: ClassDef,
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree> = {},
): AssignResult {
  const sheet = character.sheet ?? {}
  const g = subclassGrants(character, subId, sub, featureData, shardTrees)

  // ONLY this path's own grants are cleared — everything else, the parent class
  // included, is kept.
  const mine = `${CLASS_GRANT_PREFIX}${subId}`
  const kept = (sheet.features ?? []).filter(f => !f.id?.startsWith(mine))

  return {
    granted: g.granted,
    pending: g.pending,
    // A path never carries the class's kit or its skill allowance.
    kitChoices: 0,
    kitGranted: 0,
    skillPicks: (sub.skillChoices ?? []).length ? (sub.skillChooseN ?? 0) : 0,
    hpFromClass: null,
    hpSeeded: false,
    patch: {
      identity: { ...(character.identity ?? {}), archetype: sub.name },
      sheet: { ...sheet, features: [...g.features, ...kept] },
      ...(g.spellbook ? { spellbook: { ...(character.spellbook ?? {}), ...g.spellbook } } : {}),
    },
  }
}

/**
 * Stamp a class onto a character.
 *
 * The class's own `vars` and `graph` ride onto the sheet as ONE carrier feature
 * rather than a new engine source kind. `activeSources`, `collectVars`,
 * `sourceGid` and `useCatalogNodes` all already handle features, so this needs
 * no change to graph.ts at all — and the carrier renders on the player's
 * Features screen as the class's own card, which `category: 'class'` already
 * has a filter chip for.
 *
 * `skillProficiencies` is deliberately NOT written: `skillChooseN` is the
 * player's choice, so the console surfaces the eligible list and the DM ticks
 * them in the Proficiencies card.
 */
export function assignClass(
  character: CharacterRow,
  classId: string,
  cls: ClassDef,
  featureData: Map<string, CatalogFeatureData>,
  itemData: Map<string, CatalogItemData> = new Map(),
  shardTrees: Record<string, ShardTree> = {},
  /** The class's own paths, so the subclass choice can be parked for the player
   *  in the same write. Optional: a class with none passes nothing. */
  paths: { id: string; data: ClassDef }[] = [],
): AssignResult {
  const level = character.identity?.level ?? 1
  const sheet = character.sheet ?? {}

  // The gate scope is the character's real one, overlaid with this class's own
  // stored-variable initials — at assign time the class's vars are not on the
  // sheet yet, so a gate reading one would otherwise never resolve.
  const scope: ExprScope = { ...characterVars(character, shardTrees).scope }
  for (const v of cls.vars ?? []) {
    if (v.kind === 'derived' || !v.name) continue
    if (!(v.name in scope)) scope[v.name] = v.initial ?? (v.type === 'bool' ? false : 0)
  }

  const carrier: Feature = {
    id: `${CLASS_GRANT_PREFIX}${classId}`,
    name: cls.name,
    category: 'class',
    kind: 'levelup',
    source: cls.name,
    icon: cls.icon,
    color: cls.color,
    light_description: cls.desc,
    tags: cls.tags,
    vars: cls.vars,
    graph: cls.graph,
  }

  const granted: string[] = []
  const pending: { name: string; when: string }[] = []
  const grants: Feature[] = []
  for (const ref of cls.features ?? []) {
    const d = featureData.get(ref.feature_id)
    if (!d) continue
    if (!gateOpen(ref.when, scope)) {
      pending.push({ name: d.name, when: ref.when ?? '' })
      continue
    }
    granted.push(d.name)
    grants.push({
      ...d,
      id: `${CLASS_GRANT_PREFIX}${classId}:${ref.feature_id}`,
      feature_id: ref.feature_id,
      source: cls.name,
    })
  }

  const kept = (sheet.features ?? []).filter(f => !f.id?.startsWith(CLASS_GRANT_PREFIX))

  // The kit splits in two. Anything with no decision attached is granted right
  // here — a question with one answer is not a question. The real either/ors
  // are PARKED on the sheet: which one a character walks in with is the
  // player's answer, and item_catalog is DM-only, so the data has to be
  // resolved here, where the catalog is readable.
  /* HP is seeded ONLY on a sheet that has none yet.
     Assigning a class to a character who is already levelled would otherwise
     silently rewrite their max HP from the average — throwing away whatever was
     actually rolled at every level they have played. A fresh character has
     nothing to lose, so that case is filled in; the console reports both
     numbers either way and the DM sets it by hand in Vitals. */
  const conMod = sheet.abilities ? abilityMod(abilities(sheet).con) : 0
  const hpFromClass = sheet.abilities ? hpForLevel(cls.hitDie, conMod, level) : null
  const hasHp = (sheet.hp?.max ?? 0) > 0
  const seedHp = !hasHp && hpFromClass != null

  const { fixed, kit } = snapshotKit(classId, cls, itemData)
  // Parked whatever the level — the Codex card surfaces it once the character
  // reaches cls.subclassLevel, which is what saves a level-up hook.
  const pendingPath = snapshotPaths(character, cls, classId, paths, featureData, shardTrees)
  const gear = (character.equipped ?? {}) as EquippedGear
  const inventory = ((character.inventory as unknown as InventoryItem[]) ?? [])
  const nextInventory = fixed.length ? grantKitItems(fixed, gear, inventory) : null

  const sb = character.spellbook ?? {}
  const cast = castingNumbers(sheet, cls.castingAbility)
  const prevSlots = new Map((sb.slots ?? []).map(s => [s.level, s]))
  const slots: SpellSlot[] = casterSlots(cls.caster, level).map((total, i) => ({
    level: i + 1,
    total,
    expended: Math.min(prevSlots.get(i + 1)?.expended ?? 0, total),
  }))

  return {
    granted,
    pending,
    kitChoices: kit?.choices.length ?? 0,
    kitGranted: fixed.length,
    skillPicks: (cls.skillChoices ?? []).length ? (cls.skillChooseN ?? 0) : 0,
    hpFromClass,
    hpSeeded: seedHp,
    patch: {
      ...(nextInventory ? { inventory: nextInventory as unknown as Json[] } : {}),
      identity: { ...(character.identity ?? {}), class: cls.name },
      sheet: {
        ...sheet,
        hitDice: { current: sheet.hitDice?.current ?? level, max: level, die: `d${cls.hitDie}` },
        ...(seedHp && hpFromClass != null
          ? { hp: { ...(sheet.hp ?? { current: 0, max: 0 }), current: hpFromClass, max: hpFromClass } }
          : {}),
        saveProficiencies: cls.saveProficiencies,
        proficiencies: mergeProficiencies(sheet.proficiencies ?? {}, cls.proficiencies ?? {}),
        features: [carrier, ...grants, ...kept],
        // Absent rather than an empty shell: a prompt with nothing in it is
        // worse than no prompt.
        ...(kit ? { pendingKit: kit } : { pendingKit: undefined }),
        // Skill proficiencies are the PLAYER's pick too, so they are parked the
        // same way rather than written here. The DM can still tick them by hand
        // in the Proficiencies card, which clears the prompt by satisfying it.
        ...(pendingPath ? { pendingPath } : { pendingPath: undefined }),
        ...((cls.skillChooseN ?? 0) > 0 && (cls.skillChoices ?? []).length
          ? { pendingSkills: { classId, className: cls.name, from: cls.skillChoices, count: cls.skillChooseN } }
          : { pendingSkills: undefined }),
      },
      spellbook: cls.caster === 'none'
        ? { ...sb, spellcasting: false }
        : {
          ...sb,
          spellcasting: true,
          class: cls.name,
          ...(cls.castingAbility ? { ability: cls.castingAbility } : {}),
          ...(cast ?? {}),
          pactMagic: cls.caster === 'pact',
          ...(cls.caster === 'pact' ? {} : { slots }),
        },
    },
  }
}

/** How many pact slots a character of this level holds, and at what level, for
 *  the editor's ladder. Re-exported so a host reads one module, not two. */
export { pactSlotCount, pactSlotLevel }
