/**
 * The op schema — why the feature editor is ONE form.
 *
 *   > Adding an op must not require editing the editor.
 *
 * Every field an effect shows comes from `OPS[op].fields`. A new op is an entry
 * here plus a case in lib/graph.ts; the renderer is untouched. That is the whole
 * requirement, and it is why this file has no JSX in it.
 *
 * FIELD TYPES ARE A CLOSED SET. Adding a field type is a considered change, made
 * occasionally. Building a UI to author schemas is where this stops — that is a
 * form builder, it is its own project, and it is always almost done.
 *
 * `desc`/`example` are not decoration: they are the only source for both the
 * inline per-field help and the authoring guide, so a field explains itself
 * wherever it appears.
 */
import type { GraphOp } from './database.types.ts'
/* The stat vocabulary is modEditor's, not a second list — one compiler
   serves the item rows, the shard-node rows and the boost op alike.
   No cycle: modEditor imports only database.types and dnd. */
import { MOD_STATS, SKILL_STATS } from './modEditor.ts'

export type FieldType =
  | 'formula'   // number or expression, evaluated by lib/expr.ts
  | 'number'    // a plain number — no dice, no identifiers, nothing to evaluate
  | 'text'      // player-facing prose
  | 'selector'  // a target list — thing, tag or roll kind
  | 'enum'      // one of a fixed list
  | 'boolean'   // on or off
  | 'reference' // a pick from the catalog, or from this feature's own variables
  | 'array'     // level-indexed progression: 21 slots, index 0 unused

export type OpField = {
  key: string
  type: FieldType
  label: string
  required?: boolean
  /** Lays out full-width instead of sharing a row. */
  wide?: boolean
  /** `enum` only. */
  options?: string[]
  /** `reference` only — what it picks from. */
  ref?: 'variable' | 'effect'
  desc: string
  example?: string
}

export type OpDef = {
  label: string
  /** `passive` modifies a roll; `activation` runs on a press and writes state.
   *  The palette groups them, and the two never mix in one code path — resolve()
   *  reads only passives, runActivation() only activations. */
  group: 'passive' | 'activation' | 'sheet'
  icon: string
  blurb: string
  fields: OpField[]
}

/** The SRD's thirteen. A closed list on purpose: the panel colours a damage
 *  breakdown by this string, and free text fragments — `radiant` / `Radiant` /
 *  `radient` all look identical to an author and none of them match each other.
 *  Same reasoning as normalizeTag(), applied one step earlier. */
export const DAMAGE_TYPES = [
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
  'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
] as const

/** §16. Shared by every op that can be armed — a passive roll modifier and
 *  nothing else. A note arms nothing (prose has no pending state) and the damage
 *  flags are not roll modifiers at all. */
const ONCE: OpField = {
  key: 'once', type: 'boolean', label: 'Arms once',
  desc: 'Instead of applying to every matching roll, this waits for the NEXT one. Pressing Use arms it; a chip shows on the target until the player taps to consume it. Needs a roll target — "your next attack", not "anything fiery".',
  example: 'on, with target roll:attack',
}

/** Beside ONCE, and only meaningful with it. */
const ONE_OF: OpField = {
  key: 'oneOf', type: 'boolean', label: 'One across all targets',
  desc: 'The targets share ONE bonus instead of getting one each. Peerless Skill is "an ability check or an attack roll" — one Bardic Inspiration die, offered on both, and taking it on either spends it. Leave off when the targets are genuinely separate things that all happen: "+2 to your next attack and to its damage" is two bonuses.',
  example: 'on, with targets roll:check and roll:attack',
}

const AMOUNT: OpField = {
  key: 'value', type: 'formula', label: 'Amount', required: true,
  desc: 'Number or expression contributed to every matched target. Dice are allowed and stay unrolled, so a crit can still double them.',
  example: '2 + level / 4',
}

/** Damage flags share a blurb shape: their target list IS the statement, so they
 *  declare no fields at all. */
const flag = (label: string, icon: string, blurb: string, fields: OpField[] = []): OpDef =>
  ({ label, group: 'passive', icon, blurb, fields })

export const OPS: Record<GraphOp, OpDef> = {
  add: {
    label: 'add', group: 'passive', icon: 'fa-plus',
    blurb: 'Adds a numeric contribution to every matched target. Stacks with other add nodes.',
    fields: [
      AMOUNT,
      {
        key: 'dmgType', type: 'enum', label: 'Damage type', options: [...DAMAGE_TYPES],
        desc: 'What KIND of damage this adds, on a contribution that targets a damage roll. Splits the total by type in the breakdown and colours it. Leave blank on an attack roll, or when it rides along as the weapon’s own type.',
        example: 'radiant',
      },
      ONCE,
      ONE_OF,
      {
        key: 'byLevel', type: 'array', label: 'By level', wide: true,
        desc: 'Level-indexed progression. When any slot is filled it overrides Amount. Index 0 is unused — character levels start at 1.',
        example: 'slot 1 = 2, slot 5 = 3, slot 11 = 4',
      },
    ],
  },
  boost: {
    label: 'boost', group: 'sheet', icon: 'fa-arrow-up-right-dots',
    blurb: 'Changes a number ON THE SHEET rather than on a roll — an ability score, speed, darkvision. This is what a racial +2 DEX is: it moves the score itself, so every save, skill and derived value made from it moves too. No target: it applies to whoever carries this node. Use this for what a thing IS and cannot be separated from — an elf’s Dexterity. Use an Effect (the Effects tab) for something applied to you or carried by an object, which can end: Bless, Poisoned, a gem’s enchantment.',
    fields: [
      {
        key: 'stat', type: 'enum', label: 'Stat', required: true,
        options: [...MOD_STATS, ...SKILL_STATS],
        desc: 'Which sheet value moves. The same list the item and shard-node modifier rows offer, compiled by the same function.',
        example: 'DEX',
      },
      {
        key: 'value', type: 'number', label: 'Amount', required: true,
        desc: 'How far the stat moves. A plain number, not a formula: this layers onto the sheet, which has no roll to compute against. Negative is allowed.',
        example: '2',
      },
      {
        key: 'cap', type: 'number', label: 'Up to a maximum of',
        desc: 'A ceiling the increase cannot push the score past — Primal Champion is "+4, to a maximum of 25". ABILITY SCORES ONLY: every "to a maximum of" in the rules is one, and the other stats have no such ceiling. It never lowers a score that was already above it; it only refuses to raise one past it. Leave blank for no ceiling.',
        example: '25',
      },
    ],
  },
  useability: {
    label: 'use ability', group: 'sheet', icon: 'fa-hand-sparkles',
    blurb: 'Lets the carrier use a different ability for ATTACK ROLLS — "you may use Wisdom instead of Strength or Dexterity". Sits on the sheet, not on a roll, so it applies to whatever weapon they are holding rather than to one blade: the property belongs to the wielder, and a fighter who picks up the same sword swings it with Strength. It is a MAY, not a swap — the attack uses the best score among everything allowed, exactly as a finesse weapon already picks the better of STR and DEX. Affects damage too, because both run off the same ability modifier. No target: it applies to whoever carries this node.',
    fields: [
      {
        key: 'ability', type: 'enum', label: 'Ability', required: true,
        options: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
        desc: 'Which ability becomes available for attack rolls. Granting one the character is worse at changes nothing — best-of never makes an attack worse.',
        example: 'WIS',
      },
    ],
  },
  unarmored: {
    label: 'unarmored AC', group: 'sheet', icon: 'fa-shirt',
    blurb: 'A base Armour Class for a character wearing no body armour — "while you aren’t wearing armor, your base AC equals 10 plus your Dexterity and Constitution modifiers". Not a bonus: it REPLACES what armour would have given, so it competes with armour rather than stacking, and it switches itself off the moment body armour goes on. A SHIELD still helps, and still adds on top. Dexterity is always included (every printed version of this rule adds it); the ability below is the optional second modifier that tells a Barbarian’s Constitution from a Monk’s Wisdom. Two rules at once take the better, because 5e lets you pick one. No target: it applies to whoever carries this node.',
    fields: [
      {
        key: 'value', type: 'number', label: 'Base', required: true,
        desc: 'The constant the modifiers are added to. Ten for Unarmored Defense; thirteen for Draconic Resilience and the Dragon Hide feat, which add no second ability.',
        example: '10',
      },
      {
        key: 'ability', type: 'enum', label: 'Plus (besides DEX)',
        options: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
        desc: 'The SECOND modifier, on top of Dexterity. Constitution for a Barbarian, Wisdom for a Monk. Leave blank for a rule that is just a number plus Dexterity.',
        example: 'CON',
      },
    ],
  },
  adv: flag('adv', 'fa-angles-up', 'Grants advantage on the matched rolls. The target list is the whole statement.', [ONCE, ONE_OF]),
  dis: flag('dis', 'fa-angles-down', 'Imposes disadvantage on the matched rolls.', [ONCE, ONE_OF]),
  crit: {
    label: 'crit', group: 'passive', icon: 'fa-burst',
    blurb: 'Lowers the critical-hit threshold on the matched attack rolls.',
    fields: [{
      key: 'threshold', type: 'formula', label: 'Crits on', required: true,
      desc: 'Lowest d20 face that counts as a critical hit. The lowest threshold across every applying node wins.',
      example: '19',
    }, ONCE, ONE_OF],
  },
  floor: {
    label: 'floor', group: 'passive', icon: 'fa-arrows-up-to-line',
    blurb: 'Sets a MINIMUM on the finished total — "if your total is less than your Strength score, use the score instead". Not a bonus: it changes nothing on a good roll and a great deal on a bad one, which is why no `add` can say it. The HIGHEST floor across every applying node wins, the mirror of how crit takes the lowest threshold. Only a d20 roll has a total to raise, so target a check or a save.',
    fields: [{
      key: 'minimum', type: 'formula', label: 'At least', required: true,
      desc: 'The lowest the total may come to. A formula, so it can be a score rather than a fixed number — `strScore` is what Indomitable Might wants.',
      example: 'strScore',
    }],
  },
  reroll: {
    label: 'reroll', group: 'passive', icon: 'fa-rotate',
    blurb: 'Offers to RE-RUN a roll that has already happened — a d20 roll, or a damage roll. Every other contribution is decided while the roll is being built; this one appears on the finished roll in the roll panel, because "if you fail the save, you can reroll it" is a decision nobody can make before seeing the number. It is an offer, never automatic — the player presses it or does not. Target a d20 roll (roll:save, roll:check, roll:attack, or roll:d20 for all three) OR a damage roll (roll:damage and its kinds) — one or the other, never both in the same effect: they are different dice and the settings that suit one are meaningless on the other.',
    fields: [{
      key: 'keep', type: 'enum', label: 'The new roll is', required: true,
      options: ['advantage', 'new', 'better'],
      desc: 'advantage — a second d20 joins the first and the higher one counts (Countercharm); a d20 roll only. new — the dice are replaced and the result stands, better or worse (Halfling Lucky, Great Weapon Fighting). better — the damage is rolled again and whichever TOTAL is higher counts (Savage Attacker); a damage roll only.',
      example: 'advantage',
    }, {
      key: 'faces', type: 'formula', label: 'Only dice showing at most',
      desc: 'Narrows it to the dice that came up low. Great Weapon Fighting rerolls a 1 or a 2, so this is 2; Halfling Lucky rerolls a natural 1, so this is 1. Leave blank to reroll everything, which is what Countercharm and Savage Attacker do.',
      example: '2',
    }],
  },
  note: {
    label: 'note', group: 'passive', icon: 'fa-comment',
    blurb: 'Surfaces rules text on the target without changing a number. Takes ask when the text computes something — the toggle decides whether the player sees it — or when it ARMS, where the toggle decides whether the note is spent on the next roll at all.',
    fields: [{
      key: 'text', type: 'text', label: 'Note text', required: true, wide: true,
      desc: 'The sentence the player reads on the matched targets. The Label above is the short line in the breakdown; this is the rule itself. {braces} compute: the player sees the value, never the expression, so the text stays true as the character levels.',
      example: 'DC {8 + prof + wis}, Wisdom save or be restrained.',
    },
    /* A note ARMS like anything else. It was the one op left without this, on
       the assumption that prose is always-on — but Brutal Strike offers
       Forceful Blow or Hamstring Blow, and the pick is spent on one swing.
       Without `once` the choice rides every melee damage roll forever, and the
       `ask` that makes it a choice is refused by the audit as a toggle that
       reveals nothing. */
    ONCE, ONE_OF],
  },
  resist: flag('resist', 'fa-shield-halved', 'Halves incoming damage of the matched kind. Target a tag — the tag names the damage type.'),
  vuln: flag('vuln', 'fa-heart-crack', 'Doubles incoming damage of the matched kind.'),
  immune: flag('immune', 'fa-shield', 'Nullifies incoming damage of the matched kind.'),
  setVar: {
    label: 'setVar', group: 'activation', icon: 'fa-equals',
    blurb: 'On activation, writes a value into one of this feature’s variables. This is how a feature turns itself on.',
    fields: [
      {
        key: 'variable', type: 'reference', ref: 'variable', label: 'Variable', required: true,
        desc: 'A variable declared in this feature’s Variables block. DM-only variables cannot be written by an activation — the player would be the one pressing the button.',
        example: 'isRaging',
      },
      {
        key: 'value', type: 'formula', label: 'Value', required: true,
        desc: 'Expression evaluated at activation and stored. Must match the variable’s type.',
        example: 'true',
      },
    ],
  },
  addUses: {
    label: 'addUses', group: 'activation', icon: 'fa-battery-half',
    blurb: 'On activation, moves the USE COUNTER of a feature — this one, or another. The only activation that reaches a second node, because that is what the rules keep asking for: "expend a use of your Rage to restore this" is a negative amount aimed at Rage, and "regain all expended uses of Rage" is a positive one. Clamped to that feature’s own max, so a big number means "all of them" and can never bank more than the feature has. Target a FEATURE, or leave it empty to move this one’s own counter.',
    fields: [
      {
        key: 'value', type: 'formula', label: 'Change by', required: true,
        desc: 'Signed expression added to the target’s current uses, clamped to its max. Negative spends. To restore everything, name the max itself — a Barbarian’s is `rages` — and the clamp does the rest.',
        example: 'rages',
      },
    ],
  },
  addSlot: {
    label: 'addSlot', group: 'activation', icon: 'fa-wand-magic-sparkles',
    blurb: 'On activation, spends or restores a SPELL SLOT. The only resource that lives in the spellbook rather than on the sheet, and so the only one nothing else here can reach: "you can expend a spell slot to regain one expended use of Bardic Inspiration" needed this and had no way to say it. Leave the level blank and the player picks which slot at the press, which is what "a spell slot" means — name a level only when the rule does. A cost that cannot be paid refuses the whole press, so a caster with nothing left simply cannot use the feature. A Pact Magic caster has one slot level by construction and is never asked.',
    fields: [
      {
        key: 'value', type: 'formula', label: 'Change by', required: true,
        desc: 'Signed number of slots. Negative spends; positive restores, clamped to what the caster owns at that level.',
        example: '-1',
      },
      {
        key: 'level', type: 'formula', label: 'Slot level',
        desc: 'Which level of slot moves. LEAVE BLANK for "a spell slot" — the player is asked at the press and picks from what they have. Fill it in only when the rule names a level.',
        example: '3',
      },
      {
        key: 'budget', type: 'formula', label: 'Or a budget of levels', wide: true,
        desc: 'RESTORING ONLY, and it replaces both fields above. A budget in COMBINED LEVELS, not a count of slots: three levels buys one level-3 slot, or a level-2 and a level-1, or three level-1s — and which is the player’s call, so the press opens a picker. This is Natural Recovery, Arcane Recovery and Font of Magic, which are one sentence with a different number.',
        example: '(level + 1) / 2',
      },
      {
        key: 'maxLevel', type: 'formula', label: '…and no slot above level',
        desc: 'The ceiling on what the budget may buy. Every printed version of this rule has one — "none of them can be level 6+" is 5. Leave blank for no cap beyond what the caster owns.',
        example: '5',
      },
    ],
  },
  grant: {
    label: 'grant', group: 'activation', icon: 'fa-hand-holding-heart',
    blurb: 'On activation, arms a bonus on ANOTHER party member instead of on yourself — "that creature gains one of your Bardic Inspiration dice". The press asks who; the die then waits on their sheet and rides the roll they choose, which you never see. Target the roll it answers to, exactly as an arming contribution does: roll:d20 is "their next D20 Test", which is what most of these grants say. The amount is resolved against YOUR character at the moment you press, and snapshotted — your die does not shrink because the recipient is a lower level.',
    fields: [
      AMOUNT,
      {
        key: 'byLevel', type: 'array', label: 'By level', wide: true,
        desc: 'Level-indexed progression, read at YOUR level when the grant is made. When any slot is filled it overrides Amount. Index 0 is unused.',
        example: 'slot 1 = 1d6, slot 5 = 1d8, slot 10 = 1d10, slot 15 = 1d12',
      },
    ],
  },
  addVar: {
    label: 'addVar', group: 'activation', icon: 'fa-plus-minus',
    blurb: 'On activation, increments one of this feature’s variables. Use a negative value to spend a charge.',
    fields: [
      {
        key: 'variable', type: 'reference', ref: 'variable', label: 'Variable', required: true,
        desc: 'A number variable declared in this feature’s Variables block.',
        example: 'charges',
      },
      {
        key: 'value', type: 'formula', label: 'Change by', required: true,
        desc: 'Signed expression added to the current value.',
        example: '-1',
      },
    ],
  },
}

/** Palette order — what an author reaches for first, and what hides behind MORE. */
export const PALETTE = ['add', 'adv', 'dis', 'crit', 'resist'] as const satisfies readonly GraphOp[]
export const PALETTE_MORE = ['vuln', 'immune', 'floor', 'reroll', 'note'] as const satisfies readonly GraphOp[]
/** Activation outcomes get their own palette group — they answer a different
 *  question ("what happens when I press this") from every op above. */
export const PALETTE_ACT = ['setVar', 'addVar', 'addUses', 'addSlot', 'grant'] as const satisfies readonly GraphOp[]
/** The sheet layer gets its own palette group for the same reason activation
 *  outcomes do: it answers a different question from every roll op above it —
 *  "what is this character's DEX", not "what does this roll add". */
export const PALETTE_SHEET = ['boost', 'useability', 'unarmored'] as const satisfies readonly GraphOp[]
export const OP_ORDER: GraphOp[] = [...PALETTE, ...PALETTE_MORE, ...PALETTE_SHEET, ...PALETTE_ACT]

export const IS_ACTIVATION = (op: GraphOp) => OPS[op].group === 'activation'
/** Skipped by resolve() — it never reaches a roll. Compiled by sheetEffects. */
export const IS_SHEET = (op: GraphOp) => OPS[op].group === 'sheet'

export const OP_TITLE: Record<GraphOp, string> = {
  add: 'Add', adv: 'Adv', dis: 'Dis', crit: 'Crit', floor: 'Floor', reroll: 'Reroll', note: 'Note', boost: 'Boost',
  useability: 'Use Ability', unarmored: 'Unarmored AC',
  resist: 'Resist', vuln: 'Vuln', immune: 'Immune',
  setVar: 'Set Var', addVar: 'Add Var', addUses: 'Add Uses', addSlot: 'Add Slot', grant: 'Grant',
}

/** The ops whose target names a damage kind rather than a roll. Mirrors the
 *  engine's own list; kept here so the editor can label them without importing
 *  the resolver. */
export const IS_DAMAGE_FLAG = (op: GraphOp) => op === 'resist' || op === 'vuln' || op === 'immune'

/** Roll kinds a selector may name. `RollKind` in lib/graph.ts is the authority for
 *  the left half; the sub-kinds are the ones the app actually raises today. */
/** `roll:<kind>[.<sub>]`. The sub NARROWS: `roll:damage` is every damage roll,
 *  `roll:damage.melee` only a melee weapon's. Weapon damage is
 *  `damage.melee` + `damage.ranged` — two selectors, because the target list is
 *  an OR and there is no "weapon" roll kind to name. */
export const ROLL_SELECTORS = [
  /* THE THREE D20 ROLLS AT ONCE, under the name the rules use. Not sugar for
     listing them: an armed effect mints one modifier PER selector, so
     `[roll:check, roll:save, roll:attack]` is three separate bonuses off one
     press, while `roll:d20` is the one die the rule actually grants. */
  'd20',
  'attack', 'attack.melee', 'attack.ranged', 'attack.spell',
  /* WHICH ABILITY THE SWING USED. Alongside melee/ranged/spell rather than
     instead of them — a greataxe is both, and the target list is an OR, so
     narrowing by one must not silence the other. "Advantage on Strength-based
     attack rolls" is `roll:attack.str` and nothing else could say it. */
  'attack.str', 'attack.dex', 'attack.con', 'attack.int', 'attack.wis', 'attack.cha',
  'damage', 'damage.melee', 'damage.ranged', 'damage.spell',
  'save', 'save.str', 'save.dex', 'save.con', 'save.int', 'save.wis', 'save.cha',
  'check', 'check.athletics', 'check.stealth', 'check.perception',
  /* INITIATIVE IS A DEXTERITY CHECK — the 2024 rules say so outright — so it is a
     sub-kind here rather than a sixth roll kind. It behaves exactly as
     `check.stealth` does: a roll has ONE sub, so `roll:check.dex` does not catch
     it, the same way it does not catch a Stealth check. `roll:check` catches
     everything, including this. */
  'check.initiative',
  'feature',
]

export const SOURCES: Record<string, string> = {
  class: 'Class', feat: 'Feat', racial: 'Racial', background: 'Background',
  sense: 'Sense', other: 'Other',
}

export const ACTIVATIONS = {
  none: { label: 'None (passive)', note: 'No button on the player’s Features screen — this feature simply applies.', color: 'var(--beige-dim)', icon: 'fa-infinity' },
  action: { label: 'Action', note: 'A button on the Features screen, spending the player’s action.', color: 'var(--amber)', icon: 'fa-hand' },
  bonus: { label: 'Bonus action', note: 'A button, spending the player’s bonus action.', color: 'var(--amber)', icon: 'fa-bolt' },
  reaction: { label: 'Reaction', note: 'A button. Mechanically an action — the label is what tells the player when it fires.', color: 'var(--cyan)', icon: 'fa-reply' },
  free: { label: 'Free action', note: 'A button that costs nothing. Uses, if any, are the only limit.', color: 'var(--good)', icon: 'fa-feather' },
} as const

export type ActivationKind = keyof typeof ACTIVATIONS
export const ACT_ORDER: ActivationKind[] = ['none', 'action', 'bonus', 'reaction', 'free']

/** The six console swatches. Anything else goes through the native colour input. */
export const COLORS = ['#d4bf7d', '#e2b021', '#00a6d6', '#a07ad6', '#b93a3a', '#4fae6b']
export const DEFAULT_COLOR = '#d4bf7d'
