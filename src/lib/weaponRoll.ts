/**
 * A weapon swing, as a function.
 *
 * It lived inside the Equipment screen, which meant a swing could only happen
 * while that screen was open. Foundry can now ask for one — a macro on the
 * hotbar, so the map and the codex stop being two screens you swap between —
 * and a request that arrives while the player is reading their Spellbook still
 * has to roll.
 *
 * So the ROLL is here and the WRITING stays with the caller: this returns what
 * to log and which arms it used, and the caller composes that with the entry id
 * the log gives back. Two callers, one set of dice, and no way for the hotbar
 * to roll something subtly different from the button.
 */

import type {
  CharacterRow, CharacterSheet, EquippedGear, EquippedWeapon, InventoryItem,
} from './database.types.ts'
import { containerContents } from './equip.ts'
import { PERSON } from './placement.ts'
import { gid, resolve, type GraphContext } from './graph.ts'
import { armsSpentBy } from './graphState.ts'
import { handLabel, isRanged, masteryActive, masteryOf, rollWeaponAttack, weaponAbilityKey } from './weapons.ts'
import type { RollEntry } from './rolls.tsx'
import type { FoundryTarget } from './target.ts'
import { ammoBonusOf } from './ammo.ts'

/** What the log is handed. The id and timestamp are the log's to mint. */
export type NewRoll = Omit<RollEntry, 'id' | 'at'>

export type WeaponRollOut = {
  /** The roll to log — present even when it is a refusal, because a refusal is
   *  still something the player pressed and must see an answer to. */
  entry: NewRoll
  /** Armed modifiers this swing consumed. Empty on a refusal: a bow with no
   *  arrows has not attacked, so it spends nothing. */
  arms: string[]
  /** The inventory after a shot, when one was loosed. Absent = nothing moved. */
  inventory?: InventoryItem[]
  /** False when no dice were thrown, so the caller writes nothing either. */
  rolled: boolean
}

/** Ammunition within reach: the quiver first, then anything loose on the
 *  person. Shared, so the hotbar draws from the same quiver the screen does. */
export function ammoStacksFor(character: CharacterRow): InventoryItem[] {
  const gear = (character.equipped ?? {}) as EquippedGear
  const inventory = (character.inventory ?? []) as InventoryItem[]
  const quiver = gear.containers?.quiver
  return [
    ...containerContents(quiver?.id, inventory),
    ...inventory.filter(i => i.containerId === PERSON && i.category === 'ammo'),
  ]
}

export function rollWeapon(args: {
  character: CharacterRow
  weapon: EquippedWeapon
  /** The DERIVED sheet — the roll reads abilities and proficiency off it. */
  sheet: CharacterSheet
  graph: GraphContext
  /** The stack to spend. Null for a melee weapon, and null for a bow with an
   *  empty quiver, which is the refusal below. */
  ammo: InventoryItem | null
  target: FoundryTarget | null
}): WeaponRollOut {
  const { character, weapon, sheet, graph, ammo, target } = args

  // A bow with an empty quiver and empty pockets has nothing to loose. Refuse
  // rather than roll — the alternative silently produces a damage number the
  // player has no way to deliver.
  if (isRanged(weapon) && !ammo) {
    return {
      rolled: false,
      arms: [],
      entry: {
        kind: 'custom', title: weapon.name, subtitle: 'No ammunition',
        icon: weapon.icon ?? 'fa-bullseye',
        lines: [{ label: 'Cannot fire', total: '—', breakdown: 'Nothing in the quiver or on person' }],
      },
    }
  }
  const stack = isRanged(weapon) ? ammo : null

  // Two resolutions, because a feature can target one without the other:
  // "advantage on attacks with fire weapons" is not "+2 fire damage". The
  // subject and its tags are the same for both; only the roll kind differs.
  const subject = gid('weapon', weapon)
  const tags = weapon.tags
  // The sub NARROWS the kind: `roll:damage` still matches this, and
  // `roll:damage.melee` matches only a melee weapon.
  const sub = isRanged(weapon) ? 'ranged' : 'melee'
  /* Which ability this swing actually used — the SAME answer weaponAbilityKey
     gives the attack bonus, so `roll:attack.str` and the +STR on the sheet can
     never disagree about what a finesse weapon is being swung with. */
  const ability = weaponAbilityKey(weapon, sheet)
  const targetAc = target?.ac
  /* PROFICIENT, ALWAYS — the same assumption the whole weapon model already
     makes, stated here so the graph's `proficient` agrees with the PROF term in
     the breakdown rather than quietly contradicting it. */
  const atkRes = resolve(graph, { kind: 'attack', subject, sub, tags, ability, proficient: true, targetAc })
  /* THE DAMAGE RESOLUTION IS BUILT INSIDE THE ROLL, once the d20 is known: an
     on-hit contribution reads `hit`, and before the die is thrown there is no
     such fact. Captured on the way past because its notes and problems are
     still reported below. */
  let dmgRes: ReturnType<typeof resolve> | undefined

  // `riders` comes back ANNOTATED — each contribution carrying the faces it
  // rolled — so the panel shows "1d6 → +4" rather than a promise.
  const { attack: atk, damage, riders, hit } = rollWeaponAttack(weapon, sheet, ammoBonusOf(stack), {
    attack: atkRes,
    damage: h => (dmgRes = resolve(graph, { kind: 'damage', subject, sub, tags, targetAc, hit: h })),
  }, targetAc)

  return {
    rolled: true,
    arms: armsSpentBy(riders.attack, riders.damage),
    ...(stack ? { inventory: spentAmmo(character, stack) } : {}),
    entry: {
      kind: 'weapon',
      title: weapon.name,
      subtitle: stack
        ? `${handLabel(weapon.hand)} · ${stack.name}`
        : `${handLabel(weapon.hand)} · Attack`,
      icon: weapon.icon ?? 'fa-khanda',
      // What the roll was ABOUT, so the panel can open its catalog entry.
      subject: weapon.id ? { kind: 'weapon' as const, id: weapon.id } : undefined,
      attack: atk,
      damage,
      /* WHO IT WAS AGAINST. The verdict, never the AC: the number is the DM's
         to reveal and the player only needs to know whether it landed. */
      ...(target ? { target: { token: target.token, name: target.name, hit } } : {}),
      // Grouped, not concatenated: a rider on the attack and one on the damage
      // are different statements, and a flat list cannot tell them apart.
      riderGroups: [
        { label: 'Attack', riders: riders.attack },
        { label: 'Damage', riders: riders.damage },
      ].filter(g => g.riders.length),
      /* THE MASTERY RULE, AT THE MOMENT IT APPLIES. Seven of the eight are
         things only the player can resolve — Graze wants to know you missed,
         Cleave wants a second creature — so the app's job is to put the
         sentence in front of them on the swing rather than to pretend it can
         adjudicate it. Only while the mastery is one of theirs.
         Vex is deliberately NOT armed automatically: "advantage on your next
         attack against THAT SAME creature" needs a target identity that,
         even now Foundry supplies one, this roll does not persist. */
      notes: [
        ...(masteryActive(weapon, sheet.proficiencies?.masteries)
          ? [`**${masteryOf(weapon)!.name}.** ${masteryOf(weapon)!.rule}`]
          : []),
        ...atkRes.notes, ...(dmgRes?.notes ?? []),
      ],
      problems: [...atkRes.problems, ...(dmgRes?.problems ?? [])],
    },
  }
}

/** The quiver after a shot: decremented, or gone at zero. Derived from
 *  contents, so there is no separate ammo counter to drift. */
function spentAmmo(character: CharacterRow, stack: InventoryItem): InventoryItem[] {
  const inventory = (character.inventory ?? []) as InventoryItem[]
  const left = (stack.qty ?? 1) - 1
  return left > 0
    ? inventory.map(i => (i.id === stack.id ? { ...i, qty: left } : i))
    : inventory.filter(i => i.id !== stack.id)
}
