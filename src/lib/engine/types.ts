/**
 * The engine's types and constant lists. The engine itself is Rust (`engine/`,
 * built to packages/engine-wasm); these describe what crosses the boundary.
 *
 * The constant lists are read at module scope, before the engine has loaded, so
 * they are static here. engine.parity.test.ts holds them equal to the Rust copies.
 */
import type {
  ActiveEffect, ArmedMod, EquippedItem, EquippedWeapon, Feature, GraphEffect, GraphOp, ItemEffects,
  ShardNode, ShardTree, Spell, VarDef,
} from '../database.types.ts'

/** §36. `num` carries a flat part and unrolled dice terms; `arr` exists only as a
 *  literal, for level-indexed progression tables (§35). */
export type FormulaValue =
  | { t: 'num'; flat: number; dice: string[] }
  | { t: 'bool'; v: boolean }
  | { t: 'arr'; v: number[] }
  | { t: 'str'; v: string }

/** The scope IS the whitelist — an identifier absent from it is a rejection.
 *  `number | boolean` mirrors `VarDef.type: 'num' | 'bool'` (§30). */
export type ExprScope = Record<string, number | boolean>

/** §33's two whitelists. A variable formula's scope is built from VAR_IDENTS plus the
 *  declared variables; a contribution formula's adds ROLL_IDENTS. A variable that could
 *  read `cast` would stop being a function of character state and become a function of
 *  one particular roll, which is what the variable DAG's memo depends on not happening. */
export const VAR_IDENTS = [
  'level', 'prof', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'hp', 'hpMax', 'saveDc',
  /* THE SCORE, not the modifier. `str` is +3; `strScore` is 16. Almost every rule
     wants the modifier, which is why those got the short names — but a handful
     name the score itself and could not be written at all: Indomitable Might is
     "if the total is less than your Strength SCORE, use the score", and there was
     no way to say 16. Derived from the same effective sheet the modifiers are, so
     a Belt of Giant Strength moves both together. */
  'strScore', 'dexScore', 'conScore', 'intScore', 'wisScore', 'chaScore',
  /* How many attack rolls this character has made since the last Advance Turn.
     Character state, not roll context: it is a fact about the turn, true before
     the roll it might gate exists, which is exactly what keeps it on this side
     of §33's line. "On your FIRST attack roll" — the decision point Reckless
     Attack and its family are worded around — is `attacksThisTurn == 0`. */
  'attacksThisTurn',
  /* THE CANTRIP TIER — 1 to 4, stepping at character level 5, 11 and 17. The
     same number lib/spells.ts damageAt applies a cantrip's `scaling` by, so a
     feature that scales "like a cantrip" reads the one table rather than
     re-deriving it: `1d8 * tier` is Green-Flame Blade's rider, `tier - 1` is
     the number of extra dice a cantrip has picked up. */
  'tier',
] as const
export const ROLL_IDENTS = ['cast', 'proficient', 'targetAc', 'hit'] as const

/** The sentence a player answers when the engine cannot see the target.
 *
 *  ONE sentence, deliberately: effects sharing an `ask` are one checkbox, so
 *  every `hit`-gated contribution on a roll collapses into a single question
 *  rather than one per feature. */
export const HIT_ASK = 'Did the attack hit?'

/** WHAT A SHEET BOOST MAY READ, and it is deliberately two names.
 *
 *  A boost moves a number ON the effective sheet, so its own value is computed
 *  while that sheet is being built: anything derived FROM the sheet — `str`,
 *  `hpMax`, a declared variable — would be asking for the answer it is helping
 *  to produce. `level` and `prof` are the two that come off the character row
 *  and the stored proficiency bonus, so they are settled before the first boost
 *  is read and cannot close the loop.
 *
 *  That is the whole of "+1 Hit Point, and +1 again at every level" — which was
 *  previously unauthorable, because Number('level') is NaN and sheetEffects
 *  dropped the boost without a word. */
export const BOOST_IDENTS = ['level', 'prof'] as const

/** The prefix of a FEATURE-PRESENCE identifier: `has_improved_brutal_strike`.
 *
 *  Rules constantly gate on owning something rather than on being a level -
 *  "the following effects are now among your Brutal Strike options" - and there
 *  was no way to say it. Authors reached for `level >= 13` instead, which is
 *  the same answer only for a single-classed character: a Barbarian 9 /
 *  Fighter 4 is level 13 and has no Improved Brutal Strike, and a one-off DM
 *  grant of a feature scaled itself for free.
 *
 *  An IDENTIFIER rather than a `has("...")` call, because the expression
 *  language has no function syntax and did not need one for this. */
export const HAS_PREFIX = 'has_'

/** What each roll identifier IS, for the author-time probe. A type map rather
 *  than a bare list because `proficient` is a boolean: probing it as 1 would
 *  make `!proficient` a type error in the audit while working perfectly at the
 *  table, which is the audit lying in the more damaging direction. */
export const ROLL_IDENT_PROBE: Record<string, number | boolean> = {
  cast: 1,
  proficient: false,
  /* The target's Armour Class, 0 when nothing is targeted — no creature has
     AC 0, so the absence is readable rather than a lie. Fed by the Foundry
     bridge; without it every roll is untargeted and every author-time probe
     still type-checks. */
  targetAc: 1,
  /* Did the attack land. KNOWN ONLY AFTER THE D20, and only when there is a
     target to compare against — resolve() turns a `hit`-gated effect into a
     question when it cannot answer, rather than dropping it. */
  hit: false,
}


/** One die as it sits in a roll record.
 *
 *  `sides` travels WITH the die rather than being recovered from the expression
 *  that produced it — a d20 pair and a 2d6 damage roll end up in the same
 *  renderer, and asking it to re-parse "2d6" to learn what a chip means is how
 *  a 6 gets drawn as a maximum roll on a d8.
 *
 *  `orig` is the FIRST face this die showed, written once. Rerolling twice must
 *  still be able to say what it originally was, so a reroll never overwrites an
 *  `orig` that is already set.
 *
 *  `crit` marks a die that exists ONLY because the attack critted — the extra
 *  half of a doubled damage roll. The panel paints those apart so "why is this
 *  2d12" answers itself. */
export type RolledDie = {
  v: number; sides: number
  orig?: number; rerolled?: boolean
  crit?: boolean
}

/** One entity that exists on this character right now. `fx` is the effect bundle
 *  it contributes PASSIVELY — set only where a bundle applies without a roll.
 *
 *  `fx?: never` on the kinds that contribute nothing passively is the gate, not a
 *  formality: it makes `{ kind: 'weapon', …, fx }` a compile error, so a magic
 *  weapon's to-hit bonus cannot be wired into the effective sheet by accident. */
export type ActiveSource =
  | { kind: 'feature'; obj: Feature; fx?: ItemEffects }
  | { kind: 'shard'; obj: ShardTree; fx?: ItemEffects }
  /** `shardId` because a node's own id is unique only WITHIN its tree — every
   *  shard is seeded with a node called `core`, so two slotted shards would
   *  otherwise share one graph id. See nodeGid(). */
  | { kind: 'shardnode'; obj: ShardNode; shardId: string; fx?: ItemEffects }
  | { kind: 'spell'; obj: Spell; fx?: never }
  /* A weapon may contribute EXACTLY ONE thing to the sheet: which abilities
     its attacks may use. The type says so rather than a comment saying so —
     `Pick` makes `{ ac: 2 }` on a weapon a compile error, which is the
     guarantee `fx?: never` used to give and the reason a magic sword's +1
     still cannot become +1 AC. */
  | { kind: 'weapon'; obj: EquippedWeapon; fx?: Pick<ItemEffects, 'attackAbilities'> }
  | { kind: 'item'; obj: EquippedItem; fx?: ItemEffects }
  | { kind: 'effect'; obj: ActiveEffect; fx: ItemEffects }

/** Lifted from ShardLattice.tsx so the engine and the lattice editor share one
 *  audit vocabulary rather than growing two. `t` is the title, `s` the sentence,
 *  `id` the offending node (null for findings with no single owner). */
export type AuditSev = 'err' | 'warn' | 'ok'
export type AuditItem = { sev: AuditSev; id: string | null; t: string; s: string }

/** A declaration plus where it came from — collision reporting needs the source. */
export type VarBinding = { def: VarDef; from: ActiveSource }

export type GidKind = 'feature' | 'spell' | 'item' | 'weapon' | 'shardnode'
export type Gid = `${GidKind}:${string}`

export type RollKind = 'attack' | 'damage' | 'save' | 'check' | 'feature'

export type ResolveReq = {
  kind: RollKind
  /** THE LEVEL A SPELL WENT OFF AT, for `cast`. Absent on every roll that is not
   *  a cast, where the scope reads it as 0. */
  cast?: number
  /** DOES THIS ROLL ALREADY COUNT THE PROFICIENCY BONUS, for `proficient`.
   *
   *  A fact about the roll's own parts, which is exactly why no expression could
   *  answer it and why Jack of All Trades — "any ability check that doesn't
   *  otherwise use your Proficiency Bonus" — was unauthorable without it. The
   *  surface that built the terms is the one that knows; see buildCheck. */
  proficient?: boolean
  /** THE TARGET'S ARMOUR CLASS, 0 when nothing is targeted. No creature has AC
   *  0, so the absence is readable in an expression rather than a lie.
   *  Supplied by the Foundry bridge (lib/target.ts). */
  targetAc?: number
  /** DID THE ATTACK LAND — and `undefined` is the third answer, not a missing
   *  one. It is known only after the d20, and only against a target: with no
   *  target the app cannot decide, so a `hit`-gated effect becomes a QUESTION
   *  instead of quietly not existing. See the `hit` branch in resolve(). */
  hit?: boolean
  /** Sub-key: 'dex' for a save, 'investigation' for a check. */
  sub?: string
  /** The gid of the thing being rolled — a weapon, spell, or feature. */
  subject?: Gid
  /** The subject's tags, so `tag:` selectors match. */
  tags?: string[]
  /** ATTACKS ONLY: which ability the attack actually used, so
   *  `roll:attack.str` can mean "Strength-based attacks" — Reckless Attack's
   *  whole condition.
   *
   *  A SIBLING OF `sub`, not a value inside it. `sub` already carries
   *  melee/ranged/spell and is one string; folding the ability in would make
   *  `attack.melee` and `attack.str` mutually exclusive when a greataxe swing
   *  is honestly both. Both become match keys, and the target list is an OR, so
   *  an author can narrow by either without the other going quiet. */
  ability?: string
}

export type Rider = {
  label: string
  source: string
  /** The source's gid, so the Roll Context Panel's catalog sheet can LINK to it
   *  instead of naming it and stopping there. `source` above is deliberately a
   *  bare display name; this is the identity beside it.
   *
   *  Only a `feature:` gid is navigable today — that is the one kind the
   *  Features screen can open (its byGid map) — but the gid is stored unfiltered
   *  so the panel decides, not the engine. */
  sourceGid?: Gid
  /** What this rider grants. A toggled `adv` is not a number, so the panel has to
   *  be told which it is — §13's shape carried flat/dice only. */
  op: GraphOp
  /** Shown when the player still has to decide. */
  formula: string
  /** THE contribution — §49 removed the Resolution-level copy, so this and
   *  `dice` are the only record of what this rider is worth. */
  flat: number
  /** UNROLLED — the caller rolls, so a crit can still double these. Once rolled,
   *  the faces land on `rolledDice` beside them. */
  dice: string[]
  when: 'always' | 'manual' | 'active'
  /** `active` and `always` riders arrive already resolved; `manual` ones start off. */
  on: boolean
  /** `reroll` only. What pressing it does — see GraphEffect.keep. Carried on the
   *  rider because the entry is a SNAPSHOT: the panel acts on a roll that has
   *  already happened, and the node that offered the reroll may be unequipped or
   *  unprepared by the time the player presses it. */
  keep?: 'advantage' | 'new' | 'better'
  /** `reroll` only. WHICH DICE this one re-runs — the d20 of a check, save or
   *  attack, or the dice of a damage roll. Resolved from the effect's targets
   *  here rather than guessed at in the panel: `keep: 'new'` reads the same on
   *  both, and a panel that picked wrong would reroll the wrong dice. */
  rerolls?: 'd20' | 'damage'
  /** `reroll` only. Only dice showing at most this count — already evaluated,
   *  because the scope is gone by the time the player presses. */
  faces?: number
  /** Set on a rider that came from the armed queue rather than from the graph.
   *  It is already applied — §8 #1 — and this is the handle the panel consumes
   *  it by. Consumed-ness is NOT stored here: the panel asks whether this id is
   *  still in `resources.graph.armed`, so one record answers it everywhere. */
  armedId?: string
  /** What answering YES reveals — §25 inline compute already applied. A `note`
   *  carrying an interpolation is the one prose shape a toggle earns its place
   *  on: the DC exists only if the hit landed, so it is shown only once the
   *  player says it did. Absent on every other rider. */
  reveal?: string
  /** The QUESTION, for a `manual` rider — the authored `ask` sentence, verbatim.
   *  It is prose ("at least one of them failed the save"), so it reads as prose
   *  under the rider's name rather than being crushed into the uppercased,
   *  letter-spaced name slot. */
  text?: string
  dmgType?: string
  /** The source's own card text, so the panel can answer "should this have
   *  applied?" without leaving the roll. `source` is a bare display NAME and a
   *  roll entry is not a catalog row, so without this the prose is unreachable
   *  from the panel — it lives on a DM-only table the player never reads. */
  sourceText?: string
  /** The operands a formula was built from, at the values it used. `formula`
   *  says `level + wis`; this says level was 7 and wis was +3.
   *
   *  Captured at resolve time because it CANNOT be recovered later: the scope is
   *  a snapshot of the character mid-roll, and by the time anything renders the
   *  log the values may have moved. Absent for a flat number or a bare die,
   *  which have no derivation worth showing. */
  parts?: { name: string; value: number }[]
  /** Set once the player has answered a `manual` rider and its dice were rolled.
   *  Written by the Roll Context Panel, never by resolve() — which keeps the
   *  engine pure and makes the lock trivial: once this is set the roll
   *  affordance is gone and toggling reuses the value, so reopening the panel
   *  can never re-roll (§8 #2). */
  rolled?: boolean
  /** EXCLUSIVE GROUP KEY. Riders sharing one are a pick-one: answering any of
   *  them declines the rest. Set on offered arms, keyed by the source that armed
   *  them — Brutal Strike's two blows are one choice between two, which the
   *  engine has always known (auditNode says so) and the panel could not say. */
  choice?: string
  /** HOW MANY of that group may be taken. Absent = one, which is what a pick-one
   *  has always been. Carried from the armed mod so the panel stops accepting
   *  clicks at the limit rather than after the first — Improved Brutal Strike
   *  (Enhanced) is "two different Brutal Strike effects" and nothing else. */
  picks?: number
  /** The faces that came up, once `rolled`. `dice` stays the unrolled formula.
   *  Full dice, not bare numbers: a chip that does not know it is a d4 cannot
   *  say whether a 4 was a maximum, and cannot be rerolled. */
  rolledDice?: RolledDie[]
}

export type Resolution = {
  adv: boolean
  dis: boolean
  crit: boolean
  /** The lowest this roll's TOTAL may come to, when a `floor` node applied one.
   *  Absent = no floor. HIGHEST wins — two features each guaranteeing a minimum
   *  both hold, so the better guarantee is the one in force. The mirror of
   *  `critFrom`, which takes the lowest. Applied by composeCheck, after every
   *  contribution, because a minimum on a total means nothing until the total
   *  exists. */
  floor?: number
  /** Lowest d20 face that crits, when a `crit` node applied one. Absent = 20.
   *  Lowest wins: Improved Critical (19) and a hypothetical 18 node give 18, not
   *  17 — a crit range is a threshold, not a bonus that stacks. */
  critFrom?: number
  /** EVERY contribution, and the only record of one.
   *
   *  There used to be a second: `flat`/`dice` held an "unconditional fold" that
   *  the `always` riders duplicated exactly. Two records of one fact do not stay
   *  in agreement — that pair produced the same double-count twice (§45 in
   *  total(), §48 in the panel's footer), each time fixed with a filter rather
   *  than a removal, and it made a rolled face impossible to attribute back to
   *  the contribution that owned it. See §49. */
  riders: Rider[]
  /** `note` ops — authored prose the player reads. */
  notes: string[]
  /** Engine failures. Deliberately NOT folded into `notes`: a formula that broke
   *  is not rule text, and rendering it as such would make it indistinguishable
   *  from something the DM wrote. */
  problems: AuditItem[]
}

export type IndexedEffect = { eff: GraphEffect; from: ActiveSource; owner: Gid }

/** Built once per character load and reused across every roll. This is the memo
 *  the `ponytail:` comments in effects.ts and the engine have been deferring to —
 *  activeSources(), the variable scope and the edge index are all computed here,
 *  once, instead of per roll. */
export type GraphContext = {
  scope: ExprScope
  index: Map<string, IndexedEffect[]>
  byOwner: Map<Gid, IndexedEffect[]>
  problems: AuditItem[]
  /** §16's one-shot queue, as stored. Read here rather than passed per roll so
   *  every caller of resolve() gets it without opting in — an armed modifier the
   *  roller forgot to look up is a bonus the player was promised and did not
   *  get. */
  armed: ArmedMod[]
}

/** Ability check, saving throw, attack roll — the three rolls the rules call a
 *  D20 Test. Damage is not one, and neither is a feature's own roll. */
export const isD20 = (kind: RollKind) => kind === 'check' || kind === 'save' || kind === 'attack'

/** One authored thing the editor knows about, for counting matches against the
 *  CATALOG rather than against one character. */
export type AuthoredNode = { gid: Gid; tags?: string[] }

/** What affectedBy() answers with. */
export type Affecting = {
  /** The effect doing the reaching. */
  eff: GraphEffect
  /** Display name of the node it was authored on. */
  source: string
  /** Its gid, so the popup can navigate to it. Null for a source with no gid
   *  of its own (a potion, a shard tree — see sourceGid). */
  sourceGid: Gid | null
}[]

/** What rollResolution() answers with. */
export type RolledResolution = {
  flat: number
  riders: Rider[]
  /** The same fold, ITEMISED BY SOURCE — "Divine Smite +8", not "FEAT +8".
   *
   *  The roller adds every non-manual contribution into one number and the line
   *  shows that number; naming it "FEAT" told the player which part of the
   *  ENGINE produced it, and a rolled 2d6 sitting inside a lump reads as a
   *  contribution that has not been counted. Built here because this is where
   *  the fold happens: an itemisation computed anywhere else is free to
   *  disagree with the total it claims to explain.
   *
   *  Summed per source, so two contributions from one feature are one line.
   *  A zero contributes nothing and is left out. */
  terms: { label: string; value: number }[]
  /** Contributions in a damage type THIS ROLL IS NOT, grouped by that type.
   *
   *  A total is per type or it is nothing: Divine Smite's 2d8 radiant folded
   *  into a slashing sword's total is resisted as slashing — on the sheet, in
   *  the chat card, and by dnd5e when the damage is applied. So a rider whose
   *  `dmgType` differs leaves `flat` and comes back here for the caller to give
   *  its own line.
   *
   *  Only when the caller says what type the roll itself is. Without `ownType`
   *  there is nothing to differ FROM, and everything folds exactly as before —
   *  which is what keeps the check, activation and consumable callers unchanged. */
  extra: { type: string; expr: string; dice: RolledDie[]; flat: number; sources: string[] }[]
}

/** What auditNode() audits. */
export type AuditedNode = {
  graph?: GraphEffect[]; vars?: VarDef[]
  /** `prose` is the node's own player-facing text. A variable read only by a
   *  description is READ — §25 interpolation is a consumer just like a
   *  condition is. Without it, moving a progression variable onto the feature
   *  whose prose prints it earns a "never used" warning for doing the right
   *  thing, and a warning that fires on correct authoring is one the DM learns
   *  to scroll past. */
  /** `uses` is the node's OWN use-count formula, and it counts as a reader.
   *  Channel Divinity declares `channelDivinity` and reads it nowhere except as
   *  its own max — which is the whole point of the variable — and without this
   *  the audit called a correct node's progression table dead state. A warning
   *  that fires on the right answer is one the DM learns to scroll past. */
  prose?: (string | undefined)[]; uses?: Feature['uses']; shortRecharge?: number | string
}

export type GidSource = { feature_id?: string; spell_id?: string; item_id?: string; id?: string }
