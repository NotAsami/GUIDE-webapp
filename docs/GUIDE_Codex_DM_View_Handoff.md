# G.U.I.D.E. Codex — DM View (Operator Console) Build Handoff

Companion to `GUIDE_Codex_Build_Handoff.md`. That doc covers the player side and the
core `characters` schema; this one covers the **DM View / Operator Console** — the
cross-character admin layer — plus the campaign-level and catalog data it introduces.

**The mockup is the visual + interaction reference** (`G_U_I_D_E__Operator_Console.html`,
single-file vanilla HTML/CSS/JS). This doc is the **data contract** and the set of
things to get right when porting it to React + Supabase. Every SAVE / APPLY / grant in
the mockup is a `console.log` + in-memory mutation; the wiring is the build job.

This is **Phase 2** in the agreed build order: DM View + the live catalog + the
grant → player-toast realtime hook.

---

## 1. Data shapes

Types are TypeScript interfaces because the stack is TS. Field names match the mockup's
data objects so you can cross-reference. Where a section already exists in the player
schema (`sheet`, `resources`, `lore`), these extend it rather than duplicating.

### Character (per-character) — mockup `PARTY`
```ts
interface Character {
  id: string;
  name: string;
  race: string;
  cls: string;            // class
  sub: string;            // subclass
  level: number;
  icon: string;           // UI placeholder; real app uses a portrait
  hp: number;             // -> sheet.hp.current
  hpMax: number;          // -> sheet.hp.max
  tempHp: number;
  gold: number;
  online: boolean;        // realtime presence
  digitization: number;   // 0–100. DM-ONLY horror gauge — never exposed to player
  effects: ActiveEffect[];
  // status (DM-writable; mirrors the player Stat Panel read-only display) -> resources
  deathS: [boolean, boolean, boolean];  // death-save successes
  deathF: [boolean, boolean, boolean];  // death-save failures
  exh: number;            // exhaustion 0–6
  lore: Lore;
}
interface ActiveEffect { name: string; kind: 'buff' | 'cond' | 'debuff'; dur: string; }
```

### Lore (per-character) — mockup `LORE_SEED`
```ts
interface Lore {
  backstory: string;                          // player-facing
  personality: { trait: string; ideal: string; bond: string; flaw: string };
  relations: Relation[];
  identity: { background: string; alignment: string; age: string;
              height: string; homeland: string; deity: string };
  portrait: string | null;
  memoryFidelity: 'INTACT'|'PARTIAL'|'DEGRADED'|'FRAGMENTED'|'CORRUPTED'; // horror seed
  trueLore: string;                           // DM-ONLY — never sent to player
}
interface Relation {
  name: string;
  type: 'Ally'|'Mentor'|'Rival'|'Enigma'|'System · Bonded'; // System·Bonded = G.U.I.D.E.
  attitude: 'friendly' | 'neutral' | 'wary';
  desc: string;
}
```

### Item (catalog / global) — mockup `CATALOG_ITEMS`
```ts
interface Item {
  id: string;
  name: string;
  category: 'weapon'|'armor'|'consumable'|'tool'|'quest'|'misc';
  rarity: 'common' | 'uncommon' | 'rare' | 'quest';
  w: number; h: number;        // inventory-grid footprint
  icon: string;
  weight: string;              // e.g. "0.5 lb"
  value: number;               // gold
  equippable: boolean;
  slot: 'helmet'|'armor'|'cloak'|'boots'|'accessory'|'quick-access'|'weapon';
  attunement: boolean;
  desc: string;                // player-facing
  effects: { stat: string; val: string }[];  // numeric/flag modifier stack
  duration: string;            // e.g. "Permanent while equipped", "Hours"
  featureIds: string[];        // references into the Feature library -> Gear Features
}
```
`effect.stat ∈ STR…CHA, AC, HP, Max HP, Speed, Attack, Damage, Save DC, Flag`; `val` is
either a modifier (`"+3"`) or, for `Flag`, a phrase (`"Advantage on saves vs poison"`).

### Spell (catalog / global) — mockup `CATALOG_SPELLS`
Mirrors the player Spellbook detail panel: `name`, `level` (0 = cantrip), `school`,
`castingTime`, `range`, components (`v`/`s`/`m` + `material`), `duration`,
`concentration`, `ritual`, `desc`, optional damage (`dice`, per-level `scaling`,
`type`). Confirm exact field names against `CATALOG_SPELLS` in the mockup.

### Feature (catalog / global, the library) — mockup `CATALOG_FEATURES`
```ts
interface Feature {
  id: string;
  name: string;
  source: 'class' | 'subclass' | 'racial' | 'feat' | 'background'; // NO 'item'
  detail: string;             // e.g. "Fighter 1", "Champion 3", "Half-Elf", "Soldier"
  desc: string;               // player-facing
  passive: boolean;
  maxUses: number;            // 0 when passive
  reset: 'Short Rest' | 'Long Rest';
  mechanic: { type: 'none'|'roll'|'heal'|'damage'|'buff'|'save'; data: object };
}
```
**One feature library, two consumers:** characters reference features they've been
*assigned* (intrinsic), and items reference features via `featureIds` (which surface as
the player's derived **Gear Features** group). There is deliberately **no `item` source** —
items point at features, the Features catalog never points at items.

### Effect definition (apply-effect list) — mockup `EFFECT_CATALOG`
```ts
interface EffectDef { id: string; name: string; kind: 'buff' | 'cond' | 'debuff'; }
```
On apply, the DM picks a duration from `['1 round','3 rounds','10 minutes','1 hour','until rest']`.

### Session (campaign-level) — mockup `SESSIONS`
```ts
interface Session { num: number; title: string; date: string; recap: string; events: string[]; }
```

### Quest (campaign-level) — mockup `QUESTS`
```ts
interface Quest {
  id: string;
  title: string;
  type: 'main' | 'side';                  // ◈ / ◇ glyph
  status: 'active' | 'completed' | 'failed';
  location: string;
  givenBy: string;
  description: string;                    // player-facing
  objectives: { text: string; done: boolean }[];
  related: string[];                      // tag names
  gmNotes: string;                        // DM-ONLY — never sent to player
}
```

---

## 2. Data scoping (where each thing lives)

| Scope | Entities | Home |
|---|---|---|
| **Per-character** | core stats, status (death saves / exhaustion), lore | extend the `characters` row sections (`sheet`, `resources`, `lore`) |
| **Campaign-level (shared)** | sessions, quests | a **campaign-scoped** table/row — **NOT** on any character |
| **Catalog / global (the library)** | items, spells, features (shards later) | catalog tables |

Note: sessions and quests are **campaign-wide**, not per-character. The mockup correctly
keeps them as standalone arrays. If the earlier handoff implied `progress.sessions` /
`progress.quests` on a character row, treat the *definitions* as campaign-level here;
only per-character *state* (if any) attaches to a character.

DM access across all characters and campaign data uses the already-decided `dm_all` RLS
policy (membership in `dm_users`).

---

## 3. Derived values — never store, always compute (SSOT)

The discipline we've kept throughout. The level-up logic in the mockup already follows it.

- **Proficiency bonus** = `floor((level - 1) / 4) + 2`. Derive from level.
- **Hit dice** = `level` × d(class hit die). Hit-die pool size derives from level.
- **Effective ability scores / stats** = base + equipped-item `effects` + attuned-shard
  effects + active `effects`. Recompute derived values (AC, attack, save DC) from these.
- **Gear Features** = derived from the `featureIds` of **currently-equipped** items.
  They appear and disappear with loadout. **Never copy them onto the character** — that
  produces ghost features after the item is removed.
- **HP gain on level-up** applies to **both** `hpMax` and `hp` (leveling doesn't fully heal).

## 4. DM-only fields — must never reach the player view

Guard these at the query/RLS/field level so they're never sent to a player client:

- `Character.digitization`
- `Lore.trueLore`
- `Quest.gmNotes`

These are the dramatic-irony layer; a leak spoils the campaign.

---

## 5. Carry-overs from the mockup review

These are implementation guardrails, not defects in the mockup.

1. **Unify the item source.** The mockup splits a minimal `ITEM_CATALOG` (used by Grant
   Item) from a fuller `CATALOG_ITEMS` (used by the Catalog Manager), and their contents
   don't match. In the real app there is **one items table**, and **Grant Item reads from
   the authored catalog**. Do not replicate the split.
2. **Saves → Supabase.** Every SAVE / APPLY / grant in the mockup is a `console.log` +
   in-memory array mutation (e.g. `CATALOG_ITEMS.push`). These become Supabase reads/writes.
3. **Seed data is placeholder.** The agent authored rich lore and quest prose — replace it
   with your own canon. Lock Ros's ability array (mockup seeds STR 17) when you seed the DB.
4. **Features are their own table.** Items hold a `featureIds` join; characters hold
   assigned-feature ids; the player Gear Features group derives from equipped items. One
   library, referenced by both.

---

## 6. Surfaces map (what renders where)

- **Left — roster.** Campaign entries (Party Overview, Quest Log, Session Log, Catalog)
  above the character cards. Selecting any entry sets the work-area view.
- **Center — work area.** Renders the selected surface: the all-PCs overview dashboard
  (incl. the DM-only digitization gauge), or a campaign authoring surface (sessions /
  quests / catalog), or the selected character with **Actions** and **Lore** tabs.
  **Level Up** opens as a focused overlay.
- **Right — broadcast + activity log.** Push a G.U.I.D.E. system notice (Normal /
  Corrupted tone) to the selected PC or all party; recent DM actions log below.

## 7. Realtime (the Phase 2 payoff)

Grant Item, Apply Effect, and Broadcast are the realtime writes. The player client
subscribes and reacts: an `ITEM ACQUIRED` toast, a new entry in the effects tray, or a
system notice. The mockup simulates the toast in `toastLayer` so you can see the target
behavior. `Character.online` is presence.
