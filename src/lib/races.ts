/**
 * What a race decides, and how it reaches a character.
 *
 * The class's twin (lib/classes.ts), and it shares that file's two rules:
 *
 *  - the race's own `vars` and `graph` ride onto the sheet as ONE carrier
 *    feature, because `activeSources` already handles features and adding a
 *    fifth source kind to the engine would buy nothing;
 *  - anything the PLAYER chooses (skills, languages) is PARKED rather than
 *    picked for them.
 *
 * THE PREFIX IS LOAD-BEARING. A class clears its old grants by dropping every
 * feature whose id starts with `cls:`; a race uses `race:`. Sharing one prefix
 * would make assigning a class silently delete the character's racial features,
 * and the two assigns are done minutes apart on a fresh character.
 */
import { characterVars } from './graph.ts'
import { gateOpen } from './classes.ts'
import type {
  CatalogFeatureData, CharacterRow, CharacterUpdate, Feature, PendingSkills,
  Proficiencies, RaceDef, ShardTree,
} from './database.types.ts'

/** Every feature a race put on the character wears this prefix, so a second
 *  assign REPLACES rather than duplicating, and switching race clears the old
 *  one's grants. Deliberately distinct from lib/classes.ts CLASS_GRANT_PREFIX. */
export const RACE_GRANT_PREFIX = 'race:'

export type RaceAssignResult = {
  patch: CharacterUpdate
  granted: string[]
  pending: { name: string; when: string }[]
  /** How many skills the player is being asked to choose. */
  skillPicks: number
  /** How many extra languages the player still picks. */
  languagePicks: number
}

/** Merge only the keys the race actually states, so a class's armour training
 *  and a race's tool training coexist instead of the later assign winning. */
function mergeProficiencies(base: Proficiencies, add: Proficiencies): Proficiencies {
  const out: Proficiencies = { ...base }
  for (const k of Object.keys(add) as (keyof Proficiencies)[]) {
    const v = add[k]
    if (v && v.length) out[k] = v
  }
  return out
}

/** Languages are UNIONED, never replaced: a background may have granted one
 *  before the race did, and re-assigning must not drop it. */
function mergeLanguages(base: string[] | undefined, add: string[]): string[] {
  return [...new Set([...(base ?? []), ...add])]
}

/**
 * Stamp a race onto a character.
 *
 * Numbers are NOT written here. A race's +2 DEX, its speed and its darkvision
 * are `boost` rules in `cls.graph`, which travel on the carrier feature and are
 * layered by effectiveSheet — so changing race gives the points back, which a
 * written score never could.
 */
export function assignRace(
  character: CharacterRow,
  raceId: string,
  race: RaceDef,
  featureData: Map<string, CatalogFeatureData>,
  shardTrees: Record<string, ShardTree> = {},
  /** The subrace, if one was chosen. Applied in the SAME patch rather than a
   *  second write: a subrace is picked at level 1 alongside the race, with the
   *  DM right there, so it is a dropdown on one action — not a parked question
   *  like the class path, which is taken levels later. */
  sub?: { id: string; data: RaceDef },
): RaceAssignResult {
  const sheet = character.sheet ?? {}

  // The gate scope is the character's own, overlaid with this race's stored-var
  // initials — at assign time the race's vars are not on the sheet yet.
  const scope = { ...characterVars(character, shardTrees).scope }
  for (const v of race.vars ?? []) {
    if (v.kind === 'derived' || !v.name) continue
    if (!(v.name in scope)) scope[v.name] = v.initial ?? (v.type === 'bool' ? false : 0)
  }

  const carrier: Feature = {
    id: `${RACE_GRANT_PREFIX}${raceId}`,
    name: race.name,
    category: 'racial',
    source: race.name,
    icon: race.icon,
    color: race.color,
    light_description: race.desc,
    tags: race.tags,
    vars: race.vars,
    graph: race.graph,
  }

  const granted: string[] = []
  const pending: { name: string; when: string }[] = []
  const grants: Feature[] = []
  for (const ref of race.features ?? []) {
    const d = featureData.get(ref.feature_id)
    if (!d) continue
    if (!gateOpen(ref.when, scope)) {
      pending.push({ name: d.name, when: ref.when ?? '' })
      continue
    }
    granted.push(d.name)
    grants.push({
      ...d,
      id: `${RACE_GRANT_PREFIX}${raceId}:${ref.feature_id}`,
      feature_id: ref.feature_id,
      category: 'racial',
      source: race.name,
    })
  }

  /* The subrace's own carrier and grants, resolved the same way. Both wear the
     `race:` prefix, so re-assigning the race clears the subrace too — which is
     right: a subrace belongs to its parent and cannot outlive it. */
  const subFeatures: Feature[] = []
  if (sub) {
    subFeatures.push({
      id: `${RACE_GRANT_PREFIX}${sub.id}`,
      name: sub.data.name,
      category: 'racial',
      source: sub.data.name,
      icon: sub.data.icon,
      color: sub.data.color,
      light_description: sub.data.desc,
      tags: sub.data.tags,
      vars: sub.data.vars,
      graph: sub.data.graph,
    })
    for (const ref of sub.data.features ?? []) {
      const d = featureData.get(ref.feature_id)
      if (!d) continue
      if (!gateOpen(ref.when, scope)) { pending.push({ name: d.name, when: ref.when ?? '' }); continue }
      granted.push(d.name)
      subFeatures.push({
        ...d,
        id: `${RACE_GRANT_PREFIX}${sub.id}:${ref.feature_id}`,
        feature_id: ref.feature_id,
        category: 'racial',
        source: sub.data.name,
      })
    }
  }

  const kept = (sheet.features ?? []).filter(f => !f.id?.startsWith(RACE_GRANT_PREFIX))

  const skillPicks = (race.skillChoices ?? []).length ? (race.skillChooseN ?? 0) : 0
  const pendingSkills: PendingSkills | undefined = skillPicks > 0
    ? { classId: raceId, className: race.name, from: race.skillChoices, count: race.skillChooseN }
    : undefined

  return {
    granted,
    pending,
    skillPicks,
    languagePicks: race.languageChooseN ?? 0,
    patch: {
      identity: {
        ...(character.identity ?? {}),
        race: race.name,
        // Absent, not stale: switching to a race with no subrace must clear it.
        subrace: sub?.data.name,
      },
      sheet: {
        ...sheet,
        proficiencies: {
          ...mergeProficiencies(
            mergeProficiencies(sheet.proficiencies ?? {}, race.proficiencies ?? {}),
            sub?.data.proficiencies ?? {},
          ),
          languages: mergeLanguages(
            mergeLanguages(sheet.proficiencies?.languages, race.languages ?? []),
            sub?.data.languages ?? [],
          ),
        },
        features: [carrier, ...grants, ...subFeatures, ...kept],
        // A race and a class both park skill picks. Whichever assigns last owns
        // the prompt — the alternative is two prompts fighting for one slot, and
        // the player answering the wrong one.
        ...(pendingSkills ? { pendingSkills } : {}),
      },
    },
  }
}
