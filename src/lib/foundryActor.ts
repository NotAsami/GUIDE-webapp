/**
 * The codex character → a dnd5e Actor document.
 *
 * DERIVED VALUES ONLY. Everything here comes off `effectiveSheet`, never the raw
 * sheet: worn armour, slotted shards and granted boosts are what the numbers on
 * the token have to agree with, and reading `character.sheet` directly would
 * export the pre-effect version of every one of them.
 *
 * THE FOUNDRY ACTOR IS A MIRROR. `sheet.hp.current` stays the one source of
 * truth for hit points (CANON); this exists so hooks have an actor to fire on
 * and a token to put on a scene. Nothing reads HP back from Foundry.
 *
 * The arithmetic lives here, in tested TypeScript, rather than in the Foundry
 * module — that end only calls Actor.create/update with what this returns.
 */

import type { CharacterRow, ShardTree } from './database.types.ts'
import { effectiveSheet } from './effects.ts'
import type { FoundryActorData } from './foundry.ts'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

export function toFoundryActor(character: CharacterRow, shardTrees: Record<string, ShardTree> = {}): FoundryActorData {
  const sheet = effectiveSheet(character, shardTrees)
  const id = character.identity ?? {}
  const level = id.level ?? 1
  const hd = character.sheet?.hitDice
  const hitDie = hd?.die ?? 'd8'

  const abilities: Record<string, { value: number }> = {}
  for (const k of ABILITIES) abilities[k] = { value: sheet.abilities?.[k] ?? 10 }

  return {
    name: character.name,
    type: 'character',
    ...(id.portrait ? { img: id.portrait } : {}),
    system: {
      abilities,
      attributes: {
        hp: { value: sheet.hp?.current ?? 0, max: sheet.hp?.max ?? 0, temp: sheet.hp?.temp ?? 0 },
        /* FLAT, because the codex already decided it. `armorClass()` reads the
           worn gear, the unarmored rules and every +1 cloak; letting dnd5e
           recompute from an actor that has none of those items would show a
           different number on the token than the sheet does. */
        ac: { calc: 'flat', flat: sheet.ac ?? 10 },
        movement: { walk: sheet.speed ?? 30 },
        senses: { darkvision: sheet.senses?.darkvision ?? 0 },
      },
    },
    /* ONE CLASS ITEM, and it is not optional: dnd5e derives character level and
       proficiency bonus from class items. An actor without one is level 0 with
       PB +2, so every Foundry-side roll would be quietly wrong. */
    items: [{
      name: id.class ?? 'Adventurer',
      type: 'class',
      system: {
        levels: level,
        /* `hd.denomination` is a string like "d10" (dnd5e validates /d\d+/), and
           SPENT is what the sheet's x/y actually counts — the total comes from
           class levels, so sending only the die showed every character with a
           full pool however many they had burned. Clamped to the level because
           the codex's own hitDice.max may disagree with it, and a pool of −2
           is worse than a rounded one. */
        hd: {
          denomination: hitDie,
          spent: Math.min(level, Math.max(0, (hd?.max ?? 0) - (hd?.current ?? hd?.max ?? 0))),
        },
      },
    }],
    prototypeToken: {
      name: character.name,
      actorLink: true,
      disposition: 1,
      sight: { enabled: true },
    },
  }
}
