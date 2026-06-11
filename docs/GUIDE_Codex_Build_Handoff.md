# G.U.I.D.E. Codex — Build Handoff & Data Model

This document is the bridge between the ten design mockups (single-file HTML/CSS/JS) and the
real application. It defines the stack, the Supabase data model, what each screen reads and
writes, the single-source-of-truth map, the placeholder data that must be corrected, and the
build order. The ten HTML files remain the source of truth for *layout and visual language*;
this document is the source of truth for *architecture and data*.

---

## 1. What we are building

A standalone web app: an in-world "G.U.I.D.E." neural-implant character codex for a small
private D&D campaign (3–4 players + DM). Each player owns one character (PC). Players view and
manage their own character; the DM authors content and grants items/loot/levels.

**Stack**
- **Frontend:** the existing screens, assembled into one single-page app with client-side
  routing. Same visual language, same component logic.
- **Backend:** Supabase (hosted Postgres + Auth + Realtime). No custom server.
- **Auth:** Supabase magic-link (passwordless email). Lightest real auth; fine for trusted
  players, no sensitive data.
- **Hosting:** frontend deploys to a static host (Vercel / Netlify / Cloudflare Pages, free
  tier). Supabase is already cloud-hosted. The app is therefore online-first — there is no
  difference between in-person and remote play. `localhost` is for development only.

**Why Supabase:** persistence + cross-device sync + identity in one package, free at this
scale. Postgres stores JSON natively (JSONB), and the mockups are already JSON-shaped, so the
data layer does not fight the design.

---

## 2. Data model

### 2.1 The canon-vs-state split

Two natures of data, and the split keeps the database small and the catalog reusable:

- **Catalog (authored content, shared, changes rarely):** item definitions, spell definitions,
  shard-tree definitions, lore/quest text. The DM authors these. They can live in their own
  tables so the DM can edit them live in Supabase's table editor without a redeploy.
- **Character state (per-character, mutable, changes during play):** current HP, expended spell
  slots, attuned shard nodes, prepared spells, gold, which items a character carries/equips,
  quest progress. This is what players touch.

A character mostly holds *references into the catalog plus state*, not copies of the content.
(e.g. inventory stores `{item_id, qty, equipped}` rows, not the full item definition.)

### 2.2 Tables (sketch)

```sql
-- One row per player character. Owned by an auth user.
create table characters (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid references auth.users not null,   -- the player
  name        text not null,
  -- JSONB sections, one per screen-cluster (see §3):
  identity    jsonb not null default '{}',  -- race, class, archetype, background, level, etc.
  sheet       jsonb not null default '{}',  -- ability scores, HP, hit dice, AC, saves, skills...
  resources   jsonb not null default '{}',  -- spell slots, attunement points, death saves, exhaustion
  inventory   jsonb not null default '[]',  -- carried items: {item_id, qty, col,row, equipped}
  equipped    jsonb not null default '{}',  -- gear slots: {helmet, armor, cloak, boots, accessory, quick_access, guide_shard}
  shards      jsonb not null default '{}',  -- 3 slots + per-shard attuned-node state
  spellbook   jsonb not null default '{}',  -- caster profile + known/prepared spell_ids + slot state
  lore        jsonb not null default '{}',  -- backstory, trait/ideal/bond/flaw, relations
  progress    jsonb not null default '{}',  -- home-screen story-progress + quest/session state
  updated_at  timestamptz default now()
);

-- Catalog tables (authored, shared). Could instead be bundled JSON for a simpler v1.
create table item_catalog       (id text primary key, data jsonb not null);
create table spell_catalog       (id text primary key, data jsonb not null);
create table shard_tree_catalog  (id text primary key, data jsonb not null); -- e.g. 'vigor', 'guide'
create table quest_catalog       (id text primary key, data jsonb not null);

-- Optional: who is the DM (for the broad-access RLS policy below).
create table dm_users (user_id uuid primary key references auth.users);
```

> A simpler v1 is legitimate: keep the catalogs as bundled JSON files in the app (redeploy to
> update) and only put `characters` in Supabase. Move catalogs into the DB when live editing
> becomes worth it. The schema above is the full version.

### 2.3 Auth + Row Level Security

Identity comes from magic-link login. **RLS** is the mechanism that answers "who can touch
what" with zero backend code:

```sql
alter table characters enable row level security;

-- Players read/write only their own character.
create policy own_character on characters
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- The DM reads/writes everyone (separate, additive policy).
create policy dm_all on characters
  for all using (exists (select 1 from dm_users where user_id = auth.uid()));
```

> RLS is the one Supabase concept that most often trips people up the first time — it is easy to
> either lock yourself out or leave a table fully open. Test both policies explicitly: a player
> should see exactly one character; the DM should see all.

### 2.4 Realtime (powers the item-acquisition toast)

Subscribe each player's open app to its own `characters` row. When the DM grants an item from
the DM view, the player's client gets the change and fires the "ITEM ACQUIRED" toast live, mid-
session. (See the toast component in §6.)

---

## 3. Per-screen data contract

What each screen displays and mutates → which JSONB section owns it. The HTML files hold the
exact placeholder values and layout; this is the mapping.

- **Home (Codex):** reads `progress` (story-progress cards). Nav hub. (Note: current mockup
  percentages are decorative placeholders, some >100%.)
- **Equipment:** reads `equipped` (7 gear slots: Helmet, Armor, Cloak, Boots, Accessory, Quick
  Access, G.U.I.D.E. Shard) + equipped weapons; each resolves item detail from `item_catalog`
  (rarity, stat rows, flavor, attune flag). Mutates `equipped` on equip/unequip.
- **Inventory:** reads `inventory` (carried items with grid `col/row`, footprint `w/h`, `qty`,
  category, rarity → resolved against `item_catalog`). Mutates on USE/EQUIP/DROP. **Equipped
  items live in `equipped`, carried items in `inventory` — one flag decides which; never both.**
- **Stat Panel:** reads `sheet` (AC, initiative, speed, proficiency bonus, HP current/max/temp,
  hit dice, ability scores, saves, skills, senses, combat reference) + `resources` (death
  saves, exhaustion). Mutates HP, hit dice, death saves via its steppers.
- **Character:** reads `sheet` ability scores + skill/save proficiencies (`ABILITIES` object) to
  roll d20s. Read-mostly; rolling is ephemeral (a log), not persisted state.
- **Shard Interface:** reads `shards` (3 slots: G.U.I.D.E. locked, Vigor active, empty) + each
  shard's definition from `shard_tree_catalog`. Opens the Shard Tree modal.
- **Shard Upgrade Tree (modal):** reads `shard_tree_catalog[shard_id]` (node definitions) +
  `shards[shard_id].attuned` (which nodes this character has unlocked) + `resources.attunement`
  (available/spent). Mutates attuned-node set and attunement on attune. **Already data-driven.**
- **Lore:** reads `lore` (backstory prose, personality trait/ideal/bond/flaw, relations list
  with attitude, memory-fidelity note). Read-only for players; DM-authored.
- **Journal:** reads `progress` quests (`{id, status, type, glyph, title, location, giver,
  description, objectives:[{text,done}], related}`) + sessions (`{id, no, title, date, recap,
  keyEvents}`). Mutates objective done-flags; quest/session content is DM-authored.
- **Spellbook:** reads `spellbook` (caster profile: class, ability, saveDC, attackBonus,
  prepared used/max, slots[{level,total,expended}]) + known/prepared spell ids → resolved
  against `spell_catalog`. Mutates expended slots (cast / pip toggle) and prepared flags.
  **Already data-driven; renders an empty state when `spellcasting:false` (Ros's real case).**

---

## 4. Single source of truth map

Each stateful value has exactly one owner in the data model. Screens are *views* onto it.

| Value | Owner | Screens that read/write it |
|---|---|---|
| Current / max / temp HP | `sheet.hp` | Stat Panel (edits), Character (reads), top chrome |
| Ability scores | `sheet.abilities` | Character + Stat Panel (both currently disagree — see §5) |
| Spell slots (total/expended) | `spellbook.slots` | Spellbook (cast, pip toggle), rest |
| Prepared spells | `spellbook` per-spell flag | Spellbook |
| Attunement points | `resources.attunement` | Shard Tree (spends), rest |
| Attuned shard nodes | `shards[id].attuned` | Shard Tree |
| Gold + coin purse | `sheet.coins` (or `resources`) | top chrome, Inventory |
| Burden (current/max) | derived from `inventory` weights | top chrome, Inventory |
| Equipped vs carried | one flag per item | Equipment ↔ Inventory |
| Quest / objective progress | `progress.quests` | Journal |

Storing the character as one row means, e.g., current HP lives at exactly one address
(`sheet.hp.current`). The Stat Panel and Character screens stop each "owning" HP — they both
point at the same field. The drift problem stops existing rather than being patched.

---

## 5. Canon cleanup — placeholder drift to fix

The design agent invented filler that must not calcify into canon. Replace with your real values
when seeding the first character. Known conflicts:

- **Level:** every screen shows `8`. Canon is **7**. (Proficiency bonus follows: +3 is correct
  for level 7.)
- **HP:** varies by screen (42 and 52 both appear). Canon is **52**.
- **Hit dice:** Stat Panel shows `5d10`. Canon is **7d10** (matches level 7).
- **Ability scores — UNRESOLVED, your call:** the Character screen says STR 18 (+4), DEX 14
  (+2), CON 16 (+3), INT 10, WIS 13, CHA 12. The Stat Panel screenshot showed STR 16 (+3), DEX
  12 (+1), CON 14 (+2), INT 10, WIS 13, CHA 11. **Pick one canonical set** and seed it once;
  every screen then reads from `sheet.abilities`.
- **Invented lore to confirm or cut:** "Castellan" (as a language and as "Castellan Guard"),
  "Champion Archetype," "Brettany Reclamation," "Castellan Claymore," "Brettany Plate," "Ring of
  Ember," "Mantle of the Coastline." Keep only what you intend as canon.
- **Cantrip scaling (Spellbook):** the roller currently lets cantrips upcast via the slot
  stepper. Cantrips scale by *character level*, not by slot — wire them to read character level
  and drop the stepper for cantrips.
- **Home progress percentages:** decorative placeholders (some exceed 100%). Define what each
  bar actually measures, or treat as flavor.

---

## 6. Build order

Dependency-ordered. The foundation must exist before any feature touches it.

**Phase 0 — Foundation (the big lift, but the most de-risked).**
Supabase project + schema (§2); magic-link auth + RLS; the SPA shell + client-side routing that
turns ten HTML files into one navigable app; wire all ten screens to read/write the character
row. The Shard Tree and Spellbook are working templates for data-driven rendering — the other
eight follow that pattern. Seed one real character (your canon values from §5).

**1 — Rest button.** Smallest, and the end-to-end smoke test for Phase 0: press → reset HP /
spell slots / (attunement?) in the character row → every screen reflects it → it persists across
reload. If this loop works, the foundation works.

**2 — DM View (+ item catalog + acquisition toast).** Biggest of the features; unlocks the next
two. A DM-only surface to grant items (pick from `item_catalog` → assign to a character), award
gold, advance quests, edit lore. Granting an item fires the realtime "ITEM ACQUIRED" toast on
the player's screen (§2.4) — a new component in the established aesthetic, and later a vector for
horror texture (a notification that is subtly wrong).

**3 — Level-up (DM-side).** Lives largely inside the DM View: bump stats, add slots, unlock
nodes. Player-side guided flow is a clean later addition.

**4 — Mobile port.** Done last (reflow what exists, not a moving target). Two core moves carry
it: persistent chrome → a bottom tab bar; master-detail screens (Inventory, Journal, Lore,
Spellbook) → tap-to-drill-in. The visual system survives intact; this is reflow + one nav
pattern, not a new UI. Decide the scope question first (see §7).

---

## 7. Open decisions (resolve before or during the relevant phase)

- **Mobile scope:** full feature parity, or mobile = reference + light edits while real
  management happens on desktop? Choosing the latter lets the spatial screens (inventory grid,
  shard tree) be view-only on phones and removes the hardest part of the port.
- **Rest trigger:** player-initiated button, DM-initiated, or both (player with DM override)?
- **Level-up feel:** DM-authored only (simplest) vs. a guided player flow (later).
- **Catalog location:** bundled JSON (simple, redeploy to edit) vs. Supabase tables (live
  editing in the table editor). Per-character *state* is always in Supabase regardless.
- **Concurrency:** last-write-wins is fine at 4 users; no special handling needed.

---

## 8. The two data-driven templates

The Shard Tree (`SHARD_TREE`) and Spellbook (`SPELLBOOK`) already render entirely from a single
data object, with a clearly commented JSON-swap point, and mutate that object rather than the
DOM. They are the reference pattern for refactoring the other eight screens in Phase 0:
the object becomes the (section of the) character row; the renderer stays the same; reads/writes
go to Supabase instead of an in-memory object.
