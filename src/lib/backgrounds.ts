/**
 * What a background decides, and how it reaches a character.
 *
 * The third sibling of lib/classes.ts and lib/races.ts, and it keeps their two
 * rules: the background's own `vars` and `graph` ride onto the sheet as ONE
 * carrier feature, and anything the PLAYER chooses is parked rather than picked
 * for them.
 *
 * THE PREFIX IS LOAD-BEARING, same as the other two. `bg:` is distinct from
 * `cls:` and `race:` so that re-assigning a background clears only its own
 * grants — sharing a prefix would make picking a background silently delete the
 * character's racial features.
 *
 * NUMBERS ARE NOT WRITTEN HERE. `BackgroundDef.abilityOptions` is display and
 * authoring only; the actual increase is a `boost` in `graph` riding the
 * carrier, because a written score could not be un-written when the background
 * changes. The type's own comment says so and this is the code that obeys it.
 */
import { gateOpen, mergeProficiencies } from './classes.ts'
import { characterVars } from './graph.ts'
import { skillKey } from './dnd.ts'
import { grantKitItems, snapshotKit } from './kit.ts'
import type {
  BackgroundDef, CatalogFeatureData, CatalogItemData, CharacterRow, CharacterUpdate,
  ClassDef, EquippedGear, Feature, InventoryItem, Json, PendingSkills, ShardTree,
} from './database.types.ts'

/** Every feature a background put on the character wears this prefix. */
export const BACKGROUND_GRANT_PREFIX = 'bg:'

export type BackgroundAssignResult = {
  patch: CharacterUpdate
  /** Feature names actually granted, for the console's activity log. */
  granted: string[]
  /** Referenced features whose gate is not open yet, with the gate text. */
  pending: { name: string; when: string }[]
  /** Skill NAMES newly marked proficient. */
  skillsGranted: string[]
  /** Authored skills that match nothing in lib/dnd.ts SKILLS. Surfaced, never
   *  dropped quietly — see `skillKey`. */
  unknownSkills: string[]
  /** How many further skills the player is being asked to choose. */
  skillPicks: number
  /** Kit items granted outright. */
  kitGranted: number
  /** Kit CHOICES this assign could not park, because `sheet.pendingKit` holds
   *  one slot and a class kit is already waiting in it. Reported so the DM can
   *  hand them over instead of the background's gear vanishing. */
  kitChoicesSkipped: number
}

/**
 * Stamp a background onto a character.
 *
 * Its two named skills are granted OUTRIGHT (the SRD names them; there is no
 * question to ask), unioned with whatever the character already has so a class
 * pick is never clobbered. `skillChooseN` — if an author sets one — is parked
 * the same way a class or race parks it.
 */
export function assignBackground(
  character: CharacterRow,
  bgId: string,
  bg: BackgroundDef,
  featureData: Map<string, CatalogFeatureData>,
  itemData: Map<string, CatalogItemData> = new Map(),
  shardTrees: Record<string, ShardTree> = {},
): BackgroundAssignResult {
  const sheet = character.sheet ?? {}

  // The gate scope is the character's own, overlaid with this background's
  // stored-var initials — at assign time its vars are not on the sheet yet.
  const scope = { ...characterVars(character, shardTrees).scope }
  for (const v of bg.vars ?? []) {
    if (v.kind === 'derived' || !v.name) continue
    if (!(v.name in scope)) scope[v.name] = v.initial ?? (v.type === 'bool' ? false : 0)
  }

  const mine = `${BACKGROUND_GRANT_PREFIX}${bgId}`
  const carrier: Feature = {
    id: mine,
    name: bg.name,
    category: 'background',
    source: bg.name,
    icon: bg.icon,
    light_description: bg.desc,
    tags: bg.tags,
    vars: bg.vars,
    graph: bg.graph,
  }

  const granted: string[] = []
  const pending: { name: string; when: string }[] = []
  const grants: Feature[] = []
  for (const ref of bg.features ?? []) {
    const d = featureData.get(ref.feature_id)
    if (!d) continue
    if (!gateOpen(ref.when, scope)) { pending.push({ name: d.name, when: ref.when ?? '' }); continue }
    granted.push(d.name)
    grants.push({
      ...d,
      id: `${mine}:${ref.feature_id}`,
      feature_id: ref.feature_id,
      source: bg.name,
    })
  }

  const kept = (sheet.features ?? []).filter(f => !f.id?.startsWith(BACKGROUND_GRANT_PREFIX))

  /* SKILLS ARE NORMALISED, not copied. The SRD background import stored display
     names ("Sleight of Hand") where the sheet keys off `sleightOfHand`, so a
     straight copy marks the character proficient in a skill nothing reads. */
  const have = new Set(sheet.skillProficiencies ?? [])
  const skillsGranted: string[] = []
  const unknownSkills: string[] = []
  for (const raw of bg.skills ?? []) {
    const key = skillKey(raw)
    if (!key) { unknownSkills.push(raw); continue }
    if (have.has(key)) continue
    have.add(key)
    skillsGranted.push(raw)
  }

  const skillPicks = (bg.skillChooseN ?? 0) > 0 ? (bg.skillChooseN ?? 0) : 0
  const pendingSkills: PendingSkills | undefined = skillPicks > 0
    ? { classId: bgId, className: bg.name, from: bg.skills ?? [], count: skillPicks }
    : undefined

  /* Equipment reuses the class kit machinery rather than a second one — a
     background's "choose A or B" is structurally the same object. Only the
     settled half is applied: `sheet.pendingKit` is a single slot, so parking a
     second prompt would silently overwrite an unanswered class kit. */
  const { fixed, kit } = snapshotKit(bgId, { name: bg.name, startingEquipment: bg.equipment ?? [] } as ClassDef, itemData)
  const gear = (character.equipped ?? {}) as EquippedGear
  const inventory = ((character.inventory as unknown as InventoryItem[]) ?? [])
  const nextInventory = fixed.length ? grantKitItems(fixed, gear, inventory) : null

  return {
    granted,
    pending,
    skillsGranted,
    unknownSkills,
    skillPicks,
    kitGranted: fixed.length,
    kitChoicesSkipped: kit?.choices.length ?? 0,
    patch: {
      ...(nextInventory ? { inventory: nextInventory as unknown as Json[] } : {}),
      identity: { ...(character.identity ?? {}), background: bg.name },
      sheet: {
        ...sheet,
        proficiencies: mergeProficiencies(sheet.proficiencies ?? {}, bg.proficiencies ?? {}),
        ...(skillsGranted.length ? { skillProficiencies: [...have] } : {}),
        features: [carrier, ...grants, ...kept],
        ...(pendingSkills ? { pendingSkills } : {}),
      },
    },
  }
}
