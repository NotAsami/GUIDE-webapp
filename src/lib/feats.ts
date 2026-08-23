/**
 * Feat prerequisites — reading the sentence a book prints, without pretending
 * it is a language.
 *
 * `Feature.prerequisite` is FREE TEXT and always was. It is display-only
 * everywhere it appears, which is honest but means the DM is the only check:
 * nothing stops a level-3 character taking a feat that says "Level 4+".
 *
 * The whole design turns on one rule:
 *
 *   A CLAUSE THIS CANNOT READ NEVER BLOCKS.
 *
 * Thirteen of the seventeen SRD feats carry a prerequisite, in four shapes, and
 * a homebrew feat may carry any sentence at all ("must have slain a dragon").
 * A parser that treated "unreadable" as "unmet" would quietly make those feats
 * ungrantable, and the DM would have no idea why. So `ok` is false only when a
 * clause was UNDERSTOOD and FAILED; anything unreadable lands in `unparsed` for
 * the UI to show as "not checked".
 *
 * The four shapes actually in the catalog:
 *
 *   Level 4+                          → character level
 *   Strength or Dexterity 13+         → any named ability, effective score
 *   Fighting Style Feature            → a feature by that name on the sheet
 *   Level 19+, Spellcasting Feature   → comma = AND, both of the above
 */
import { ABILITY_NAMES, ABILITY_ORDER } from './dnd.ts'
import { effectiveSheet } from './effects.ts'
import type { AbilityKey, CharacterRow, ShardTree } from './database.types.ts'

export type PrereqResult = {
  /** False only when a clause was read AND failed. Unreadable text is not a
   *  failure — see the module note. */
  ok: boolean
  /** Clauses checked and unmet, verbatim, so the UI can name the actual reason
   *  rather than reprinting the whole sentence. */
  unmet: string[]
  /** Clauses this could not read. Shown as "not checked", never as a block. */
  unparsed: string[]
}

const NAME_TO_ABILITY = new Map<string, AbilityKey>(
  ABILITY_ORDER.flatMap(k => [
    [ABILITY_NAMES[k].toLowerCase(), k] as const,
    [k, k] as const,
  ]),
)

/** `Level 12+`, `Level 12`, `12th level`. */
const LEVEL_RE = /^level\s+(\d+)\s*\+?$/
/** `Strength 13+`, `Strength or Dexterity 13+`, `Str/Dex 13+`. */
const ABILITY_RE = /^(.+?)\s+(\d+)\s*\+?$/
/** `Fighting Style Feature`, `Spellcasting Feature`. */
const FEATURE_RE = /^(.+?)\s+feature$/

/**
 * Is this prerequisite satisfied by this character?
 *
 * Absent or blank text is trivially satisfied — most feats have none, and an
 * empty `unmet` with `ok: true` is the right answer for them.
 */
export function prereqMet(
  prerequisite: string | undefined,
  character: CharacterRow,
  shardTrees: Record<string, ShardTree> = {},
): PrereqResult {
  const src = (prerequisite ?? '').trim()
  if (!src) return { ok: true, unmet: [], unparsed: [] }

  const level = character.identity?.level ?? 1
  // EFFECTIVE, not base: a racial +2 is a `boost` layered on read, so a
  // character whose 13 Strength comes from their race still qualifies. Reading
  // the base score here would refuse a feat the character genuinely meets.
  const scores = effectiveSheet(character, shardTrees).abilities
  const featureNames = new Set(
    (character.sheet?.features ?? []).map(f => (f.name ?? '').trim().toLowerCase()).filter(Boolean),
  )
  const casts = character.spellbook?.spellcasting === true

  const unmet: string[] = []
  const unparsed: string[] = []

  for (const raw of src.split(',')) {
    const clause = raw.trim()
    if (!clause) continue
    const lower = clause.toLowerCase()

    const lvl = LEVEL_RE.exec(lower)
    if (lvl) {
      if (level < parseInt(lvl[1], 10)) unmet.push(clause)
      continue
    }

    const feat = FEATURE_RE.exec(lower)
    if (feat) {
      const want = feat[1].trim()
      /* "Spellcasting Feature" has no feature row to find — no class in the
         catalog references one — but the app already records the fact on
         `spellbook.spellcasting`, which is what the Caster Profile card sets.
         Asking the sheet's own answer beats refusing a caster for lacking a
         feature that does not exist. */
      const has = featureNames.has(want) || (want === 'spellcasting' && casts)
      if (!has) unmet.push(clause)
      continue
    }

    const ab = ABILITY_RE.exec(lower)
    if (ab) {
      const need = parseInt(ab[2], 10)
      // `or` and `/` both separate alternatives; ANY of them satisfying is enough.
      const parts = ab[1].split(/\s+or\s+|\//).map(p => p.trim())
      const keys = parts.map(p => NAME_TO_ABILITY.get(p))
      // Every part must BE an ability, or this is not an ability clause at all
      // and guessing would be worse than admitting we cannot read it.
      if (keys.every((k): k is AbilityKey => !!k)) {
        if (!keys.some(k => (scores?.[k] ?? 0) >= need)) unmet.push(clause)
        continue
      }
    }

    unparsed.push(clause)
  }

  return { ok: unmet.length === 0, unmet, unparsed }
}

/** One line for a tooltip or a row: what is missing, or what went unchecked. */
export function prereqSummary(r: PrereqResult): string | null {
  if (r.unmet.length) return `Requires ${r.unmet.join(', ')}`
  if (r.unparsed.length) return `Not checked: ${r.unparsed.join(', ')}`
  return null
}
