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

import type { CharacterRow, EquippedGear, EquippedWeapon, ShardTree } from './database.types.ts'
import { effectiveSheet } from './effects.ts'
import { parseDice } from './dice.ts'
import type { FoundryActorData } from './foundry.ts'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

/** Everything this exporter creates carries the flag, and nothing else does.
 *  It is what lets the bridge update its own items and leave alone whatever the
 *  DM added to the actor by hand. */
const MANAGED = { 'guide-bridge': { managed: true } }

/**
 * An equipped weapon as a dnd5e weapon item — TO BE LOOKED AT, NOT ROLLED.
 *
 * The sheet showed a class and nothing else, so a token told you nothing about
 * what the character was holding. This fills that in, and stops there: the
 * codex's engine is what knows a swing is worth — Sanctity's Wisdom override,
 * shard bonuses, an armed Brutal Strike, every rider — and none of it exists on
 * this side. A Foundry-rolled attack would produce a plausible, wrong number,
 * which is worse than an empty sheet. The description says so on the item.
 *
 * No `properties` and no `mastery`. Both are free text on our side (see
 * masteryOf) and closed vocabularies on dnd5e's, and a guessed mapping puts
 * "Two-Handed" on a sheet as nothing at all or, worse, as the wrong id.
 */
function toWeaponItem(w: EquippedWeapon) {
  const dice = parseDice(w.damageDice ?? '')
  const tags = (w.tags ?? []).map(t => t.toLowerCase())
  const martial = tags.includes('martial')
  /* dnd5e's four kinds, and the pair we can actually answer. Melee vs ranged is
     explicit on our side; martial vs simple is a tag if the author wrote one and
     simple otherwise, which is the more forgiving way to be wrong. */
  const kind = `${martial ? 'martial' : 'simple'}${w.ranged ? 'R' : 'M'}`
  return {
    name: w.name,
    type: 'weapon',
    ...(w.icon && !w.icon.startsWith('gi:') && !w.icon.startsWith('fa-') ? { img: w.icon } : {}),
    flags: MANAGED,
    system: {
      type: { value: kind },
      /* `denomination` is the number of SIDES, not the count — d8 is 8 — and
         `types` is a set. Absent dice leave the field empty rather than
         inventing a d4. */
      ...(dice
        ? {
          damage: {
            base: {
              number: Math.abs(dice.count),
              denomination: dice.sides,
              ...(dice.mod ? { bonus: String(dice.mod) } : {}),
              types: w.type ? [w.type.toLowerCase()] : [],
            },
          },
        }
        : {}),
      /* One number, because dnd5e keeps one: it adds to attack AND damage. Ours
         are separate fields, so this takes the attack side and lets the codex
         stay the place where they can differ. */
      ...(w.effects?.attack ? { magicalBonus: String(w.effects.attack) } : {}),
      equipped: true,
      description: { value: '<p><em>Mirrored from the G.U.I.D.E. Codex. Roll it there — this sheet does not know about shards, features or armed modifiers.</em></p>' },
    },
  }
}

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
       PB +2, so every Foundry-side roll would be quietly wrong.
       The equipped weapons follow it, so a token says what it is holding. */
    items: [{
      name: id.class ?? 'Adventurer',
      type: 'class',
      flags: MANAGED,
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
    },
    ...((character.equipped as EquippedGear | undefined)?.weapons ?? []).map(toWeaponItem)],
    prototypeToken: {
      name: character.name,
      actorLink: true,
      disposition: 1,
      sight: { enabled: true },
    },
  }
}
