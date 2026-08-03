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
}

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

export type CharacterRow = {
  id: string
  owner: string
  name: string
  identity: CharacterIdentity
  sheet: CharacterSheet
  resources: Record<string, Json>
  inventory: Json[]
  equipped: Record<string, Json>
  shards: Record<string, Json>
  spellbook: Record<string, Json> & { spellcasting?: boolean }
  lore: Record<string, Json>
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
export type CatalogItemData = Omit<InventoryItem, 'id' | 'containerId' | 'col' | 'row' | 'qty'>
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
