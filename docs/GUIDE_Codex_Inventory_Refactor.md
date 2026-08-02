# G.U.I.D.E. Codex — Inventory Refactor (Master Spec)

Supersedes `GUIDE_Codex_Inventory_Redesign.md` (deleted). Companion to
`GUIDE_Codex_Build_Handoff.md` and `GUIDE_Codex_DM_View_Handoff.md`.
Branch: `inventory-refactor`.

**The refactor in one line:** the spatial grid becomes a small tactical loadout, bulk
storage moves into containers, weight becomes the only capacity limit, and containers
gain presentation modes instead of one uniform list view.

---

## 0. How to read this doc

**The codebase wins every conflict with the design.** The design agent (`G.U.I.D.E.
Redesign Components.html`, `G.U.I.D.E. Equipment.html` in `~/Downloads`) has no
knowledge of our code. Copy its *pixels*; implement our *behaviour*. Where its
demo JS and our data model disagree, §9 records which is authoritative — the design's
version is a mockup convenience, not a decision.

**The current dev database is fully disposable.** There is no production data and no
migration to write. Everything below that would be a "migration" on a live app is
instead a rewrite of `supabase/migrations/` + `supabase/seed.sql`. This is the single
biggest scope reduction in the refactor — do not write fallback/migration code for
data shapes that no longer exist.

---

## 1. Open decisions

| # | Decision | Notes |
|---|---|---|
| 1 | ~~QUICK ACCESS slot~~ | **RESOLVED — removed.** The on-person grid replaces it. Existing `equipped.quickAccess` items are deleted, not migrated (dev environment). |
| 1b | ~~Does `abstract` mode survive?~~ | **RESOLVED — cut.** Modes are `page` and `inline` only. Delete the third branch wherever the design still carries it. |
| 1c | **Where does the component pouch live?** | Options: a `COMPONENTS · READY` indicator on the Spellbook near the casting controls (recommended — it's where the fact matters, and can go red when absent), or an ordinary inventory item with no special treatment. Not a blocker. |
| 2 | **Bonus-action-from-belt rule — adopt?** | Potion on belt = bonus action; from a container = action. Makes the 20 cells a real decision. Rules choice, not a build blocker. |
| 3 | **Party view placement** | Nav-engaged overlay (recommended), persistent frame, or its own screen. |
| 4 | **Party view with 3 players** | Dormant 4th slot (recommended) or re-center to three. |
| 5 | **Nav in the party-view centre** | Radial cluster, or the existing bar in the gap? |
| 6 | **Haversack / efficient quiver compartments** | Ignore compartments and treat as one weightless container (recommended), or model sub-compartments (= nesting). |
| 7 | **Ros's canonical ability array** | Long-standing. Mockups conflict; DM-view mockup seeds STR 17. Needed before real seeding. |

**Decisions 3–5 are party view, which is its own slice.** They are parked here so they
are not forgotten; nothing in this refactor resolves or depends on them.

---

## 2. Container display modes

The core new concept. **Authored per container, not inferred.** How contents are *used*
decides the mode:

| Mode | Use case | Presentation | Containers |
|---|---|---|---|
| `page` | Many arbitrary items — needs browsing, sorting, filtering | Own tab in the inventory panel, full list view | Backpack, sack, bag of holding |
| `inline` | Few stacks of one category — needs visibility at a glance | Expandable row in the storage sidebar. No tab. | Quiver, bolt case, scroll case |

**`abstract` is cut** (decision 1b). It existed for the component pouch, which isn't
really a container — 5e abstracts its contents entirely, so it has nothing to browse,
no capacity to fill, and nothing to select. It's a passive prerequisite, not storage.

**The storage sidebar holds only containers with browsable contents.** That's the
definition.

### `inline` expansion is capped

Expansion must be **bounded**, or the panel below shifts by an unpredictable amount.
Expand to a maximum of **3 rows**; beyond that, show the top 3 and a `+N MORE →` line
that opens the **item popup** with the full list (the popup already has max-height and
internal scrolling, so it's the right home for the long tail).

```
QUIVER · 34 / 40
   ARROWS                ×20
   SILVERED ARROWS       ×10
   ARROWS +1             ×4
   +6 MORE →
```

Most characters carry 1–3 ammo types; ten is the tail. Design the inline view for the
common case, hand the tail to a surface built for length.

**The sidebar row only answers "what do I have."** Selection happens at the weapon's
ammo picker (§5), which is why 3–4 visible rows is sufficient.

---

## 3. Container slots — a fixed set of four

Containers are **not** worn in body slots. The `Back` / `Belt` / `Hand` / `Accessory`
labels in the design data are flavour text only and are **not enforced**. Instead each
container kind has its own slot with a hard cap:

| Kind | Cap | Mode | Tab |
|---|---|---|---|
| `backpack` | 1 | `page` | Yes |
| `bagOfHolding` | 1 | `page` | Yes |
| `sack` | 1 | `page` | Yes |
| `quiver` | 1 | `inline` | **No** |

`container.kind` lives on the catalog item (§9). A second container of the same kind
cannot be equipped.

**`kind` is an open set; the tab bar is not.** The four above are what ships. New
`inline` kinds — bolt case, scroll case — cost nothing: they claim no tab, so the DM
can author them in the catalog whenever they like, and they default to a cap of 1.
A new **`page`** kind is different: it would become a fifth tab and reopen the `MORE ▾`
overflow question this section exists to close. Adding one is a deliberate change to
§3, not a catalog entry.

### The tab bar is one tab per SLOT, not per owned item

```
ON PERSON  ·  SACK  ·  BACKPACK  ·  BAG OF HOLDING
```

Exactly four, always in that order, always in the same position. A slot with nothing
equipped renders **locked** — dimmed, hatched, with a padlock and a deny-shake on click
(`.seg-btn.locked` / `.deny` in the design). A locked tab reads as a slot to fill, not
a hidden feature.

This is why the cap is one sack rather than two, and it means the `MORE ▾` overflow
case from earlier drafts **never happens** and must not be built.

The quiver has no tab at all — it is `inline`, and its contents are drawn by the ammo
picker rather than browsed.

---

## 4. Inventory screen

**Remove:** the 80-cell cap; the `n / 80 SLOTS` and `FREE` readouts; the right-column
`ITEM DETAIL` panel.

**Change:** grid shrinks to **5 wide × 4 tall = 20 cells**, fixed on every platform
(see §10); section renames to `ON PERSON`; burden manifest becomes the only capacity
system, keeping the ENC / HEAVY tiers — they slow the character, never block a pickup;
stack limits raised or removed on consumables and ammunition.

**Keep:** multi-cell footprints. Items retain `w`/`h` and the grid stays a placement
system, not a list. At 20 cells a 2×1 crossbow costs 10% of reach — that is the point.

**Add:** the fixed four-tab bar (§3), which changes only the left pane — the switcher,
header line and utility bar are all fixed-height so switching tabs never moves a pixel
of surrounding chrome; container views are lists with sort and category-filter chips;
a header line per view (`BACKPACK · 24 ITEMS · 41.5 lb`).

---

## 5. Equipment screen

**Worn slots — eight**, laid out 4×2: helmet, armor, cloak, boots, **gloves**, **neck**,
**ring**, **ring**. The existing `accessory` slot becomes the first ring rather than a
third accessory.

**Remove the QUICK ACCESS slot.** The on-person grid means "what you can reach without
digging," which is what quick-access meant. One concept, one control.

**Shield does NOT go in the gear grid.** In 5e a shield occupies a hand — it competes
with an off-hand weapon and is incompatible with a two-hander. It belongs in the
existing OFF HAND weapon slot. A gear-grid shield would permit greatsword-plus-shield.

**Weapons stay at two hand slots.** Bow in main hand, claymore in off-hand. No "ranged"
slot.

**Add an `ATTUNED n / 3` readout** in the gear section header, replacing `6 SLOTS`.
More slots doesn't mean more magic items — rings and amulets are the attunement-hungry
category, and 3 is the real cap. Tint red at `3 / 3`; attuned slots carry a cyan ◈ pip.

### The STORAGE CONTAINERS button + sidebar

**Placement: between the gear grid and the shard widget.** A full-column-width button,
clearly labelled as storage containers, opening a slide-over sidebar that houses the
container module.

This reuses the pattern already built for Active Effects — `ActionBtn` at
`Equipment.tsx:265` and `EffectsSidebar` at `Equipment.tsx:323`, with `.sidebar` /
`.sidebarScrim` / `.open` in `Equipment.module.css:1127`. Same slide-over, same scrim,
same Escape handling.

- **The two sidebars share the space over the gear column, so they are mutually
  exclusive.** Opening one closes the other.
- The button carries a count of equipped containers, like Effects carries its count.
- One row per equipped container, presented per its display mode (§2); `inline` rows
  expand in place, capped.
- **Equip / unequip lives here**, not on the inventory screen. Tabs unlock and lock as
  a consequence. One mental model: gear is managed where gear lives.
- **A `STOWED` row** for unequipped-but-owned containers, with an EQUIP action, so
  "where did my backpack go" always has an answer.
- An `EQUIP A CONTAINER` empty-slot row that reads as an invitation, not a blank.

**Do NOT print the shards/containers rationale as footer text.** The design still
renders `Containers extend storage · shards extend capability`. Cut it — and with the
module behind a button it isn't even structurally true any more.

### Ammo picker on weapon cards

Which arrow is nocked is a property of the attack, not of the quiver. A small selector
sits beside the ATTACK button showing the active type and remaining count
(`ARROWS ×20 ▾`), switchable to any stack in the equipped quiver.

- Ranged weapons only. Melee cards never get one.
- **Absent entirely** — not empty — if no quiver is equipped.
- The menu must render to a **fixed layer outside the card**: the weapon card is
  clip-pathed and would crop it.

---

## 6. Item detail — tooltip + popup

**Remove** the persistent detail panel. Both surfaces are designed and live in the
components file.

**Hover tooltip (fine pointer only):** name, category, rarity, weight, one key stat.
**No prose, no buttons** — it exists for scanning.

**Item popup — click any item, anywhere.** Same frame as the shard-upgrade modal:
four-layer clip, corner ticks, max-height with internal body scrolling. Contents: facts
grid, flavour, granted effects and features. Actions are context-dependent:

| Context | Actions |
|---|---|
| Ordinary item, on person | `EQUIP` (if slotted) · `STOW` · `DROP` |
| Ordinary item, in a container | `EQUIP` (if slotted) · `RETRIEVE` · `DROP` |
| Container item, equipped | `OPEN <container>` · `UNEQUIP` |
| Container item, unequipped | `EQUIP <container>` |
| Quest item | Drop suppressed |

- **Manual STOW gets a destination picker** when more than one equipped container
  accepts the item. This is deliberate movement and is not the same thing as the
  automatic routing in §7.
- **Manual RETRIEVE refuses when ON PERSON is full**, with an inline
  `// No reachable space — free a cell on person first` warning. The split is the rule:
  *automatic routing never blocks; manual moves can.*

**Platform split:** fine pointer = hover → tooltip → click → popup. Coarse = tap →
popup, **no tooltip**. On coarse the popup renders as a bottom sheet with a grab
handle, swipe-to-dismiss and 52px targets. Gate on
`@media (hover: hover) and (pointer: fine)` — never on width.

---

## 7. Automatic routing — pickups never fail

```
1. First equipped container whose allowedCategories match   (arrows → quiver)
2. ON PERSON, if a footprint-sized space is free
3. BAG OF HOLDING if equipped, otherwise BACKPACK
```

Each step falls through when it cannot take the item: a container at `capacity` fails
step 1, a grid with no footprint-sized space free fails step 2. Step 3 is unbounded, so
**a pickup can never fail** — the character simply takes the weight. This removes
"inventory full" as a state entirely.

**Consequences, both deliberate:**
- The grant-destination picker on the DM's Grant Item is **removed**. Granted items
  route themselves; the DM never picks a container.
- With a bag of holding equipped, overflow lands somewhere weightless, so
  **encumbrance effectively stops applying to newly acquired items**. This is an
  accepted quality-of-life trade, not an oversight.
- The sack receives nothing automatically — it is manual-stow storage only.

**Equipping a quiver pulls in loose on-person arrows.**

---

## 8. Locking & confiscation (DM view)

Two distinct mechanics with deliberately different fictions.

### Locked — visible and useless

A per-item flag. The item keeps its place, shows a lock icon, and cannot be used,
equipped, or consumed. **It still counts toward carry weight and still occupies its
cell** — it is in your pack, it is simply refusing you. Cursed, sealed, or
`ACCESS REVOKED`. A system that decides you may no longer use something is exactly the
menace G.U.I.D.E. should develop late-campaign, and it can happen without narration.

### Confiscated — gone without a trace

**The item disappears from the player's view entirely.** No pseudo-container, no
greyed-out row, no weight, no count. From the player's side it is simply not there.
The DM holds it in a DM-side store and can restore it.

*(This replaces the earlier `HELD` pseudo-container design, which left confiscated
items visible-but-unretrievable. Full disappearance is the stronger fiction and the
one we're building.)*

**Restore returns the item to where it was taken from.** Confiscation snapshots the
item's placement object verbatim — nothing special, it is the same
`{containerId, col, row}` the item already carried, and `col`/`row` are already null
for anything that was in a container. Two fallbacks, both rare:

- the original cell is now occupied → fall through to the §7 routing chain
- the original container is gone (unequipped, lost, confiscated itself) → same

**Required new surface:** a per-character **INVENTORY tab** in the DM console
(alongside Actions and Lore), listing the character's items with lock / unlock /
confiscate / restore. Confiscation is impossible without a way to browse their
inventory, which the console currently lacks.

---

## 9. Data model

### Item placement

```ts
// before
{ col?: number, row?: number }
// after
{ containerId: string, col?: number, row?: number }
```

`containerId` is `'person'` or a container item's id. On-person items carry real
`col`/`row` (1-indexed, top-left cell); container items leave them absent — lists have
no geometry. Sort order is a view preference, never stored state.

**Footprint is intrinsic and survives every move.** `w`/`h` live on the item and are
preserved through equip, unequip, stow and retrieve; only the *position* is dropped and
re-derived. The design's demo JS deletes `w`/`h` on stow and forces `1×1` on retrieve —
**that is wrong for us** and would break a 2×1 crossbow. Reuse the footprint-aware
placement search already in `Inventory.tsx`; do not port the design's `freeCell()`,
which only ever finds a single cell.

### Container definition (on the catalog item)

```ts
container?: {
  /** Open set — see §3. Shipping kinds: backpack | bagOfHolding | sack | quiver.
   *  New `inline` kinds are free; a new `page` kind changes the tab bar. */
  kind: string;
  mode: 'page' | 'inline';
  weightless: boolean;
  allowedCategories?: ItemCategory[];   // empty = anything
  capacity?: number;                    // e.g. quiver 20, scroll case 10
}
```

### Per-item flags

```ts
locked?: boolean;   // carried but unusable (§8)
```

### Confiscated items

Confiscated items leave the character row entirely — that is what makes them invisible
to the player, and it means RLS does the enforcement rather than a client-side filter.
They live in a DM-only store keyed by character, each row carrying the item plus the
placement it was taken from:

```ts
{
  item: InventoryItem;              // the item verbatim, footprint included
  from: { containerId: string; col?: number; row?: number };
  takenAt: string;                  // ISO timestamp, for the DM's own ordering
  note?: string;                    // DM-authored: why it was taken
}
```

`from` is the placement object copied as-is (§8) — no transformation, and `col`/`row`
are simply absent when the item came out of a container. Restore reads `from`, and
falls through to the §7 chain when that placement is no longer valid.

### Category enum expands

```ts
// before
type ItemCategory = 'gear' | 'weapon' | 'consumable' | 'misc'
// after
type ItemCategory = 'weapon' | 'ammo' | 'armor' | 'consumable' | 'tool' | 'quest' | 'misc'
```

`ammo` is **required** — an ammunition-only quiver is impossible without it. The rest
make the filter chips worth having. Existing `gear` items are reclassified as `armor`
or `tool` when the seed is regenerated.

### Slot enum expands

```ts
// before
type ItemSlot = 'helmet' | 'armor' | 'cloak' | 'boots' | 'accessory'
// after
type ItemSlot = 'helmet' | 'armor' | 'cloak' | 'boots' | 'gloves' | 'neck' | 'ring1' | 'ring2'
```

`accessory` becomes `ring1`. `equipped.quickAccess` is deleted outright.

### Derived — never store

- **Carry weight** = on-person + all non-weightless container contents. A container's
  **own** weight always counts; `weightless` exempts only its *contents*. Confiscated
  items are excluded (they don't exist to the player).
- **Encumbrance tier** = derived from carry weight vs STR thresholds.
- **Tab lock state** = derived from which container kinds are equipped.
- **Ammo counts** = derived from quiver contents.

---

## 10. Containers are equippable, never permanent

Permanence would make containers the one exception in an all-items system, and would
foreclose confiscation — guards taking the pack is a better scene than guards taking
everything except the pack.

**Contents travel with the container.** Unequip the backpack and its contents go with
it, because they are in the backpack. Makes confiscation trivial and losing your pack a
real stake rather than a bookkeeping event.

Two guardrails so it never reads as data loss: confirm before unequipping a non-empty
container, and keep unequipped containers listed in the storage sidebar so the player
can see the thing exists and their items are inside it.

**No nesting.** Containers cannot go inside containers. Kills recursion and the
weightless-inside-weightless exploit; 5e supplies the in-fiction justification.

**An equipped container is not in the inventory.** Like all equipped items, it leaves
the grid. An *unequipped* quiver appears as an ordinary grid item — with its contents
count rendered in the cell — and vanishes from the grid the moment it is equipped.

### Locked platform dimension

**On-person grid is 5 × 4 on every platform.** Placements are coordinates; a grid 10
wide on desktop and 5 on mobile strands items at columns that don't exist. Touch
targets need ~44px, which at 412px allows five columns — so five columns everywhere.

---

## 11. Catalog manager (DM view) — item form additions

- The expanded slot select (§9), including the two ring slots.
- The expanded category select (§9), including `ammo`.
- A `CONTAINER` sub-section (styled like `EFFECTS GRANTED`), shown when the item is a
  container: **kind** select, **display mode** select (`page` / `inline`),
  **weightless** toggle, **allowed categories** multi-select, **capacity** number.
- A **locked** toggle for the §8 flag.

**Removed:** the grant-destination picker. Routing (§7) handles it.

---

## 12. Angled borders — use the existing fix

A CSS `border` follows the rectangular box; `clip-path` then slices the corners off,
border included, so every 45° edge loses its line. Three techniques already exist in
the codebase — **use them, do not re-solve this**:

| Technique | When | Reference |
|---|---|---|
| Two-layer frame | Anywhere you can nest an element | `Features.module.css:109` |
| Corner-anchored gradient stripes | Inputs, selects, single-element buttons | `OperatorConsole.module.css:1074` (recipe at `:1116`), live at `SystemToasts.module.css:19` |
| Two-layer, always | Hexagons / rhombi — nearly every edge is angled | `SystemToasts.module.css:53` |

Shapes declare `--cut` (corner size) and `--bc` (border colour). **States recolour by
setting `--bc`, never `border-color`** — the stripes read `--bc` too.

**In the new design specifically:** `.slot`, `.seg-btn`, `.region`, `.wc-atk` and
`.im-panel` already use the two-layer pattern correctly. These five use plain
`border` + `clip-path` and **will render with broken diagonals** — they need the stripe
recipe: **`.chip`, `.c-act`, `.ammo-btn`, `.ammo-menu`, `.ctr-line .unequip`**.

---

## 13. Mobile (Phase 4)

Most of this refactor is already mobile-shaped: lists are the most touch-friendly
pattern there is, the popup already becomes a bottom sheet, and a segmented control is
a native touch idiom. What needs redesign is the three-column layout — which dies on
every screen, not just this one.

Phase 4 work (capture, don't build yet): three columns reflow to one; drag-and-drop
does not port — replace with tap-to-place (tap item → `MOVE` → tap destination cell),
which is more reliable than touch dragging and reuses the sheet; sticky summary bar so
weight and gold survive scrolling.

---

## 14. Optional rules payoff

If the on-person grid is what the character can reach, it can carry real tactical
weight: a potion on the belt is a **bonus action**; a potion in the backpack costs an
**action** to dig out. This makes the 20 cells a genuine per-session decision while
leaving the hoard unlimited — which is the whole point.

Not required to build any of the above. Worth deciding before players get used to
either behaviour (decision 2).

---

## 15. Design vs. code

**Design it** if a human has to look at something and decide. **Leave it to code** if
it's behavior with no new pixels.

| Design (has a mockup) | Code (no new UI) |
|---|---|
| Container tab bar + list views | Routing a picked-up item through the §7 chain |
| Storage sidebar, incl. expandable `inline` rows | Attack consuming ammo from the active stack |
| Ammo picker on weapon cards | Carry-weight and encumbrance derivation |
| Item popup + tooltip | Tab lock state derived from equipped containers |
| DM per-character INVENTORY tab | Contents travelling with an unequipped container |
| Catalog CONTAINER sub-section | Weight exclusion for weightless and confiscated |
| Gear grid at 8 slots + ATTUNED readout | Placement + footprint preservation |
| — | Lock flag blocking use |
| — | Confiscation snapshot + restore fallbacks |

---

## 16. Build status

All four slices are built, applied to the dev DB, and verified in the browser
against real data.

| Slice | Contents | State |
|---|---|---|
| 1 — Data layer | Both enums widened, `containerId`, `ContainerDef`, `locked`, migration 0006, seeds regenerated | **Done** |
| 2a — Placement | Routing chain + footprint-aware search, 1-indexed coordinates | **Done** |
| 2 — Inventory screen | Fixed four-tab bar, 5x4 on-person grid, container lists, item popup, shared tooltip | **Done** |
| 3 — Equipment | 8 worn slots, `ATTUNED n / 3`, storage sidebar, ammo picker | **Done** |
| 4 — DM console | Per-character INVENTORY tab (lock / confiscate / return), catalog CONTAINER sub-section | **Done** |

### Still open

- **The attunement cap is displayed, not enforced.** The readout tints red at the
  cap but nothing refuses the equip. Whether to block, or to prompt for which
  attunement to break, is a rules decision (see also decision 2). *(The cap value
  itself is now read from `resources.attunement.capacity`, so raising it per
  character is already a one-field DM edit.)*

- **MAJOR SLICE — features that actually do something.** Design brief below;
  nothing built. See "Features engine — design brief" at the end of this doc.

- **MAJOR SLICE — small-screen layout.** The three-column grid has a
  `minmax(280px, 1fr)` floor, so below roughly 1100×760 the page scrolls
  horizontally rather than reflowing, and the vertical budget runs out first.
  Two symptoms observed on real laptops, both of which are the SAME underlying
  problem and must not be chased individually:
  - the weapon card's ATTACK button crowds the weapon name and damage line
  - the bottom of the Equipment column nearly collides with the bottombar

  Explicitly **not** to be addressed with per-element tweaks (scaling the attack
  button, shrinking the bottombar). Those trade one cramped element for another
  and leave the sides empty. What's needed is a deliberate layout strategy for
  the laptop range — the columns reflowing, or a density mode, or the panels
  becoming independently scrollable regions. Related to but distinct from Phase 4
  mobile: this is the *desktop small-window* case, which a single-column phone
  reflow does not automatically solve.

  Prerequisite: the vertical slack routing item above — the columns can't degrade
  gracefully while nothing absorbs slack.
- **Mobile (§13)** — Phase 4, captured but not built.

### Corrections that were applied while porting

1. Storage module re-hosted in a sidebar behind a full-width button between the
   gear grid and the shard widget.
2. `inline` expansion capped at 3 rows with a `+N more` line.
3. Footer rationale line cut.
4. `abstract` branch deleted.
5. `w`/`h` preserved on stow/retrieve; the design's 1x1-only `freeCell()` was
   replaced with the footprint-aware search.
6. Container `slot` labels treated as flavour — no body slots for containers.
7. Angled-border fix applied to the chips, tags, close button, container-row
   actions, ammo picker and DM row actions.

---

## 17. Features engine — design brief

Features today are descriptive: prose, a usage tag, an optional dice roll. They
can't grant a bonus, heal, or modify an attack. This is the brief for making them
act, written after cataloguing a real spread of homebrew.

### What already exists (more than it looks like)

`Feature` already carries `uses: {current, max}` and `recharge`, the Features
screen already has a **Use** button that spends a use and rolls `roll`,
`rollTone: 'heal'` already writes real HP, and Rest already recharges everything.
**Activation and resource tracking are done.** The gap is what a use *does*
beyond printing a number.

### The principle: the engine never infers a trigger

There is no combat simulation, no targets, no initiative, and there should not
be. The app will never know that the player "reduced a judged creature to 0 hit
points" — but the player knows. So a feature is a **button pressed at the moment
the fiction says so**, and the app does the bookkeeping.

That single inversion removes the entire "impossible" category. It is also how
attacks already work: the app rolls and shows, the player applies.

**The exception that proves it:** some triggers fire on state the app *does* own
— chiefly the character's own HP. Those don't need inverting; the app can offer
them (§ Reactive below). The test is simply "is this a write the app performs?"

### Five categories, in order of how much machinery they need

| # | Category | Example | Machinery |
|---|---|---|---|
| 1 | **Prose + a use counter** | Sanctuary Blade · Unblemished Grace · Unshakeable · Mercy's Final Judgment · Balance Eternal | **None — works today** |
| 2 | **Passive numeric** | Relentless Pursuit (+10 speed) | Reuse `ItemEffects` |
| 3 | **Activated outcome** | Radiant Edge (temp HP = level + WIS) | Formula eval + write `hp.temp` |
| 4 | **Armed next-roll modifier** | Final Strike (auto-crit) · Radiant Edge (+2×prof radiant) · Healing Edge (damage→healing) | A pending-modifier queue |
| 5 | **Reactive** | Too Angry to Fall (at 0 HP, drop to 1 instead) | Feature state + an HP-write hook |

Category 1 is the **largest group**, and treating prose as a legitimate outcome
rather than a failure is most of why this stays tractable. Immunities, advantage,
"cast Sanctuary at will", mass save-or-friendly — the DM adjudicates, the app
spends the use.

Category 2 reuses the existing item split verbatim: numeric always-on modifiers
go in `ItemEffects`, and advantage/resistance/immunity stay prose. The rule that
governs items — *never pretend advantage is a flat number* — governs features too.

### What to build

1. **A tiny formula evaluator.** A whitelist of `level`, `prof` and ability
   modifiers plus arithmetic — roughly thirty lines. NOT an expression language.
2. **Activation outcomes** beside the existing `roll`: `tempHp`, `heal`,
   `effect` (an `ItemEffects` bundle with a duration, i.e. an ActiveEffect).
3. **An armed-modifier queue** in `resources`, consumed by the next attack roll
   and shown as a badge on the weapon card — so it is visible that you are
   holding a crit, and it can be cleared without spending it.
4. **Feature state.** "While raging" means Rage is a feature that is currently
   ON. Today nothing models that: a feature has uses, not a state. Add an
   `active` flag, gate other features on it, and let an effect end it
   (`Too Angry to Fall` ends Rage).
5. **Reactive prompts on app-owned events.** Start with exactly one: HP about to
   reach 0. When it fires and an armed reactive feature is available, ASK — never
   auto-apply. The player may want to save it, and the app may be wrong about the
   gating state. The set of app-owned events is small and closed (HP writes,
   rests, death saves), which is precisely why this is feasible where general
   triggers are not.

### What NOT to build

**Not an interpreter.** Dicecloud is a computation graph with variables, inline
calculations and dependency resolution, because it serves arbitrary homebrew for
strangers who will never speak to its authors. This is one DM authoring for three
players who are in the room. An interpreter buys automation of *adjudication* —
the one thing that must stay human, because the moment the app decides whether a
creature counts as "judged" is the moment it is wrong with no override.

**Not a target registry.** No targets means Condemnation's *marked creatures* and
Balance Eternal's *per-creature-per-short-rest* are genuinely unmodellable. Leave
both as prose with a use counter rather than building an entity model to serve
two features.

### Three more kinds, and where each actually lands

**Features that modify other features.** Split by whether the bonus is a flat
number or a die, and whether it is permanent or conditional.

- *Permanent and flat* ("your Rage now grants +3") — the DM edits the target
  feature when the upgrade is granted. One source of truth: the feature as it
  currently reads. The cost is losing the "base + improvement" history, which for
  one table is nothing.
- *Permanent and a die* ("Sanctity now deals +1d4") — same edit: the roll
  expression becomes `2d8 + 1d4 + 4`. Still one field.
- *Conditional, either kind* ("+1d4 while raging", "+2 against judged
  creatures") — **this is the case that needs real machinery**, and neither
  valve above covers it: baking it into the base roll would apply it always, and
  `ItemEffects` models flat numbers only, so a `+1d4` has nowhere to live.

For that last case, add **roll contributions**: a feature may declare an addend
to a named roll, with a label and an optional gating condition. At roll time the
roller collects every contribution from currently-active features and sums them,
showing each source in the breakdown the toast already renders:

```
Sanctity  →  2d8(11) + 1d4(3) + 4  =  18
             +1d4 radiant — Radiant Empowerment
```

**Features can also arm a bonus on ANOTHER feature's roll.** Activating "Boost
Judgment's Cut" spends its use and writes a pending `+1d6` targeting the
`judgments-cut` roll; the next activation of Judgment's Cut collects it, rolls it
in, and consumes it. This is the category-4 armed queue with a feature as the
key rather than an attack — nothing new is required.

Two things it needs, both cheap:
- **a lifetime** — pending entries clear on a rest (alongside use recharge) and
  can be dismissed by hand, or the player accumulates ghosts from past sessions;
- **visibility** — the target feature's card must show that it is armed, exactly
  as the weapon card shows a held crit. An invisible pending bonus is worse than
  none, because the player rolls without it and never learns why the number was
  low.

**This is a list, not a graph.** Resolution is a FILTER over active features, not
a dependency traversal, and the rule that keeps it that way is:

> **Contributions target rolls, and a contribution is never itself modifiable.
> One level deep. No chaining, no recursion.**

That single constraint is the whole difference between this and the computation
engine the brief refuses to build. It also composes with the mechanisms already
here — a conditional gates on the same `active` state flag category 5 needs, and
a one-shot contribution is just the armed-modifier queue with a different
lifetime.

### What is actually off the table

Not "one feature referencing another" — that is fine, and two of the cases above
do it. What is refused is **continuous re-derivation**: a web of references that
recalculates downstream values whenever anything upstream changes. That is what
needs a dependency engine, and it is the thing that makes homebrew authoring
require a manual.

The useful test is **when the reference resolves**:

| Resolves | Example | Verdict |
|---|---|---|
| At **write** time (activation) | Boost arms +1d6 on Judgment's Cut | Safest — a concrete value in a queue |
| At **read** time (each roll) | "+1d4 while raging" | Fine — a filter over active features, one level deep |
| **Continuously**, across a reference web | Dicecloud-style variables | Refused |

**Features that grant spells** (Sanctuary Blade's "cast Sanctuary at will").
Legitimate and worth structuring — the spellbook is app-owned data, like
`hp.temp`. **But it is blocked:** the Spellbook screen is still a `Stub` and
`CharacterRow.spellbook` is an untyped `Record<string, Json>`. There is no shape
to write into. Design feature-granted spells as *part of* the Spellbook slice
rather than bolting a field on now; when it happens, follow the item precedent —
snapshot the spell into the spellbook carrying a `feature_id` back-ref, so
removing the feature can remove its spells.

**Auto-success features** ("your next saving throw automatically succeeds").
Not a new category — this is category 4 pointed at a different roll. The lesson
is that the **armed-modifier queue must be keyed by roll KIND** (attack, save,
check, damage), not attack-only. Build it that way from the start.
**Partly blocked:** saves are currently *displayed* on the Stat Panel
(`saveTotal`) but never rolled, so there is no roll for an armed modifier to
modify. Either such features stay prose, or the Stat Panel gains save rolling
first — a small slice, and independently worth having.

### Is a combat tracker needed? No.

The features that would need one are Condemnation's *marked creatures*, Balance
Eternal's *per-creature* limit, "for 1 minute" durations, and Execution's
on-kill trigger. A tracker would mean initiative order, enemy HP, targets and
rounds — at which point the app is a VTT, every future feature starts *expecting*
that model, and the DM is running combat in the app instead of at the table.
That is a different product, and a much larger one.

What replaces it, cheaply:
- **"Next roll" needs no notion of turns.** The armed-modifier queue already
  gives the timing that most features actually care about.
- **Durations are already manual** — active effects from potions carry a
  free-text duration and are cleared by hand or by a rest. Feature durations
  behave the same way, so this is consistent rather than a new gap.

The real cost of no tracker is that durations live in the player's memory. That
is already true today, so it is not a regression — just a limit to state out loud
rather than discover.

### Roll context — surface the relevant features beside the result

Borrowed from Dicecloud, and **it needs no computation engine.** When a roll
happens, show the breakdown *and* every active feature relevant to that roll,
with its rule text and any derived number:

```
SANCTITY
  To Hit    1d20 [9] + 7            = 16
  Damage    1d8 [6] + 2             = 8 slashing

  ── relevant ──────────────────────────────────
  Judgement's Edge      +1d6 radiant or necrotic vs a judged creature
  Restoration…          heal an ally within 60 ft for half the damage
  Condemning Strike     WIS save or frightened   ·   DC 14 (8 + 3 prof + 3 WIS)
```

Note what is happening: only the first two lines are *computed*. The rest are
**reminders attached to the roll** — prose the player applies, exactly as they
already do for attacks. A feature declares which rolls it is relevant to, and the
roller filters active features for matches. Same one-level filter as roll
contributions; no derivation, no graph.

This is worth building **regardless** of any later decision about a computation
engine, and it is most of what makes Dicecloud feel complete. The two are
separable: what is admired there is usually the presentation, not the graph.

It also does the work the DM would otherwise do from memory — "does anything
trigger off this hit?" — which is the single most common thing to forget at a
table.

### When to revisit the computation-engine decision

The flat design is a **"not yet", not a permanent architectural commitment.** Roll
contributions are a strict subset of what a graph would do — same data, less
resolution — so a graph can be added on top later and the existing data migrates
into it. Choosing flat now forecloses nothing.

**The trigger to reopen it:** when keeping numbers correct requires editing more
than a handful of features per session. That is the point at which manual
maintenance costs more than dependency resolution would.

Until then the arguments against it hold, in this order:

1. **Debugging inverts.** A wrong number in a flat system has one place to look;
   in a graph it is the end of a chain that must be traced backwards — mid
   session, with players waiting, by the person who is also the DM.
2. **Authoring becomes programming.** Expressions with variable names, scope and
   syntax that can be wrong, whose failure mode is a silently different number
   rather than an error.
3. **Edits break at a distance.** Rename or delete something and unrelated values
   downstream quietly change with no error.
4. **Checkability** — *weaker than it first appears.* A graph that shows its work
   stays checkable; what actually degrades is DEPTH. One level (`DC 14 = 8 + 3
   + 3`) is glanceable, three levels is a tree. The flat design stays at one
   level by construction.

What is NOT an argument against it: "it automates adjudication." A graph computes;
it does not decide whether a creature counts as judged. That concern belongs to
triggers, not derivation.

The conditions that justify a graph — many characters, many authors who never
speak, rules changing often enough to need propagation — describe Dicecloud's
users, not one DM authoring for three players in the same room.

### The escape hatch that keeps this from becoming a slog

**The structured part is opt-in per feature.** Every feature can always be pure
prose. The DM adds an effect block only when there is a number worth the app
carrying. The catalog form should make the effect block collapsed-by-default,
exactly like the item form's CONTAINER sub-section.
