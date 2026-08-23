/**
 * Hand-written types for the Phase 0 schema (supabase/migrations/0001_init.sql).
 * Replace with `supabase gen types typescript` output once the CLI is wired in.
 *
 * Implementation note: we use `type` aliases (not interfaces) so the row shapes
 * satisfy supabase-js's `Record<string, unknown>` generic constraint — interfaces
 * fail that check because they're open to declaration merging.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

/** The slice of a character every OTHER player may see — see lib/vitals.ts.
 *
 *  A compiled cache on `characters.public_vitals` (migration 0018), recomputed
 *  by lib/character.ts on every player write and projected by
 *  `list_party_roster()`. Two of its numbers are DERIVED (effective AC, effective
 *  max HP), which is the whole reason it exists: computing them in SQL would put
 *  a second copy of effectiveSheet in Postgres. */
export type PublicVitals = {
  hp: number
  hpMax: number
  temp: number
  ac: number
  deathOk: number
  deathFail: number
  /** Names, kinds and icons only — never what an effect DOES. */
  effects: { name: string; kind: 'buff' | 'debuff' | 'cond'; icon?: string }[]
}

/** One row of the party HUD: `list_party_roster()`'s projection. */
export type PartyRosterRow = {
  id: string
  name: string
  race: string | null
  class: string | null
  level: number | null
  hp_current: number | null
  hp_max: number | null
  public_vitals: PublicVitals | null
}

export type CharacterIdentity = {
  race?: string
  /** e.g. "High Elf" — a row in race_catalog whose `parent` is this race. */
  subrace?: string
  class?: string
  archetype?: string | null
  background?: string | null
  level?: number
  reputation?: number
  flavor?: string[]
  /** Font Awesome glyph (e.g. "fa-chess-rook") for the roster/menu portrait when
   *  no image is set. Authored DM-side in the Lore tab; defaults to "fa-user". */
  icon?: string
  /** Public image URL for the operator portrait (e.g. a Supabase Storage public
   *  URL). Absent/failed → the screen falls back to the handshake "PORTRAIT_FEED"
   *  panel, so the layout is identical whether or not an image is set. */
  portrait?: string | null
  /** CSS object-position for the portrait crop, so a DM can keep a face in
   *  frame on tall/off-center source images. Absent = 'center top' (prior
   *  hardcoded behavior). Applied everywhere `portrait` renders (Lore,
   *  Equipment, the Operator Console's own preview). */
  portraitFocus?: 'center top' | 'center center' | 'center bottom'
}

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'

export type AbilityScores = {
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
}

export type HP = {
  current: number
  max: number
  temp?: number
}

/** AC source breakdown for the Combat widget. Optional — when absent the
 *  Stat Panel shows the flat AC value with no "= base + DEX" line, rather
 *  than inventing an armor source. */
export type AcBreakdown = {
  base: number
  source?: string
  dex?: boolean
  bonuses?: { label: string; value: number }[]
}

/** Which abilities this character is proficient in for saving throws.
 *  Authored per-character (class-granted); not derivable from scores. */
/** A kit parked on a character, mid-decision. `picked` records the option id
 *  chosen per choice id; a choice missing from it is still open. */
export type PendingKit = {
  classId: string
  className: string
  choices: PendingKitChoice[]
  /** choice id -> chosen option id. Absent = the option question is still open. */
  picked?: Record<string, string>
  /** `${choiceId}.${entryIndex}` -> chosen item ids, for a pool entry inside the
   *  chosen option. Short of `pick` entries = that pool question is still open. */
  picks?: Record<string, string[]>
}
export type PendingKitChoice = { id: string; label: string; options: PendingKitOption[] }
export type PendingKitOption = { id: string; label: string; items: PendingKitEntry[] }
export type PendingKitItem = { item_id: string; qty: number; data: CatalogItemData }
/** A resolved pool: the DM's query run against the catalog at assign time, so
 *  the player picks from real item data without ever reading the catalog. */
export type PendingKitPool = { pick: number; label?: string; pool: PendingKitItem[] }
export type PendingKitEntry = PendingKitItem | PendingKitPool
export const isPendingPool = (e: PendingKitEntry): e is PendingKitPool =>
  Array.isArray((e as PendingKitPool).pool)

/** One path the player may take, with everything it would put on the sheet
 *  already resolved. Resolved at CLASS-assign time for the same reason the kit
 *  is: `class_catalog` has no player policy, so a parked reference would render
 *  as an empty list on the one screen that has to show it. */
export type PendingPathOption = {
  id: string
  name: string
  desc?: string
  icon?: string
  color?: string
  /** The carrier and every feature this path grants at the character's level. */
  features: Feature[]
  /** The caster profile it imposes — an Eldritch Knight makes a martial class a
   *  third caster, which is the whole reason a path is its own row. */
  spellbook?: Partial<CharacterSpellbook>
}

/** A subclass choice waiting on the player.
 *
 *  Parked when the CLASS is assigned, whatever the character's level, and
 *  surfaced by the Codex card only once they reach `level`. Parking it early is
 *  what lets it appear at the right moment with no level-up hook to run. */
export type PendingPath = {
  classId: string
  className: string
  /** What this decision is called in this world — "Arbiter Path". */
  label: string
  /** The character level at which it may be taken. */
  level: number
  options: PendingPathOption[]
}

/** Skill proficiencies a class offers and the player still has to choose.
 *  Parked by Assign for the same reason the kit is — it is the player's pick,
 *  not the DM's. */
export type PendingSkills = {
  classId: string
  className: string
  /** Eligible skill keys (lib/dnd.ts SKILLS). */
  from: string[]
  count: number
}

export type Proficiencies = {
  armor?: string[]
  weapons?: string[]
  tools?: string[]
  languages?: string[]
  fightingStyles?: string[]
}

export type CharacterSheet = {
  abilities?: AbilityScores
  hp?: HP
  hitDice?: { current: number; max: number; die: string }
  ac?: number
  acBreakdown?: AcBreakdown
  initiative?: number
  speed?: number
  proficiencyBonus?: number
  coins?: { gold: number; silver?: number; copper?: number }
  /** Ability keys with save proficiency, e.g. ['str','con'] for a Fighter. */
  saveProficiencies?: AbilityKey[]
  /** Skill keys (camelCase, see lib/dnd.ts SKILLS) the character is proficient in. */
  skillProficiencies?: string[]
  /** Skill keys with expertise (double proficiency). */
  skillExpertise?: string[]
  /** Senses overrides. darkvision in feet; absent/0 means none (e.g. Human). */
  senses?: { darkvision?: number }
  proficiencies?: Proficiencies
  /** A starting kit waiting on the player. Written by Assign Class, cleared
   *  when the last choice is made (components/StartingKit.tsx).
   *
   *  Carries item DATA rather than catalog ids on purpose: this is the one
   *  payload a PLAYER has to read, and item_catalog is DM-only. Same
   *  snapshot-at-the-boundary rule as a granted item or feature. */
  pendingKit?: PendingKit
  /** Skill picks waiting on the player — see PendingSkills. */
  pendingSkills?: PendingSkills
  /** A subclass choice waiting on the player — see PendingPath. */
  pendingPath?: PendingPath
  /** Flat per-ability saving-throw bonuses. May be authored (a feat) OR injected
   *  by effect layering (lib/effects.ts); read by dnd.ts saveTotal. */
  saveBonuses?: Partial<Record<AbilityKey, number>>
  /** Flat per-skill bonuses (keyed by skill key). Authored or effect-injected;
   *  read by dnd.ts skillTotal. */
  skillBonuses?: Partial<Record<string, number>>
  /** Abilities the character MAY use for attack rolls beyond what the weapon
   *  itself allows — granted by a `useability` rule. INJECTED ONLY, never
   *  authored: effectiveSheet unions it from every active source, and
   *  weapons.ts weaponAbilityKey reads it. */
  attackAbilities?: AbilityKey[]
  /** Class features, feats, racial traits, senses — the Features screen's source.
   *  Descriptive (prose + usage text); mechanical numbers stay on the sheet/items.
   *  DM-authored per character. */
  features?: Feature[]
}

/** Which family a feature belongs to — drives the Features dossier grouping.
 *  'class' = class/subclass feature, 'feat' = a chosen feat, 'racial' = species
 *  trait, 'background' = background feature, 'sense' = e.g. Darkvision. */
export type FeatureCategory = 'class' | 'feat' | 'racial' | 'background' | 'sense' | 'other'

/** Where a feature came from — drives the card header's backdrop colour so the
 *  player can tell a level-up ability from a magic-item grant or a corruption at
 *  a glance. DM-authored; absent = neutral. */
export type FeatureKind = 'levelup' | 'equipment' | 'corruption'

/** A single character feature/feat/trait. Purely descriptive — the engine never
 *  reads numbers off it (those live on the sheet or on item `effects`); this is
 *  the "what can my character do" reference the player reads. */
export type Feature = {
  id: string
  /** Back-reference to the `feature_catalog` template this was granted from
   *  (slice 7). Snapshot semantics, same as item `item_id`. */
  feature_id?: string
  name: string
  category?: FeatureCategory
  /** Origin of the feature — tints the card header backdrop. */
  kind?: FeatureKind
  /** e.g. "Fighter 1", "Variant Human", "Soldier". */
  source?: string
  /** "Level 4+", "Strength 13+". Display-only — nothing enforces it yet, and
   *  13 of the 17 SRD feats have one, so dropping it would lose real text. */
  prerequisite?: string
  /** Open5e slug, when this row was imported. See CatalogItemData.srd_key. */
  srd_key?: string
  /** Edited since import — re-import skips it. */
  modified?: boolean
  /** The provenance BREADCRUMB shown in the player's feature popup —
   *  ["Fighter", "Martial Reserve", "Level 1", "Second Wind"].
   *
   *  A chain rather than a longer `source` because the popup renders it as steps
   *  with arrows and marks the last one, which a single string cannot express.
   *  Absent falls back to a chain derived from category/source/level/name
   *  (lib/featureView.ts originChain), so this is enrichment, never a
   *  requirement. */
  origin?: string[]
  /** Icon name. Either a Font Awesome class (`'fa-wind'`) or a game-icons value
   *  prefixed `gi:` (`gi:lorc/aura`). Unprefixed IS Font Awesome — that is what
   *  let both sets coexist with no migration. Render it with `<Icon>`, never by
   *  interpolating into a `fa-solid` class. */
  icon?: string
  /** Level the feature was acquired at (for display/sorting). */
  level?: number
  /** Recharge/usage tag, e.g. "1/short rest", "passive", "2/long rest". */
  usage?: string
  /** Short card text — shown on the card (the card scales to it) and at the top
   *  of the detail panel. Supports lightweight markdown: **bold** and *italics*. */
  light_description?: string
  /** Deeper detail shown only in the detail panel, below `light_description`.
   *  Same markdown support. */
  deep_description?: string
  /** Legacy fields — fall back to these for the card text when
   *  `light_description` is absent (pre-migration data). */
  summary?: string
  description?: string
  /** Optional label/value detail rows (like item `rows`), e.g. ["Range","60 ft"]. */
  rows?: [string, string][]
  /** Limited-use tracking. Absent = at-will / passive (no use to spend). `current`
   *  is player-mutable; `max` is authored. Restored by a rest (see `recharge`). */
  uses?: { current: number; max: number }
  /** When spent uses come back. 'short' = short OR long rest; 'long' = long rest
   *  only. Absent = doesn't recharge on rest (DM grants manually). */
  recharge?: 'short' | 'long'
  /** Dice expression rolled when the feature is used, e.g. "1d10 + 7" (Second
   *  Wind). When present, using the feature shows the result in a toast — the
   *  player applies the effect themselves, like an attack roll. */
  roll?: string
  /** Label for the roll line in the toast, e.g. "Healing". Defaults to "Result". */
  rollLabel?: string
  /** Optional toast tone for the roll line ('heal' green / 'buff' cyan). */
  rollTone?: 'heal' | 'buff'
  /** Variables this feature introduces (lib/graph.ts). Shape only for now — no
   *  authoring UI writes it yet. */
  vars?: VarDef[]
  /** Free-text targeting tags, normalised on save (lib/graph.ts normalizeTag).
   *  Shape only for now. */
  tags?: string[]
  /** Structured roll contributions. Absent = a pure prose feature. */
  graph?: GraphEffect[]
  /* A feature's flat sheet bonuses (+2 DEX, 60ft darkvision) are NOT a field
     here. They are `boost` ops inside `graph`, compiled on read by
     lib/modEditor.ts sheetEffects. One mechanism, authored in the same op
     palette as everything else a feature does. */
  /** THE FEATURE TINT. A DM-set hex that reaches the PLAYER's card and popup: it
   *  owns the header wash and the hexagon fill, and nothing else. State — cyan
   *  interactive, red spent, cyan active-ON — always overrides it, so a tint can
   *  never disguise whether a feature is spent or held.
   *
   *  Names render as a fixed-lightness mix of the tint toward warm white rather
   *  than the raw hex, so every swatch a DM can pick stays legible on the dark
   *  card. Absent renders exactly as an untinted feature always did.
   *
   *  Distinct from `kind`, which tints by PROVENANCE and is not the DM's choice.
   *  It also still tints the editor's own list row, which is where it started. */
  color?: string
  // ── Authoring-only fields (Feature Editor, slice 3). These organise the DM's
  //    catalog and reach no player screen. ──
  /** Folder PATH in the Feature Editor's list — `SRD/Bard` nests Bard under SRD.
   *  The folder set is DERIVED from the features in it: there is no folder store
   *  to drift out of sync, nesting needs no parent rows, and renaming a parent is
   *  a find-and-replace over a prefix. The cost is that a folder emptied of its
   *  last member stops existing. Path rules live in `src/lib/folders.ts`.
   *  ponytail: derived folders. Add a folder store if empty ones need to persist. */
  folder?: string
  /** What the player spends to use it. Independent of `uses` — a passive feature
   *  can still track uses, and an at-will action can have none. */
  activation?: 'none' | 'action' | 'bonus' | 'reaction' | 'free'
  /** Catalog templates only. False/absent = draft; the Grant picker hides it.
   *  Players never read feature_catalog at all (migration 0005 has no player
   *  policy), so a grant is the only path from catalog to sheet — which is
   *  exactly what this gates. */
  published?: boolean
  /** Sort key within a folder. FRACTIONAL: dropping between two neighbours
   *  writes the midpoint, so a reorder is one row write instead of renumbering
   *  every sibling. */
  order?: number
}

/** A variable declaration. Definitions ride on the node that introduces them, so
 *  an unequipped item's variables stop existing exactly as its features do —
 *  scoping falls out of lib/effects.ts activeSources() rather than needing a rule
 *  of its own. Values live in `resources.graph.vars` / `.dmVars`, split by who may
 *  write them; DERIVED variables are never stored, only computed.
 *
 *  The namespace is flat and global per character — `mercy` is `mercy`, not
 *  `feature:arbiter.mercy`. That buys the authoring ergonomics the whole system
 *  exists for; the price is collisions, which lib/graph.ts reports. */
export type VarDef = {
  /** Identifier: /^[a-z][a-zA-Z0-9]*$/. Referenced bare in formulas — `mercy`. */
  name: string
  kind: 'stored' | 'derived'
  /** `stored` only, and REQUIRED there. `derived` variables omit it — their type
   *  comes from their formula.
   *
   *  Not inferred from `initial`: the expression language is typed and its
   *  rejections turn on type, so the audit cannot decide whether `mercy > 5` or
   *  `isMercy && x` is legal without knowing what `mercy` is. It is also which
   *  zero a character WITHOUT this variable reads — a `num` substituted for a
   *  `bool` would make `isMercy && x` a type error on exactly those characters. */
  type?: 'num' | 'bool'
  /** `derived` only. Expression over the VARIABLE whitelist (lib/expr.ts
   *  VAR_IDENTS) plus other variables — never roll context. */
  formula?: string
  /** `stored` only. Which bucket the value lands in, and therefore who may write
   *  it. Absent = 'player'. */
  scope?: 'player' | 'dm'
  /** `stored` only. Value on first appearance. Absent = the type's zero. */
  initial?: number | boolean
  /** Editor + DM-console display name. */
  label?: string
  /** `stored` only. When a rest returns this to `initial` (or the type's zero).
   *  Mirrors Feature.recharge, which already means exactly this for uses:
   *  'short' = short OR long rest, 'long' = long only, absent = never resets.
   *
   *  Forced by real content — "once per rest" state like `used_this_fight` is
   *  otherwise true forever until someone remembers to flip it back. */
  resetOn?: 'short' | 'long'
}

/** One-shot modifier awaiting a matching roll. Keyed by ROLL KIND from the
 *  start, never attack-only. Declared here so the stored shape is complete;
 *  nothing arms or consumes one until the armed-queue slice. */
export type ArmedMod = {
  id: string
  /** The gid of the node that armed it. IDENTITY, not display: `id` is built
   *  from it, dedup keys on it, and the cards match on it. */
  source: string
  /** That node's NAME, captured when it armed. Display only — a gid is not
   *  something to show a player, and by the time this is read the source may be
   *  unequipped or unprepared, so looking it up again could come back empty. */
  sourceName?: string
  label: string
  kind: string
  sub?: string
  subject?: string
  op: GraphOp
  value?: string
  /** Carried through arming, or an armed "+2d6 radiant" lands in the untyped
   *  bucket and the damage split silently loses a colour. */
  dmgType?: string
  at: number
}

/** Per-character graph state, at `resources.graph`.
 *
 *  The two buckets are a PERMISSION expressed as a LOCATION: Postgres RLS is
 *  row-level and cannot allow writing one JSON path while refusing another, so
 *  which object a value lives in is what decides who may write it. Migration
 *  0015's guard_dm_vars trigger reverts any non-DM change to `dmVars`.
 *
 *  A feature being ON is an ordinary bool in `vars` — there is no separate
 *  `active` list, because two records of one fact are free to disagree. */
export type GraphState = {
  vars?: Record<string, number | boolean>
  /** DM-only. Guarded by migration 0015, not by client good behaviour. */
  dmVars?: Record<string, number | boolean>
  armed?: ArmedMod[]
}

/** Deliberately a short list, not a kind×field matrix. Each exists because a
 *  catalogued homebrew feature needs it; add the next one the same way.
 *  Everything except `add` is a FLAG, never a number — advantage is not a bonus.
 *
 *  `resist`/`vuln`/`immune` are damage flags: their target names the damage kind
 *  and they answer "what happens when fire lands on me", which is not a roll.
 *  lib/graph.ts reads them through damageFlags(), never through resolve(). */
export type GraphOp =
  | 'add' | 'adv' | 'dis' | 'crit' | 'note'
  | 'resist' | 'vuln' | 'immune'
  /** SHEET layer. Unlike everything else here, this does not touch a roll at
   *  all — it changes a number ON THE SHEET (an ability score, speed,
   *  darkvision), which is what a race's +2 DEX is. resolve() skips it; it is
   *  compiled into ItemEffects by lib/modEditor.ts sheetEffects and layered by
   *  effectiveSheet exactly like a worn item's effects. Has no target: it
   *  applies to the character carrying it, not to a matched thing. */
  | 'boost'
  /** Also SHEET layer: says the carrier MAY use a given ability for attack
   *  rolls — "you may use Wisdom instead of Strength or Dexterity". Not a
   *  number, so it unions rather than sums, and it is a permission rather than
   *  a substitution: weaponAbilityKey picks the best score among everything
   *  allowed, exactly as finesse already picks the better of STR/DEX. */
  | 'useability'
  /** ACTIVATION outcomes. Unlike everything above, these do not modify a roll —
   *  they run when the player presses Use, and they WRITE. resolve() skips them
   *  for that reason: folding them into a Resolution would fire them on every
   *  roll instead of on a press. */
  | 'setVar' | 'addVar'

/** One structured contribution a node makes to a roll. Absent `graph` = a pure
 *  prose node, which stays a legitimate outcome — the effect block is opt-in per
 *  feature and collapsed by default in the editor. */
export type GraphEffect = {
  id: string
  /** OR across selectors — matching any one is enough. Absent/empty = this
   *  node's own roll. Three namespaces and that is the whole language:
   *  `feature:`/`spell:`/`item:`/`weapon:`/`shardnode:` (one thing, by gid),
   *  `tag:<tag>` (anything active carrying it), `roll:<kind>[.<sub>]`. */
  target?: string[]
  op: GraphOp
  /** `add` only. A formula (lib/expr.ts); dice terms allowed and returned
   *  unrolled so a crit can still double them. Also carries the assigned value
   *  for `setVar` and the signed delta for `addVar`. */
  value?: string
  /** `boost` only. Which sheet stat to change — one of lib/modEditor.ts's
   *  MOD_STATS / SKILL_STATS, the same vocabulary the item and shard-node
   *  modifier rows use, so one compiler serves all three. */
  stat?: string
  /** `useability` only. Which ability the carrier MAY use for attack rolls.
   *  Stored uppercase as the enum offers it; read case-insensitively. */
  ability?: string
  /** `setVar` / `addVar` only. The name of a variable this node declares. */
  variable?: string
  /** How the target list combines. Absent = `or`, which is what it has always
   *  been and what most lists want: `weapon:sword` OR `weapon:axe`.
   *
   *  `and` requires EVERY selector to match the same roll, which is the only way
   *  to say "a fire weapon, on its damage roll" — `tag:fire` alone matches the
   *  attack and the damage roll both, since a weapon carries its tags into
   *  either. §20 rejected this until a feature needed it; one did. */
  match?: 'or' | 'and'
  /** App-evaluated boolean expression over variables. Absent = always true.
   *  Gates EXISTENCE — a false `when` means the effect does not surface at all. */
  when?: string
  /** A player toggle and its label — "at least one failed the save". Nothing can
   *  evaluate this; only a human knows it. Gates RESOLUTION, and is orthogonal to
   *  `when`: an effect may need an expression gate AND a toggle at once. Also
   *  what decides pre-rolling — `when`-only riders pre-roll and show their value,
   *  anything carrying `ask` shows the formula and rolls on tap. */
  ask?: string
  /** REQUIRED. An unlabelled number in a breakdown is exactly the bug the roll
   *  context panel exists to prevent. */
  label: string
  /** `add` on a damage roll: the damage type, for the breakdown colour. */
  dmgType?: string
  /** Arms once instead of applying continuously. Parsed today, honoured when the
   *  armed queue lands. */
  once?: boolean
  /** `note` only. The rule the player reads. `label` is the short line in a
   *  breakdown; this is the sentence. Absent falls back to `label`, which is what
   *  notes authored before this field existed relied on. */
  text?: string
  /** `crit` only. Lowest d20 face that counts as a critical hit, as a formula.
   *  The LOWEST threshold across every applying node wins — two features that
   *  both improve the range pick the better one rather than stacking. */
  threshold?: string
  /** `add` only. A level-indexed progression table: 21 slots, index 0 unused
   *  because character levels start at 1. Sugar for an array-index expression,
   *  kept as its own field so the editor can render the grid that makes the
   *  off-by-one visible instead of hiding it in every authored formula.
   *
   *  SPARSE BY DESIGN — filling 1/5/11 means "3 from level 11 up", not "nothing
   *  at 12". When any slot is filled the table overrides `value`. */
  byLevel?: string[]
}

/** A CharacterSheet with equipped-item effects already layered in (lib/effects.ts).
 *  Branded distinct from CharacterSheet so it's visible at call sites that this is
 *  DERIVED, display-only data — it must never be written back to the DB (that would
 *  persist item-boosted scores as the new base, and unequip couldn't undo it). */
export type EffectiveSheet = CharacterSheet & { readonly __effective: true }

/** Six, matching the SRD ladder. `very-rare` and `artifact` arrived with the
 *  SRD 5.2 import — collapsing them into `rare`/`legendary` would have made two
 *  genuinely different tiers indistinguishable on a shelf of 757 magic items.
 *  Hyphenated, not camelCased, because the value doubles as a CSS token suffix
 *  and an Open5e key. */
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary' | 'artifact'

/** The eight worn gear slots an item can occupy, laid out 4x2 on the Equipment
 *  screen. (The G.U.I.D.E. Shard is managed on the Shard screen and is not filled
 *  from the inventory equip flow. Quick Access is GONE — the on-person grid replaced
 *  it; see the Inventory Refactor spec §5.)
 *
 *  Rings are two distinct slots rather than a count, so each can hold a different
 *  band and `EquippedGear` stays one-item-per-key. Attunement is capped at 3 across
 *  all slots and is DERIVED by counting equipped items with an `attune` value —
 *  never stored. */
export type ItemSlot =
  | 'helmet' | 'armor' | 'cloak' | 'boots'
  | 'gloves' | 'neck'  | 'ring1' | 'ring2'

/** `ammo` is load-bearing, not cosmetic: an ammunition-only quiver is expressible
 *  only if ammunition is its own category (see `ContainerDef.allowedCategories`). */
export type ItemCategory =
  | 'weapon' | 'ammo' | 'armor' | 'consumable' | 'tool' | 'quest' | 'misc'

/** Container kinds that ship today. Left OPEN on purpose: a new `inline` kind (bolt
 *  case, scroll case) claims no tab and costs nothing, so the DM can author one in
 *  the catalog freely. A new `page` kind is NOT free — it would become a fifth tab
 *  and reopen the overflow problem the fixed tab bar exists to close. See the
 *  Inventory Refactor spec §3. */
export type ContainerKind =
  | 'backpack' | 'bagOfHolding' | 'sack' | 'quiver'
  | (string & {})

/** Present on an item that IS a container. How its contents are *used* decides
 *  `mode`, and mode is authored, never inferred:
 *    page   — many arbitrary items; owns a tab in the Inventory panel, browsed as a list
 *    inline — few stacks of one category; expands in the storage sidebar, never a tab */
export type ContainerDef = {
  kind: ContainerKind
  mode: 'page' | 'inline'
  /** Contents excluded from carry weight (bag of holding). The container's OWN
   *  weight always counts — `weightless` exempts only what's inside it. */
  weightless: boolean
  /** Category filter. Absent/empty = accepts anything. A quiver sets `['ammo']`,
   *  which is also what makes picked-up arrows route to it automatically. */
  allowedCategories?: ItemCategory[]
  /** Hard item cap (quiver 20, scroll case 10). A container at capacity is SKIPPED
   *  by the routing chain, never an error — a pickup can't fail. Absent = unlimited. */
  capacity?: number
}

export type WeaponHand = 'main' | 'off'
/** Which ability drives a weapon's attack/damage. 'finesse' = the better of STR/DEX. */
export type WeaponAbility = 'str' | 'dex' | 'finesse'

/** Numeric, auto-computed modifiers an item grants while equipped. Layered over
 *  the base sheet by lib/effects.ts and NEVER written back (the base stays canon).
 *  Descriptive effects (advantage, resistance, charges, granted proficiencies) are
 *  deliberately NOT modelled here — keep those as `rows`/`flavor` text so the engine
 *  never pretends e.g. advantage is a flat number. */
export type ItemEffects = {
  /** Flat ability bonuses, summed across items (e.g. +2 STR). */
  abilities?: Partial<Record<AbilityKey, number>>
  /** Ability "set to" floor (Belt of Giant Strength STR=21). Resolved as
   *  max(base, highestSet); flat `abilities` bonuses add ON TOP of that. */
  abilitySet?: Partial<Record<AbilityKey, number>>
  /** Flat AC bonus (Ring of Protection +1). Armor-as-base-AC is NOT modelled. */
  ac?: number
  /** To-hit bonus on this weapon's attack roll (magic weapon +X). */
  attack?: number
  /** Damage bonus on this weapon's damage roll. */
  damage?: number
  /** Abilities the wearer MAY use for attack rolls, on top of whatever the
   *  weapon itself allows. The one field here that is not a number and does not
   *  sum: two features granting WIS grant WIS, not WIS twice, so effectiveSheet
   *  UNIONS these. Read by weapons.ts weaponAbilityKey. */
  attackAbilities?: AbilityKey[]
  /** Flat saving-throw bonus: a number applies to ALL saves; object = per-ability. */
  saves?: number | Partial<Record<AbilityKey, number>>
  /** Flat per-skill bonus, keyed by skill key (see lib/dnd.ts SKILLS). */
  skills?: Partial<Record<string, number>>
  /** Skill keys this item makes the wearer PROFICIENT in, unioned with the
   *  character's own. Deliberately separate from `skills` above: "+2 Stealth" and
   *  "proficient in Stealth" are different claims — the first is a flat number,
   *  the second scales with proficiency bonus and shows as a filled pip. */
  skillProficiencies?: string[]
  /** Skill keys this item grants EXPERTISE in — double proficiency. Implies
   *  proficiency, the same way an authored `skillExpertise` does (lib/dnd.ts
   *  skillRow reads `expertise ? 2 : proficient ? 1 : 0`). */
  skillExpertise?: string[]
  /** Walking-speed bonus in feet. */
  speed?: number
  /** Initiative bonus (added to the stored initiative; does not recompute from DEX). */
  initiative?: number
  /** Darkvision granted/extended, in feet (takes the max). */
  darkvision?: number
  /** Flat bonus to max HP (shard nodes; no item grants this today). Folded into
   *  `hp.max` by lib/effects.ts — the authored `sheet.hp.max` stays the canon base. */
  maxHp?: number
  /** Carrying-capacity multiplier (Powerful Build-style: "capacity doubled").
   *  Doesn't sum across sources like the flat fields above — lib/effects.ts's
   *  carryMultiplier() takes the largest granted value, since 5e's Powerful
   *  Build doesn't stack with itself. Absent/1 = no change. */
  carryMult?: number
}

/** One authored modifier row: a stat, an amount, and (abilities only) whether the
 *  amount is a flat bonus or a floor the score is set to (abilitySet). Shared by
 *  the item/shard modifier editor (lib/modEditor.ts) and the effect catalog's
 *  Modifiers block — one shape, compiled by `compileEffects` into `ItemEffects`. */
export type Mod = { stat: string; amt: number; set?: boolean }

/** Duration options offered wherever an effect is APPLIED — never on the effect
 *  definition itself (see EffectDef). Only 'Rounds'/'Minutes'/'Hours' are counted
 *  (paired with an `amount`); 'Until rest' and 'Permanent while equipped' are not. */
export type EffectDuration = 'Rounds' | 'Minutes' | 'Hours' | 'Until rest' | 'Permanent while equipped'

/** An item's reference to an effect_catalog definition, plus how long IT grants
 *  it — duration lives on the applier, not the definition. */
export type EffectRef = { effectId: string; dur: EffectDuration; amount?: number }

/** A single item. Self-describing: the object carries its own display detail +
 *  mechanical `effects`. Granted copies also keep an `item_id` back-ref to their
 *  `item_catalog` template (Phase 2 slice 5), but the item stays self-describing —
 *  Grant Item snapshots the template, it does NOT hydrate a bare reference at read
 *  time. The SAME shape lives in `equipped`
 *  slots and in `inventory` — equipping just moves the object between them, so an item
 *  is in exactly one place ("one flag decides which; never both", handoff §4). `null`
 *  in a slot means unequipped → the screen renders an honest empty state. */
export type EquippedItem = {
  /** Stable id so the item can be moved between inventory and equipped. */
  id?: string
  /** Back-reference to the `item_catalog` template this was granted from (Phase 2
   *  slice 5). Rides along through equip/unequip so a future live-hydration refactor
   *  can match granted copies to their template with no migration. Absent on the
   *  original pre-catalog seed items. */
  item_id?: string
  name: string
  category?: ItemCategory
  /** Which gear slot this item fits; absent = not slotted gear (e.g. a weapon). */
  slot?: ItemSlot
  rarity?: ItemRarity
  /** Armour's REPLACEMENT Armour Class — chain mail's 16, not a bonus.
   *  Distinct from `effects.ac`, which is layered ON TOP of the sheet's AC:
   *  writing 16 there would add 16 to the character's existing score. A silent,
   *  large, wrong number was the reason this field exists rather than reusing
   *  the bonus. Absent on everything that is not body armour or a shield. */
  baseAc?: number
  /** Whether Dex is added on top of `baseAc`, and the cap if there is one.
   *  Storing `baseAc` alone would be the very bug that field exists to avoid:
   *  a Breastplate is "14 + Dex (max 2)", and a bare 14 silently becomes a flat
   *  14 the moment anything computes AC from it. Light armour: add, no cap.
   *  Medium: add, cap 2. Heavy: no add. */
  acAddDex?: boolean
  acDexCap?: number
  /** Where this row came from. 'srd' marks an Open5e SRD 5.2 import; absent
   *  means hand-authored. Travels with the data so attribution survives an
   *  export that leaves the repo behind. */
  source?: 'srd'
  /** The Open5e slug (`srd-2024_longsword`). The upsert key for re-import. */
  srd_key?: string
  /** An imported row a human has since edited. Re-import SKIPS these — without
   *  the flag, one re-run after a schema change silently destroys every
   *  hand-authored effect on every SRD item. */
  modified?: boolean
  icon?: string
  rows?: [string, string][]
  flavor?: string
  attune?: string
  /** Nominal worth in gold. DM-authored in the catalog; display-only (the engine
   *  never spends it). Absent = priceless/unlisted. */
  value?: number
  /** Denomination `value` is stated in. Absent = 'gp' (pre-existing rows keep
   *  working with no migration). Display-only, same as `value` itself. */
  valueUnit?: 'gp' | 'sp' | 'cp'
  qty?: number
  /** Per-unit weight in pounds (SRD). Summed across carried + equipped for Burden;
   *  multiplied by `qty` for stacks. Absent = weightless (0). */
  weight?: number
  /** Carry-grid footprint in cells (default 1×1). Intrinsic to the item, so it
   *  rides ALONG when the item is equipped and is preserved when it returns to the
   *  bag — only the grid POSITION (col/row) is dropped on equip and re-packed on
   *  return. (A 2×2 Chain Mail stays 2×2 after an unequip.) */
  w?: number
  h?: number
  effects?: ItemEffects
  /** Effect-library references (DM authoring, catalog only). `effects` above is
   *  the COMPILED cache of these — recompiled from the referenced effects' `mods`
   *  every time the item is saved in the catalog form, so equip/grant keeps
   *  reading plain `ItemEffects` with no changes. The player client never reads
   *  the effect catalog. Absent on pre-library items and on granted/owned copies
   *  (which only ever carry the compiled `effects`). */
  effectRefs?: EffectRef[]
  /** Features this item grants while EQUIPPED — full snapshots (each carrying a
   *  `feature_id` back-ref), embedded so the player client never needs to read
   *  the DM-only feature catalog. Surfaced as the Gear Features group on the
   *  player Features dossier; never merged into `sheet.features`. */
  features?: Feature[]
  /** Consumable: HP restored on use. Number = flat; string = dice, e.g. "2d4 + 2". */
  heal?: number | string
  /** Consumable: free-text duration reminder ("10 rounds", "1 minute") carried onto
   *  the resulting status effect. NOT auto-counted — there's no round tracker. */
  duration?: string
  /** Present iff this item IS a container. Equipping it unlocks its tab (`page`) or
   *  its sidebar row (`inline`); unequipping takes the CONTENTS with it. */
  container?: ContainerDef
  /** DM-set: the item is carried but unusable — can't be equipped, used or consumed.
   *  It keeps its cell and still counts toward carry weight; it is in your pack and
   *  simply refusing you. Distinct from confiscation, which removes it outright. */
  locked?: boolean
  /** Variables this item introduces while EQUIPPED (lib/graph.ts). Unequip and
   *  they stop existing, exactly as `features` do. Shape only for now. */
  vars?: VarDef[]
  /** Free-text targeting tags, normalised on save (lib/graph.ts normalizeTag). */
  tags?: string[]
  /** Structured roll contributions while EQUIPPED. Distinct from `effects`,
   *  which is the passive numeric layer — this is per-roll and conditional. */
  graph?: GraphEffect[]
}

/** A temporary, player-applied effect (drank a potion, etc.). Layered over the
 *  base sheet by lib/effects.ts EXACTLY like worn gear, then removed manually or
 *  cleared on a rest. Lives in `resources.activeEffects`. Display-only math, like
 *  all effects — the base sheet is never mutated. */
export type ActiveEffect = {
  id: string
  name: string
  icon?: string
  /** Visual family — colors the status chip / roster dot (cyan buff, amber
   *  condition, red debuff). Absent (player-consumed potions) = 'buff'. */
  kind?: 'buff' | 'cond' | 'debuff'
  effects: ItemEffects
  /** Where it came from, e.g. the potion name. */
  source?: string
  /** Free-text duration reminder shown on the status chip. */
  note?: string
  /** Full prose description, snapshotted at apply time (the effect library's
   *  `desc` when applied from there; an item's `flavor` when drunk as a
   *  potion). The player never reads the effect catalog, so this is the one
   *  copy their Effects panel tooltip has — `note` stays the short status-line
   *  summary, this is the longer read. */
  desc?: string
  /** When it was applied (epoch ms). */
  at?: number
  /** Turns remaining, counted down by Advance Turn (lib/turns.ts).
   *
   *  ABSENT MEANS UNTRACKED, never zero — "until rest", a permanent boon, or a
   *  condition the DM will lift by hand. Treating absent as expired would delete
   *  every effect the first time the button was pressed.
   *
   *  A NUMBER, because `note` and `duration` are free text: one says "10 rounds",
   *  another "1 minute", and the one live effect in the campaign says "Haste".
   *  None of that can be decremented, which is why the tracker needed this field
   *  before it could need a button. Written at apply time from the duration the
   *  DM already picks (amount + unit), so it is derived rather than re-typed. */
  turns?: number
  /** Damage this effect deals at the start of each turn, as a dice expression —
   *  "1d6" for poison. Advance Turn does NOT roll it: it surfaces it in the roll
   *  panel for the player to roll, because a number the app rolled on your behalf
   *  while you were not looking is one you cannot check. */
  tick?: string
  /** Requires concentration. Display and bookkeeping only — the app never drops
   *  it, because losing concentration is a saving throw made at the table and an
   *  effect the app cancelled on its own would be a rule it invented. Marked so
   *  the player can see WHY it is fragile, and so a second one is visibly a
   *  problem. */
  concentration?: boolean
}

/** Weapon-specific fields layered onto an item. */
export type WeaponData = {
  hand?: WeaponHand
  /** Ability driving attack/damage; defaults to STR. */
  ability?: WeaponAbility
  /** Raw damage dice for the roller, e.g. "2d6" or "1d8". */
  damageDice?: string
  /** Pretty damage string for display, e.g. "2d6 + 4". Derived if absent. */
  damage?: string
  /** Damage type, e.g. "Slashing". */
  type?: string
  /** Mirror the icon horizontally (off-hand twin). */
  flip?: boolean
  /** Fired rather than swung: needs ammunition, spends a shaft per attack, and
   *  its rolls carry the `ranged` sub so `roll:attack.ranged` matches.
   *
   *  Explicit, because this used to be INFERRED from `properties` containing the
   *  word "ammunition" — a magic string in a free-text list that the item form
   *  has no control for, so no weapon authored through the UI could ever be
   *  ranged. `isRanged` still falls back to that string so hand-authored data
   *  keeps working. */
  ranged?: boolean
  /** Needs BOTH hands: it claims the main hand and locks the off hand.
   *
   *  Explicit for the same reason `ranged` is (see above). The word
   *  "Two-Handed" does sit in `properties` on 454 of the catalog's 493
   *  weapons, but that list is free text the item form cannot write, so no
   *  weapon authored through the UI could ever be two-handed. `isTwoHanded`
   *  still falls back to the string so imported data works untouched. */
  twoHanded?: boolean
  properties?: string[]
}

/** An equipped weapon (lives in `equipped.weapons[]`). Item fields + weapon data.
 *  Read by the Stat Panel's Attacks widget AND the Equipment weapon list/roller. */
export type EquippedWeapon = EquippedItem & WeaponData & { category?: 'weapon' }

/** A carried (un-equipped) item. Adds WHERE it is carried.
 *
 *  `containerId` is `'person'` for the 5x4 on-person grid, otherwise the id of the
 *  container item holding it. On-person items carry real `col`/`row` (1-indexed,
 *  top-left cell); items inside a container leave them ABSENT — a list has no
 *  geometry, and sort order is a view preference, never stored state.
 *
 *  Footprint (`w`,`h`) is intrinsic and lives on EquippedItem, so it survives every
 *  move — equip, unequip, stow and retrieve all preserve it and drop only the
 *  POSITION. (A 2x1 crossbow is still 2x1 when it comes back out of the backpack.)
 *  May carry weapon data when `category === 'weapon'`. */
export type InventoryItem = EquippedItem & Partial<WeaponData> & {
  containerId: string
  col?: number; row?: number
  /** True from the moment this item is minted (shop purchase, DM grant) until
   *  the player hovers it — surfaces a "NEW" badge on the tile/row and a dot
   *  on its container's tab if that container isn't open. Persisted (not
   *  local-only) so it survives reload and follows the player across
   *  devices. An unequip never sets this — see lib/equip.ts's toCarried. */
  isNew?: boolean
}

/** Typed view onto the `equipped` JSONB: the eight worn gear slots plus the weapon
 *  list, the equipped containers, and the locked G.U.I.D.E. shard. Shared by
 *  Equipment (the loadout view) and Inventory (equip-in-place).
 *
 *  An equipped container is NOT in the inventory — like every equipped item it
 *  leaves the grid. An *unequipped* quiver is an ordinary grid item that renders its
 *  contents count in the cell, and it vanishes from the grid the moment it's worn. */
export type EquippedGear = {
  weapons?: EquippedWeapon[]
  /** Equipped containers, keyed by `container.kind` — one per kind, which is what
   *  enforces "1 backpack, 1 bag of holding, 1 sack, 1 quiver" without a slot enum. */
  containers?: Partial<Record<ContainerKind, EquippedItem | null>>
  guideShard?: EquippedItem | null
} & { [K in ItemSlot]?: EquippedItem | null }

export type ProgressStory = {
  id: string
  title: string
  label: string
  emblem: 'character' | 'main' | 'region'
  telemetry?: string
  percent: number
  chapter?: string
  tooltip?: string
}

export type CharacterProgress = {
  stories?: ProgressStory[]
}

export type Relation = {
  name: string
  /** Free text — "Ally"/"Mentor"/"Rival"/"Enigma"/etc. "System · Bonded" is the
   *  one value that gets the amber G.U.I.D.E. styling on the Lore screen. */
  type: string
  /** Absent/null → dashed amber segments + "—" label ("undefined" attitude), independent of
   *  `type`. "hostile" renders 0 lit segments too, but dashed muted (not amber) + "Hostile" —
   *  stays inside the screen's "no red" rule while staying visually distinct from "unknown". */
  attitude?: 'friendly' | 'neutral' | 'wary' | 'hostile' | null
  desc: string // markdown
}

export type CharacterLore = {
  backstory?: string // markdown, blank-line paragraphs
  personality?: { trait?: string; ideal?: string; bond?: string; flaw?: string } // markdown
  relations?: Relation[]
  /** Only fields NOT already on `identity` — race/class/archetype/background live there. */
  identity?: { alignment?: string; age?: string; height?: string; deity?: string; homeland?: string }
  memoryFidelity?: string
}

// ── Shards (`shard_tree_catalog` / `shard_tree_secrets`, migration 0008). A
//    shard tree is authored content (catalog), same snapshot-free reference
//    pattern as the rest of the catalog: the character row holds only a slot
//    id + progress, never a copy of the tree. ──

/** A single upgrade node in a shard's attunement lattice. Position is polar:
 *  `tier` is the ring (0 = core), `angle` is degrees clockwise from up — no
 *  hardcoded pixel coords, the player/editor canvases derive layout from this.
 *  `state` (locked/available/attuned) is NEVER stored — derived from `prereqs`
 *  vs. the character's `attuned` set, same rule as item attunement (equip.ts). */
export type ShardNode = {
  id: string
  name: string
  tier: number
  branch: string
  angle: number
  cost: number
  icon: string
  prereqs: string[]
  /** Player-facing prose, shown in the node detail panel. */
  effect: string
  /** Renders as "???" until every prereq is attuned. The real name/effect/mods
   *  live in `shard_tree_secrets` until the DM reveals it (Operator Console). */
  concealed?: boolean
  /** Structured buffs applied while attuned — folded into effectiveSheet(). */
  mods?: ItemEffects
  /** Features granted while attuned. Snapshot copies, same pattern as
   *  EquippedItem.features — never a bare feature_catalog reference. */
  features?: Feature[]
  detailRows?: { l: string; v: string }[]
  /** Passive flavor bullets ("Darkvision") — name + description, no
   *  mechanical effect. Shown wherever a node's grants render but
   *  deliberately NOT snapshotted as a Feature, so cosmetic fluff can't flood
   *  the player's real Features screen (lib/shards.ts shardFeatures() never
   *  reads this). Use `features` instead for anything with real game rules. */
  perks?: ShardPerk[]
  /** Variables this node introduces while ATTUNED (lib/graph.ts). Travels
   *  through `shard_tree_secrets` for a concealed node, same as `mods` and
   *  `features` — see lib/dmShards.ts splitForSave(). Shape only for now. */
  vars?: VarDef[]
  /** Free-text targeting tags. Secrets-routed for a concealed node, as above. */
  tags?: string[]
  /** Structured roll contributions while ATTUNED. Secrets-routed for a concealed
   *  node — these are mechanics, and leaking them to the public catalog row
   *  would spoil exactly what `concealed` hides. */
  graph?: GraphEffect[]
}

export type ShardPerk = { name: string; description: string; icon?: string }

/** A shard tree definition — the DM-authored content a slot references by id.
 *  `capacity` caps both how many points the DM can grant (`earned`) and how
 *  many a player can spend (`Σ attuned node cost`). */
export type ShardTree = {
  id: string
  name: string
  rarity: string
  module: string
  icon: string
  capacity: number
  published: boolean
  flavor?: string
  attuneRule?: string
  /** Applied the moment the shard is slotted, before any node is attuned. */
  baseMods?: ItemEffects
  baseFeatures?: Feature[]
  baseDetails?: { l: string; v: string }[]
  /** Passive flavor bullets granted on slot — see ShardNode.perks. */
  basePerks?: ShardPerk[]
  branches: Record<string, string>
  branchColors?: Record<string, string>
  nodes: ShardNode[]
}

/** Per-character state for one of the 3 shard slots. `slot1` is always the
 *  G.U.I.D.E. shard (`locked: true` — unequippable). `earned`/`spent` are a
 *  per-shard point pool: `spent` is NEVER stored, it's Σ cost of `attuned`
 *  nodes, so it can't drift from the attuned set (one source of truth). */
export type ShardSlot = {
  shardId: string | null
  locked?: boolean
  earned: number
  attuned: string[]
  /** DM-revealed text for concealed nodes this slot has attuned (Operator
   *  Console reveal action, Phase D). A concealed node's real name/effect
   *  live in `shard_tree_secrets`, which a player session can never read —
   *  this is the only path that text can reach the player, and only once
   *  the DM has chosen to copy it here. */
  revealed?: Record<string, { name: string; effect: string }>
}

/** The `characters.shards` JSONB column: the 3 slots by key, plus `owned` —
 *  ids of shard trees the DM has granted this character but that may not be
 *  slotted (yet, or ever again after an Eject). The player's install picker
 *  only offers `owned` shards; granting is a DM action, not player self-serve. */
export type ShardsField = Partial<Record<'slot1' | 'slot2' | 'slot3', ShardSlot>> & {
  owned?: string[]
  /** Progress benched on Eject, keyed by shard id — re-slotting the SAME
   *  shard later (Shard.tsx install / OperatorConsole ShardsTab) restores its
   *  earned/attuned exactly instead of resetting to a fresh core node. */
  bench?: Record<string, { earned: number; attuned: string[] }>
}

export type CharacterRow = {
  id: string
  owner: string
  name: string
  identity: CharacterIdentity
  sheet: CharacterSheet
  resources: Record<string, Json>
  inventory: Json[]
  equipped: Record<string, Json>
  shards: ShardsField
  spellbook: CharacterSpellbook
  lore: CharacterLore
  progress: CharacterProgress
  /** COMPILED CACHE, never a section: what other players may see, recomputed by
   *  lib/character.ts on every write and projected by list_party_roster().
   *  See lib/vitals.ts. */
  public_vitals: PublicVitals | null
  updated_at: string
}

/** The sections a screen may write. `public_vitals` is excluded on purpose — it
 *  is derived from the others, so anything calling updateSection on it would be
 *  authoring a cache by hand. */
export type CharacterSection = Exclude<
  keyof CharacterRow, 'id' | 'owner' | 'name' | 'updated_at' | 'public_vitals'
>

export type CharacterInsert = Omit<CharacterRow, 'id' | 'updated_at'> & {
  id?: string
  updated_at?: string
}
export type CharacterUpdate = Partial<Omit<CharacterRow, 'id' | 'owner'>>

/** DM-only per-character secrets (table `character_secrets`, migration 0002).
 *  Stored OFF the `characters` row so the `own_character` RLS policy can't leak
 *  them to a player — only `dm_users` can read this table at all. */
export type CharacterSecret = {
  character_id: string
  digitization: number   // 0–100 horror gauge — DM-only
  true_lore: string      // the real story behind the character — DM-only
  updated_at: string
}
export type CharacterSecretInsert = { character_id: string } & Partial<Omit<CharacterSecret, 'character_id'>>
export type CharacterSecretUpdate = Partial<Omit<CharacterSecret, 'character_id'>>

// ── Campaign-level tables (migration 0003): sessions + quests are campaign-wide,
//    NOT per-character. Quest `gm_notes` lives in `quest_secrets` (DM-only). ──
export type QuestType = 'main' | 'side'
export type QuestStatus = 'active' | 'completed' | 'failed'
export type QuestObjective = { text: string; done: boolean }
/** `url`, when present, opens in a new tab from the player Journal — e.g. a
 *  link into the DM's own world database. Optional so a tag can be a bare
 *  name with nothing to link to. */
export type RelatedTag = { name: string; url?: string }

export type QuestRow = {
  id: string
  title: string
  type: QuestType
  status: QuestStatus
  location: string
  given_by: string
  description: string        // player-facing
  objectives: QuestObjective[]
  /** Rows written before this field existed are plain strings — every reader
   *  must accept `RelatedTag | string`, never assume the object shape. */
  related: RelatedTag[]
  created_at: string         // stable list order
  updated_at: string
}
export type QuestInsert = Partial<Omit<QuestRow, 'created_at' | 'updated_at'>>
export type QuestUpdate = Partial<Omit<QuestRow, 'id'>>

/** DM-only quest notes — split off `quests` so the table stays safe to expose to
 *  players later (same pattern as [[CharacterSecret]]). */
export type QuestSecret = { quest_id: string; gm_notes: string; updated_at: string }
export type QuestSecretInsert = { quest_id: string } & Partial<Omit<QuestSecret, 'quest_id'>>
export type QuestSecretUpdate = Partial<Omit<QuestSecret, 'quest_id'>>

export type SessionRow = {
  id: string
  num: number
  title: string
  date: string
  recap: string
  events: string[]
  updated_at: string
}
export type SessionInsert = Partial<Omit<SessionRow, 'updated_at'>>
export type SessionUpdate = Partial<Omit<SessionRow, 'id'>>

// ── Item catalog (migration 0004): the DM's authoring library. Grant Item
//    snapshots a template into a player's inventory. DM-only RLS (no player
//    policy), so the catalog never reaches a player client. ──
/** A catalog template's `data`: a full item definition MINUS per-instance state
 *  (id / qty / grid position), which Grant Item stamps on at grant time. */
export type CatalogItemData = Omit<InventoryItem, 'id' | 'containerId' | 'col' | 'row' | 'qty' | 'isNew'>
export type CatalogItemRow = { id: string; data: CatalogItemData; updated_at: string }
export type CatalogItemInsert = { id?: string; data: CatalogItemData }
export type CatalogItemUpdate = { data?: CatalogItemData }

// ── Confiscated items (migration 0006): the DM-side store for items taken off a
//    character. DM-only RLS with NO player policy — that absence is what makes a
//    confiscated item invisible, rather than a client-side filter the player's
//    browser could be talked out of. ──
/** Where an item was when it was taken. The item's placement object copied verbatim
 *  — no transformation, and `col`/`row` are simply absent when it came out of a
 *  container. Restore reads this; when the placement is no longer valid (cell taken,
 *  container gone) it falls through to the normal routing chain. */
export type ConfiscatedFrom = { containerId: string; col?: number; row?: number }

export type ConfiscatedItemRow = {
  id: string
  character_id: string
  /** The item verbatim, footprint included, exactly as it will be restored. */
  item: InventoryItem
  from: ConfiscatedFrom
  /** DM-authored: why it was taken. Never shown to the player. */
  note: string
  taken_at: string
}
export type ConfiscatedItemInsert = {
  id?: string
  character_id: string
  item: InventoryItem
  from: ConfiscatedFrom
  note?: string
}

// ── Feature catalog (migration 0005): the DM's feature-authoring library.
//    Same snapshot pattern as item_catalog — items embed feature copies via the
//    item form; the DM can also grant one directly (roleplay features). ──
/** A catalog template's `data`: a Feature minus its instance id (stamped at
 *  grant/embed time along with the `feature_id` back-ref). */
export type CatalogFeatureData = Omit<Feature, 'id' | 'feature_id'>
/** `data` is the PUBLISHED content — the only thing a grant may copy. `draft`
 *  is the DM's in-progress edit, which Publish promotes into `data`. Keeping
 *  them in separate slots is what makes "nothing a player sees moves until
 *  Publish" true rather than aspirational: editing a granted feature's template
 *  never disturbs `data`. Safe as a plain column here because feature_catalog
 *  has no player policy at all (migration 0005). */
export type CatalogFeatureRow = { id: string; data: CatalogFeatureData; draft: CatalogFeatureData | null; updated_at: string }
export type CatalogFeatureInsert = { id?: string; data?: CatalogFeatureData; draft?: CatalogFeatureData | null }
export type CatalogFeatureUpdate = { data?: CatalogFeatureData; draft?: CatalogFeatureData | null }

// ── Effect catalog (migration 0013): the DM's effect-authoring library. An
//    effect DEFINITION is three things — Modifiers (numeric, `Mod[]`), Flags
//    (never numeric: advantage/resistance/immunity) and Description (prose) —
//    and nothing else. DURATION IS NOT HERE: a definition says what it does,
//    whoever applies it (an item's `effectRefs`, later a spell or the console)
//    says how long. Items reference these by id; `compileEffects` folds the
//    referenced mods into the item's own `effects: ItemEffects` at save time
//    (a compiled cache — see effectRefs on EquippedItem), so the equip/grant
//    engine keeps reading plain ItemEffects with no changes. DM-only RLS, no
//    player policy — same wall as feature_catalog. ──
export type EffectKind = 'buff' | 'debuff' | 'condition'
/** Non-numeric mechanical effects. 'advantage'/'disadvantage' target a roll
 *  (a save, a check, an attack); 'resistance'/'vulnerability'/'immunity'
 *  target a damage type. Never a number — the ItemEffects rule. */
export type EffectFlagMode = 'advantage' | 'disadvantage' | 'resistance' | 'vulnerability' | 'immunity'
export type EffectFlag = { mode: EffectFlagMode; target: string }
export type EffectDef = {
  name: string
  /** Icon name. Either a Font Awesome class (`'fa-bolt'`) or a game-icons value
   *  prefixed `gi:` (`gi:lorc/aura`). Unprefixed IS Font Awesome — that is what
   *  let both sets coexist with no migration. Render it with `<Icon>`, never by
   *  interpolating into a `fa-solid` class. */
  icon: string
  /** Drives the tint wherever this effect appears (index group, preview, item
   *  reference row). */
  kind: EffectKind
  /** Free-text, lowercase-normalised, autocompleted from tags already in use. */
  tags: string[]
  mods: Mod[]
  flags: EffectFlag[]
  /** Skills this effect makes the wearer proficient in / expert at.
   *
   *  Separate from `mods` because a Mod is a stat and a NUMBER, and "proficient
   *  in Stealth" is neither — it scales with the proficiency bonus and shows as a
   *  filled pip rather than a "+2". Compiled into `ItemEffects` on save by the
   *  item form, the same way `mods` are. */
  skillProficiencies?: string[]
  skillExpertise?: string[]
  /** Player-facing prose — the rule a modifier/flag can't express (e.g. Bless's
   *  1d4, Haste's speed ×2 and the after-effect). */
  desc: string
}
export type CatalogEffectRow = { id: string; data: EffectDef; updated_at: string }
export type CatalogEffectInsert = { id?: string; data: EffectDef }
export type CatalogEffectUpdate = { data?: EffectDef }

// ── Spell catalog (migration 0010): the DM's spell-authoring library. Same
//    snapshot pattern as feature_catalog — Grant Spell copies a template onto
//    `characters.spellbook.spells`, DM-only RLS, no player policy. Field shape
//    mirrors the DM catalog mockup (flat v/s/m/material, not a nested
//    `components` object) rather than the player-mockup's nesting — one shape,
//    no mapping layer between author and player. ──
export type SpellSchool =
  | 'Abjuration' | 'Conjuration' | 'Divination' | 'Enchantment'
  | 'Evocation'  | 'Illusion'    | 'Necromancy'  | 'Transmutation'

/** A single spell, on a character's spellbook. `dice`/`scaling` are authored
 *  free text (e.g. "8d6" / "1d6") and parsed at render (lib/spells.ts) — never
 *  stored pre-parsed, so an author typo shows as un-rollable text instead of
 *  corrupting the template. Cantrips scale by CHARACTER level (CLAUDE.md), not
 *  `scaling` per upcast level — `scaling` still applies to cantrips, just
 *  keyed by level tier (1/5/11/17) instead of chosen cast level. */
export type Spell = {
  id: string
  /** Back-reference to the `spell_catalog` template this was granted from. */
  spell_id?: string
  /** Set when a feature granted this spell (e.g. "cast Sanctuary at will").
   *  Shape only for now — no authoring UI grants this yet; see `atWill`. */
  feature_id?: string
  /** Feature-granted at-will cast: never spends a slot, regardless of level.
   *  Shape only for now — no UI sets this yet. */
  atWill?: boolean
  name: string
  level: number  // 0 = cantrip
  school: SpellSchool
  castingTime: string
  range: string
  v: boolean
  s: boolean
  m: boolean
  material?: string
  duration: string
  concentration: boolean
  ritual: boolean
  /** Player-facing prose; supports the app's lightweight markdown (lib/markdown.ts). */
  desc: string
  /** FA icon class override (e.g. "fa-fire"). Absent = derived from `school`
   *  (SCHOOL_ICON map, Spellbook.tsx/OperatorConsole.tsx). */
  icon?: string
  /** CSS color for the icon (e.g. "#e2701c"). Absent = the default cyan. */
  iconColor?: string
  /** The ability the TARGET rolls to resist this spell — Fireball is `dex`,
   *  Hold Person `wis`. Presence means "this spell calls for a save"; absent is
   *  a spell that does not, so the roll panel shows a DC only when there is one.
   *
   *  NOT the caster's spellcasting ability, which a spell never names — that is
   *  the class's, and it sets the DC rather than the save. The DC lives once on
   *  `spellbook.saveDC` (8 + prof + that ability), which is why the same spell
   *  is a different DC from a Warlock than from a Wizard. A per-spell copy would
   *  be a second record free to disagree. */
  save?: AbilityKey
  hasDamage: boolean
  dice?: string      // e.g. "8d6", "3d4+3"
  scaling?: string   // added per upcast level (levelled) or per tier (cantrip)
  dmgType?: string
  /* NO dmgColor. The damage display's colour comes from `dmgType` through
     lib/palette.ts, the same place the roll context panel and `[text]{fire}`
     prose ask. An authored per-spell hex was a second record of "what colour is
     fire", and the two disagreed on screen — orange in the Grimoire, red in the
     panel — for exactly as long as it existed. */
  /** Whether this spell can be cast at a level above its own. Absent = `true`.
   *  `false` = no upcast stepper on the player screen at all (control is
   *  ABSENT, not disabled) — some spells simply do nothing on upcast. */
  canUpcast?: boolean
  /** Authored ceiling on the upcast level, independent of owned slots — e.g.
   *  cap a spell at level 4 even if the caster owns 5th-level slots. Absent =
   *  no extra cap (bounded only by owned slots, `lib/spells.ts` maxCastLevel).
   *  Ignored when `canUpcast` is `false`. */
  maxUpcastLevel?: number
  /** Per-character state. Ignored for cantrips (always effectively prepared). */
  prepared?: boolean
  /** Adds a "cast on party member" button + target picker on the player screen.
   *  Absent/false = no button, the rest of these fields are unused. */
  partyCastable?: boolean
  /** 'heal' rolls `healDice` onto the target's HP; 'effect' pushes a flavor-only
   *  status (no numeric modifiers — see ItemEffects) onto their active effects.
   *  Meaningful only when `partyCastable`. */
  partyCastMode?: 'heal' | 'effect'
  /** Heal-mode dice expression, e.g. "1d8 + 3". Rolled client-side (lib/dice.ts
   *  rollHeal), same as a consumable's `heal` field — no upcast scaling. */
  healDice?: string
  /** Effect-mode status-chip color family. Absent = 'buff'. */
  effectTone?: 'buff' | 'cond' | 'debuff'
  /** Effect-mode free-text flavor shown on the status chip (e.g. "speed x2,
   *  extra action") — deliberately not modelled as numbers (ItemEffects doc). */
  effectNote?: string
  /** Variables this spell introduces while in the book (lib/graph.ts). Shape
   *  only for now — no authoring UI writes it yet. */
  vars?: VarDef[]
  /** Free-text targeting tags, normalised on save (lib/graph.ts normalizeTag). */
  tags?: string[]
  /** Structured roll contributions. */
  graph?: GraphEffect[]
}

export type SpellSlot = { level: number; total: number; expended: number }

/** The `characters.spellbook` JSONB column. `preparedMax` is authored (DM);
 *  prepared *count* is DERIVED by counting `spells` with `level>0 && prepared`
 *  — never stored, so it can't drift from the per-spell flags (CLAUDE.md).
 *
 *  `preparesSpells` distinguishes the two 5e casting styles: PREPARED casters
 *  (Wizard, Cleric, Druid, Paladin) choose a daily subset of their known
 *  spells to ready; KNOWN casters (Sorcerer, Bard, Ranger, Warlock, …) have
 *  every spell they know available at all times — there is no prep step, no
 *  cap, and no Prepare/Unprepare control. Absent = `true` (prepared caster),
 *  matching the original Wizard-only behavior before this field existed.
 *  `lib/spells.ts`'s `isPrepared()` is the one place that resolves a spell's
 *  effective prepared state from this flag — read that, never `spell.prepared`
 *  directly, so a known caster's spells always read "ready" regardless of the
 *  stored per-spell flag.
 *
 *  `pactMagic` is the Warlock special case: Pact Magic slots are ALL the same
 *  level (not a ladder like `slots[]`), that level and the slot COUNT are
 *  both pure functions of character level (`lib/spells.ts` `pactSlotLevel`/
 *  `pactSlotCount` — the same derivation as cantrip scaling, nothing DM-
 *  authored), and they refresh on a SHORT rest, not just a long one. `slots`
 *  is ignored entirely when this is set; `pactExpended` is the only mutable
 *  state (how many of the derived slots are currently spent). A pact caster
 *  is always Known-style — `preparesSpells()` returns false whenever this is
 *  set, regardless of the `preparesSpells` field. */
export type CharacterSpellbook = {
  spellcasting?: boolean
  class?: string
  ability?: AbilityKey | Uppercase<AbilityKey>
  saveDC?: number
  attackBonus?: number
  preparesSpells?: boolean
  preparedMax?: number
  /** Always all 9 entries (levels 1..9) when present, even at total:0.
   *  Ignored when `pactMagic` is set. */
  slots?: SpellSlot[]
  pactMagic?: boolean
  pactExpended?: number
  spells?: Spell[]
}

/** A catalog template's `data`: a Spell minus per-character instance fields
 *  (id / spell_id / feature_id / atWill / prepared), stamped on at grant time. */
export type CatalogSpellData = Omit<Spell, 'id' | 'spell_id' | 'feature_id' | 'atWill' | 'prepared'>
export type CatalogSpellRow = { id: string; data: CatalogSpellData; updated_at: string }
export type CatalogSpellInsert = { id?: string; data: CatalogSpellData }
export type CatalogSpellUpdate = { data?: CatalogSpellData }

// ── Class catalog (migration 0016): the DM's class-authoring library. Same
//    DM-only RLS + draft-column pattern as feature_catalog (0005/0014) — a
//    class reaches a player only through the Assign Class card, which SNAPSHOTS
//    what it grants onto the character exactly the way every other grant does.
//
//    TWO THINGS ARE DELIBERATELY ABSENT and should stay that way:
//
//    * No spell-slot table. Full/half/third slots are DERIVED from `caster` and
//      character level (lib/classes.ts casterSlots), pact slots from
//      lib/spells.ts pactSlotCount/pactSlotLevel. Authoring the SRD progression
//      would be a second answer to a settled question.
//    * No per-level progression grid. A level is a gate condition on a feature
//      reference (`when: "level >= 3"`), evaluated by the same lib/expr.ts
//      engine that already reads GraphEffect.when, or a level-indexed derived
//      variable. A twenty-row table would duplicate both. ──

/** How a class gets its slots. 'none' is a martial class; 'pact' is
 *  structurally different from the other three rather than a variation of them
 *  — one slot level, a count of at most four, refreshed on a SHORT rest. */
export type ClassCasterType = 'none' | 'full' | 'half' | 'third' | 'pact'

/** One item an option hands over, by catalog id. */
export type EquipRef = { item_id: string; qty: number }

/** "a martial weapon" — the class names a POOL and the player picks from it.
 *
 *  `from` is a catalog query in the same syntax the item index and the graph's
 *  tag selectors use (lib/catalogSearch.ts): plain text matches name or tag,
 *  `tag:martial` narrows to tags. Resolved against the catalog at ASSIGN, like
 *  everything else here, because the player cannot read item_catalog. */
export type EquipPick = { pick: number; from: string; label?: string }

/** Either an exact item or a pool to choose from. `pick` is the discriminator —
 *  an entry without it is a plain item, which is what every entry authored
 *  before pools existed already is. */
export type EquipEntry = EquipRef | EquipPick
export const isEquipPick = (e: EquipEntry): e is EquipPick =>
  typeof (e as EquipPick).pick === 'number'

/** One branch of a decision — "(a) scale mail". `id` is stable so a kit already
 *  parked on a character survives the class being re-authored. */
export type EquipOption = { id: string; label: string; items: EquipEntry[] }
/** One decision the player makes. One option = a fixed grant, no question asked. */
export type EquipChoice = { id: string; label: string; options: EquipOption[] }

/** A feature a class OR A RACE grants, and when.
 *
 *  A REFERENCE, not a snapshot: the row stores only the feature_catalog id, so
 *  re-authoring Second Wind updates every class that grants it. Deliberately
 *  unlike the shard editor's FeaturesWidget, which snapshots — a shard node
 *  carries one or two features and a class carries forty, and the DM edits them
 *  continuously while the campaign runs. */
export type FeatureGrantRef = {
  feature_id: string
  /** Boolean expression over the same scope as GraphEffect.when (lib/expr.ts —
   *  `level` is already whitelisted in VAR_IDENTS). Absent = granted from level
   *  1. This is where a class's progression lives; see the note above. */
  when?: string
}

export type ClassDef = {
  name: string
  /** Icon name. Either a Font Awesome class (`'fa-shield-halved'`) or a game-icons value
   *  prefixed `gi:` (`gi:lorc/aura`). Unprefixed IS Font Awesome — that is what
   *  let both sets coexist with no migration. Render it with `<Icon>`, never by
   *  interpolating into a `fa-solid` class. */
  icon: string
  /** Tint for the index row and the granted carrier feature's card, same role
   *  Feature.color plays. */
  color?: string
  /** Player-facing prose (EB Garamond), markdown as everywhere else. */
  desc: string
  hitDie: 6 | 8 | 10 | 12
  primaryAbility: AbilityKey
  /** Exactly two — the editor's audit blocks Publish otherwise. */
  saveProficiencies: AbilityKey[]
  /** Keys from lib/dnd.ts SKILLS the player may choose from, and how many they
   *  pick. The chosen ones are the PLAYER's answer, so assigning a class never
   *  writes sheet.skillProficiencies — it surfaces the list for the DM to tick. */
  skillChoices: string[]
  skillChooseN: number
  /** The SAME type the character sheet stores (sheet.proficiencies), so Assign
   *  writes it straight through with no mapping layer to drift. */
  proficiencies: Proficiencies
  /** The starting kit as a list of DECISIONS, not a flat list — 5e hands you
   *  "(a) scale mail or (b) leather armour, a longbow and 20 arrows", and the
   *  player picks. A fixed grant is simply a group with one option.
   *
   *  Authored as REFERENCES into item_catalog. The snapshot happens at assign
   *  (lib/kit.ts snapshotKit), because a player cannot read item_catalog at
   *  all — it has no player policy — so a reference parked on their sheet
   *  would resolve to nothing on the screen where they choose. */
  startingEquipment: EquipChoice[]
  caster: ClassCasterType
  /** Backs the save DC and the spell attack bonus. Required once `caster` is
   *  anything but 'none' — which the audit enforces. */
  castingAbility?: AbilityKey
  features: FeatureGrantRef[]
  /** Free-text targeting tags, normalised on save (lib/graph.ts normalizeTag). */
  tags: string[]
  /** The class's SHARED variables — a save DC, a path counter. Reaches the
   *  engine on the carrier feature Assign writes (lib/classes.ts assignClass). */
  vars: VarDef[]
  graph: GraphEffect[]
  /** Set on a SUBCLASS: the id of the class it belongs to. A row with a parent
   *  inherits hit die, saves and skill choices from it, and the editor hides
   *  those fields rather than offering an override nothing reads. */
  parent?: string
  /** Set on a PARENT class: the level at which the player picks a subclass, and
   *  what that decision is called in this world ("Martial Archetype", "Arbiter
   *  Path"). Absent = this class has no subclasses. */
  subclassLevel?: number
  subclassLabel?: string
  /** False/absent = draft; the Assign picker hides it. Same gate as a feature. */
  published?: boolean
}

/** A race, and — with `parent` set — a subrace.
 *
 *  Structurally the class's twin, minus everything that is the class's answer
 *  (hit die, saving throws, spellcasting) and minus every number that is now a
 *  `boost` rule instead of a field. See migration 0017 for why. */
export type RaceDef = {
  name: string
  icon: string
  color?: string
  /** Player-facing prose (EB Garamond), markdown as everywhere else. */
  desc: string
  /** Set on a SUBRACE: the id of the race it belongs to. */
  parent?: string
  /** Set on a PARENT race: what choosing a subrace is called ("Elf Lineage").
   *  Absent = this race has no subraces, and Assign asks nothing. */
  subraceLabel?: string
  /** Keys from lib/dnd.ts SKILLS the player may choose from, and how many. The
   *  pick is the PLAYER's, so assigning parks it exactly as a class does. */
  skillChoices: string[]
  skillChooseN: number
  /** Languages every member of this race speaks, plus how many more they pick.
   *  Written straight into sheet.proficiencies.languages by Assign. */
  languages: string[]
  languageChooseN: number
  /** Armour/weapon/tool training. The SAME type the sheet stores, merged key by
   *  key so a class's grants and a race's grants coexist. */
  proficiencies: Proficiencies
  features: FeatureGrantRef[]
  tags: string[]
  vars: VarDef[]
  /** Where a race's NUMBERS live — `boost` rules for +2 DEX, speed, darkvision.
   *  Not fields: a boost layers through effectiveSheet and comes back off when
   *  the race changes, which a written field could never do. */
  graph: GraphEffect[]
  published?: boolean
}

/** One line of a loot table: something that MIGHT be there, with its own
 *  quantity range and its own chance. Rows roll INDEPENDENTLY (lib/loot.ts) —
 *  the chances are not a distribution and do not sum to 100. */
export type LootRow =
  | { kind: 'item'; item_id: string; min: number; max: number; chance: number }
  | { kind: 'coin'; coin: 'gold' | 'silver' | 'copper'; min: number; max: number; chance: number }
  /** "a martial weapon, but not a relic" — the row names a QUERY instead of an
   *  item, and the roll picks ONE match at random. `from` is the same grammar
   *  the search boxes and starting-kit pools use (lib/catalogSearch.ts), so
   *  tagging the martial weapons once serves every table that wants one.
   *
   *  Resolved at ROLL time, never stored: a table that says "a martial weapon"
   *  should pick up a weapon added to the catalog next month without being
   *  re-authored. That is the whole reason it is a query and not a hand-picked
   *  list the DM has to maintain. */
  | { kind: 'pool'; from: string; min: number; max: number; chance: number }

/** A named, reusable roll table: a chest, a knight's corpse, a bookshelf.
 *
 *  The container chrome (`icon`/`kind`/`name`/`location`/`desc`) is what the
 *  PLAYER sees when a roll is pushed to them, so all of it is player-facing —
 *  it is the thing they open, not an authoring label. */
export type LootTable = {
  name: string
  icon: string
  /** What kind of container this is — "Corpse", "Chest", "Bookshelf",
   *  "Reliquary". FREEFORM on purpose: a fixed list would need a migration
   *  every time the campaign meets a new thing worth looting, and the value is
   *  only ever displayed, never branched on. */
  kind?: string
  /** Where it was found — "Sunken Hold · Deck Three". Optional; the player
   *  header omits the line entirely when it is blank. */
  location?: string
  /** Player-facing prose, shown in the loot takeover's header when the roll is
   *  pushed. NOT a DM note — it used to be one, and nothing rendered it. */
  desc?: string
  rows: LootRow[]
  published?: boolean
}

/** The container chrome, snapshotted onto an open roll (migration 0020).
 *  Copied rather than referenced because players cannot read `loot_catalog` —
 *  the table's `draft` column is only safe while no player policy exists. */
export type LootContainer = {
  icon: string
  name: string
  kind?: string
  location?: string
  desc?: string
}

/** One rolled line the party can see. */
export type LootOpenLine = {
  /** Stable per line, so assigning survives a re-render and a reorder. */
  key: string
  item_id: string
  /** Snapshot of the catalog item — `item_catalog` is DM-only (0004), so this
   *  is the only way the player's grid can render a name, icon or rarity. */
  item: CatalogItemData
  qty: number
  /** characters.id, or null while unclaimed. */
  assigned_to?: string | null
  /** Denormalised on purpose: a player cannot read another character's row, so
   *  the name has to travel with the line for the "→ ROS" chip to render. */
  assigned_name?: string | null
}

/** A roll the DM has taken out of the library. `is_open` gates the player's
 *  read entirely (0020); `open_for` null means the whole party. */
export type LootOpenRow = {
  id: string
  table_id: string | null
  container: LootContainer
  lines: LootOpenLine[]
  is_open: boolean
  open_for: string | null
  created_at: string
  updated_at: string
}
export type LootOpenInsert = {
  table_id?: string | null
  container: LootContainer
  lines: LootOpenLine[]
  is_open?: boolean
  open_for?: string | null
}
export type LootOpenUpdate = {
  lines?: LootOpenLine[]
  is_open?: boolean
  open_for?: string | null
}

export type CatalogLootRow = { id: string; data: LootTable; draft: LootTable | null; updated_at: string }
export type CatalogLootInsert = { id?: string; data?: LootTable; draft?: LootTable | null }
export type CatalogLootUpdate = { data?: LootTable; draft?: LootTable | null }

/** A BACKGROUND (migration 0021) — the third template of the same kind, after
 *  class and race.
 *
 *  Every part of an SRD 5.2 background maps onto machinery that already exists,
 *  which is why this type introduces no new concepts:
 *
 *    ability increases  -> `graph` boost rules, exactly as a racial +2 DEX is,
 *                          so they layer through effectiveSheet and come back
 *                          off when the background changes
 *    proficiencies      -> the same Proficiencies shape the sheet stores
 *    the granted feat   -> `features`, a FeatureGrantRef into feature_catalog
 *    starting equipment -> `equipment`, the CLASS KIT's EquipChoice structure,
 *                          so the pending-kit flow resolves it with no new
 *                          player-side UI
 */
export type BackgroundDef = {
  name: string
  icon: string
  /** Player-facing prose (EB Garamond), markdown as everywhere else. */
  desc: string
  /** The three abilities the SRD offers to spend the increase across. Display
   *  and authoring only — the actual increase is a `boost` in `graph`, because
   *  a written number could not be un-written when the background changes. */
  abilityOptions?: AbilityKey[]
  /** Skills this background grants outright (SRD grants two named ones), plus
   *  how many further the player picks. Same pair as RaceDef. */
  skills: string[]
  skillChooseN: number
  /** Armour/weapon/tool/language training, merged key by key onto the sheet. */
  proficiencies: Proficiencies
  /** SRD backgrounds grant exactly one feat; plural because nothing about the
   *  shape needs to assume that. */
  features: FeatureGrantRef[]
  /** Starting gear. SRD backgrounds are all "Choose A or B", which is one
   *  EquipChoice with two options — the same structure a class kit uses. */
  equipment: EquipChoice[]
  tags: string[]
  vars: VarDef[]
  /** Where a background's NUMBERS live — the ability increases, and anything
   *  else a DM adds. Boost rules, never written fields. */
  graph: GraphEffect[]
  published?: boolean
  /** Provenance, when imported. See CatalogItemData.srd_key. */
  source?: 'srd'
  srd_key?: string
  modified?: boolean
}

export type CatalogBackgroundRow = { id: string; data: BackgroundDef; draft: BackgroundDef | null; updated_at: string }
export type CatalogBackgroundInsert = { id?: string; data?: BackgroundDef; draft?: BackgroundDef | null }
export type CatalogBackgroundUpdate = { data?: BackgroundDef; draft?: BackgroundDef | null }

export type CatalogRaceRow = { id: string; data: RaceDef; draft: RaceDef | null; updated_at: string }
export type CatalogRaceInsert = { id?: string; data?: RaceDef; draft?: RaceDef | null }
export type CatalogRaceUpdate = { data?: RaceDef; draft?: RaceDef | null }

export type CatalogClassRow = { id: string; data: ClassDef; draft: ClassDef | null; updated_at: string }
export type CatalogClassInsert = { id?: string; data?: ClassDef; draft?: ClassDef | null }
export type CatalogClassUpdate = { data?: ClassDef; draft?: ClassDef | null }

// ── Shard tree catalog (migration 0008). Unlike item/feature catalog this table
//    DOES carry a player policy (published rows only) — the tree has to render
//    on the player's Shard screen. `shard_tree_secrets` is the DM-only half:
//    every `dm` note, plus a concealed node's real name/effect/mods, so a
//    concealed node ships to the client as bare geometry (id/tier/angle/cost/
//    prereqs) with nothing to spoil. Same wall as quest_secrets. ──
export type ShardTreeCatalogRow = { id: string; data: ShardTree; updated_at: string }
export type ShardTreeCatalogInsert = { id?: string; data: ShardTree }
export type ShardTreeCatalogUpdate = { data?: ShardTree }

export type ShardTreeSecretData = {
  dm?: string
  nodes?: Record<string, { name: string; effect: string; dm?: string; mods?: ItemEffects; features?: Feature[]; perks?: ShardPerk[]; vars?: VarDef[]; tags?: string[]; graph?: GraphEffect[] }>
  /** The DM's in-progress edit of the WHOLE tree — "Save Draft".
   *
   *  It lives here, and not as a column on shard_tree_catalog, because RLS is
   *  row-level: `player_read_published_shards` (migration 0008) grants players
   *  SELECT on the catalog row, so any column added there is a column they can
   *  read. This table has no player policy at all, for the same reason concealed
   *  node text already lives in it.
   *
   *  Stored MERGED (concealed text and dm notes inline, exactly as the editor
   *  holds it) rather than split — splitForSave exists to protect the player
   *  catalog, and nothing here is player-readable. */
  draft?: ShardTreeDraft
}
/** An EditorTree, structurally. Declared here rather than imported from
 *  lib/dmShards so the stored shape stays defined alongside everything else
 *  that is stored. */
export type ShardTreeDraft = Omit<ShardTree, 'nodes'> & { dm?: string; nodes: (ShardNode & { dm?: string })[] }
export type ShardTreeSecretRow = { shard_id: string; data: ShardTreeSecretData; updated_at: string }
export type ShardTreeSecretInsert = { shard_id: string; data?: ShardTreeSecretData }
export type ShardTreeSecretUpdate = { data?: ShardTreeSecretData }

// ── Shop catalog (migration 0009): the DM's shopkeeper library. Stock lives ON
//    the template — buying decrements `data.stock[i].qty` permanently, no
//    separate "opening" table, so re-firing the same shop resumes wherever the
//    last one left off. `is_open`/`open_for` are real columns (not buried in
//    `data`) because RLS keys off them: the player policy (0009) returns a row
//    only while it's open, and only for the targeted PC — `open_for` null
//    means the whole party. ──
export type ShopStockMode = 'unlimited' | 'limited'

/** One line of shop stock. `item` is a SNAPSHOT of the item_catalog template's
 *  `data`, taken when the DM adds it — item_catalog is DM-only RLS (0004) and
 *  the player client never reads it, so the snapshot is the only way the stock
 *  grid can render a name/icon/rarity. `item_id` is the stable key `shop_buy`
 *  identifies this line by; the array index isn't, since it shifts when the
 *  DM reorders stock. */
export type ShopStockLine = {
  item_id: string
  /** A per-shop override — starts at the catalog item's `value` but is
   *  editable independently, same as the mockup's price input. Denominated
   *  in `unit`. */
  price: number
  /** Denomination `price` is stated in. Absent = 'gp' (pre-existing rows keep
   *  working with no migration) — must match `shop_buy`'s (migration 0009)
   *  cp multiplier exactly, see coins.ts's header comment. */
  unit?: 'gp' | 'sp' | 'cp'
  mode: ShopStockMode
  /** Ignored (treated as bottomless) when `mode` is 'unlimited'. */
  qty: number
  item: CatalogItemData
}

export type Shop = {
  name: string
  icon: string
  location: string
  /** Optional header chips (mockup: "guide-hud/project/G.U.I.D.E. Shop.html").
   *  Both blank = chip omitted, same convention as `location`. */
  keeper?: string
  hours?: string
  /** Player-facing prose, shown in the takeover header when the shop opens. */
  desc: string
  stock: ShopStockLine[]
}

export type ShopCatalogRow = { id: string; data: Shop; is_open: boolean; open_for: string | null; updated_at: string }
export type ShopCatalogInsert = { id?: string; data: Shop; is_open?: boolean; open_for?: string | null }
export type ShopCatalogUpdate = { data?: Shop; is_open?: boolean; open_for?: string | null }

export type Database = {
  public: {
    Tables: {
      item_catalog: {
        Row: CatalogItemRow
        Insert: CatalogItemInsert
        Update: CatalogItemUpdate
        Relationships: []
      }
      feature_catalog: {
        Row: CatalogFeatureRow
        Insert: CatalogFeatureInsert
        Update: CatalogFeatureUpdate
        Relationships: []
      }
      effect_catalog: {
        Row: CatalogEffectRow
        Insert: CatalogEffectInsert
        Update: CatalogEffectUpdate
        Relationships: []
      }
      spell_catalog: {
        Row: CatalogSpellRow
        Insert: CatalogSpellInsert
        Update: CatalogSpellUpdate
        Relationships: []
      }
      class_catalog: {
        Row: CatalogClassRow
        Insert: CatalogClassInsert
        Update: CatalogClassUpdate
        Relationships: []
      }
      background_catalog: {
        Row: CatalogBackgroundRow
        Insert: CatalogBackgroundInsert
        Update: CatalogBackgroundUpdate
        Relationships: []
      }
      race_catalog: {
        Row: CatalogRaceRow
        Insert: CatalogRaceInsert
        Update: CatalogRaceUpdate
        Relationships: []
      }
      loot_catalog: {
        Row: CatalogLootRow
        Insert: CatalogLootInsert
        Update: CatalogLootUpdate
        Relationships: []
      }
      loot_open: {
        Row: LootOpenRow
        Insert: LootOpenInsert
        Update: LootOpenUpdate
        Relationships: []
      }
      characters: {
        Row: CharacterRow
        Insert: CharacterInsert
        Update: CharacterUpdate
        Relationships: []
      }
      dm_users: {
        Row: { user_id: string }
        Insert: { user_id: string }
        Update: { user_id?: string }
        Relationships: []
      }
      character_secrets: {
        Row: CharacterSecret
        Insert: CharacterSecretInsert
        Update: CharacterSecretUpdate
        Relationships: []
      }
      sessions: {
        Row: SessionRow
        Insert: SessionInsert
        Update: SessionUpdate
        Relationships: []
      }
      quests: {
        Row: QuestRow
        Insert: QuestInsert
        Update: QuestUpdate
        Relationships: []
      }
      quest_secrets: {
        Row: QuestSecret
        Insert: QuestSecretInsert
        Update: QuestSecretUpdate
        Relationships: []
      }
      confiscated_items: {
        Row: ConfiscatedItemRow
        Insert: ConfiscatedItemInsert
        Update: Partial<Omit<ConfiscatedItemRow, 'id'>>
        Relationships: []
      }
      shard_tree_catalog: {
        Row: ShardTreeCatalogRow
        Insert: ShardTreeCatalogInsert
        Update: ShardTreeCatalogUpdate
        Relationships: []
      }
      shard_tree_secrets: {
        Row: ShardTreeSecretRow
        Insert: ShardTreeSecretInsert
        Update: ShardTreeSecretUpdate
        Relationships: []
      }
      shop_catalog: {
        Row: ShopCatalogRow
        Insert: ShopCatalogInsert
        Update: ShopCatalogUpdate
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      /** Migration 0009's server-side purchase check — see the migration's
       *  header comment for why this can't be a plain client UPDATE. */
      shop_buy: { Args: { p_shop_id: string; p_item_id: string }; Returns: Json }
      /** Migration 0009's atomic "close every shop, open this one" — see its
       *  header comment for why two separate client UPDATEs can't guarantee
       *  at most one shop open. */
      shop_open: { Args: { p_id: string; p_character_id: string | null }; Returns: undefined }
      /** Migration 0011's minimal party roster (id/name/race/class/level/hp
       *  only) — see the migration's header comment for why this exists
       *  instead of a broad player SELECT policy on `characters`. */
      list_party_roster: { Args: Record<string, never>; Returns: Json }
      /** Migration 0011's only path that can write another PC's HP or
       *  activeEffects — see the migration's header comment. */
      cast_party_effect: { Args: { p_target: string; p_heal: number | null; p_effect: Json | null }; Returns: Json }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
