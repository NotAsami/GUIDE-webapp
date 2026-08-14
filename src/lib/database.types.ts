/**
 * Hand-written types for the Phase 0 schema (supabase/migrations/0001_init.sql).
 * Replace with `supabase gen types typescript` output once the CLI is wired in.
 *
 * Implementation note: we use `type` aliases (not interfaces) so the row shapes
 * satisfy supabase-js's `Record<string, unknown>` generic constraint — interfaces
 * fail that check because they're open to declaration merging.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type CharacterIdentity = {
  race?: string
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
  /** Flat per-ability saving-throw bonuses. May be authored (a feat) OR injected
   *  by effect layering (lib/effects.ts); read by dnd.ts saveTotal. */
  saveBonuses?: Partial<Record<AbilityKey, number>>
  /** Flat per-skill bonuses (keyed by skill key). Authored or effect-injected;
   *  read by dnd.ts skillTotal. */
  skillBonuses?: Partial<Record<string, number>>
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
  /** Font Awesome icon name, e.g. 'fa-wind'. */
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
}

/** A CharacterSheet with equipped-item effects already layered in (lib/effects.ts).
 *  Branded distinct from CharacterSheet so it's visible at call sites that this is
 *  DERIVED, display-only data — it must never be written back to the DB (that would
 *  persist item-boosted scores as the new base, and unequip couldn't undo it). */
export type EffectiveSheet = CharacterSheet & { readonly __effective: true }

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary'

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
  /** Flat saving-throw bonus: a number applies to ALL saves; object = per-ability. */
  saves?: number | Partial<Record<AbilityKey, number>>
  /** Flat per-skill bonus, keyed by skill key (see lib/dnd.ts SKILLS). */
  skills?: Partial<Record<string, number>>
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
  updated_at: string
}

export type CharacterSection = Exclude<keyof CharacterRow, 'id' | 'owner' | 'name' | 'updated_at'>

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
export type CatalogFeatureRow = { id: string; data: CatalogFeatureData; updated_at: string }
export type CatalogFeatureInsert = { id?: string; data: CatalogFeatureData }
export type CatalogFeatureUpdate = { data?: CatalogFeatureData }

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
  /** Font Awesome icon name, e.g. 'fa-bolt'. */
  icon: string
  /** Drives the tint wherever this effect appears (index group, preview, item
   *  reference row). */
  kind: EffectKind
  /** Free-text, lowercase-normalised, autocompleted from tags already in use. */
  tags: string[]
  mods: Mod[]
  flags: EffectFlag[]
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
  hasDamage: boolean
  dice?: string      // e.g. "8d6", "3d4+3"
  scaling?: string   // added per upcast level (levelled) or per tier (cantrip)
  dmgType?: string
  /** CSS color for the damage display (expression, roll card, max-die glow).
   *  Absent = the default cyan. */
  dmgColor?: string
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
  nodes?: Record<string, { name: string; effect: string; dm?: string; mods?: ItemEffects; features?: Feature[]; perks?: ShardPerk[] }>
}
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
