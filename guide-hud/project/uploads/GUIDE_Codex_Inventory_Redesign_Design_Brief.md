# G.U.I.D.E. Codex — Inventory & Equipment Redesign (Design Brief)

Changes to the existing **Inventory** and **Equipment** player screens, plus one small
addition to the DM **Catalog Manager**. Everything keeps the established visual language.

**Visual language (unchanged):** `#1d1d1d` base, `#dedede` text, `#aaaaaa` muted,
`#d4bf7d` beige, `#00a6d6` cyan (player primary), `#e2b021` amber (system-truth only),
`#b93a3a` red (destructive). Cinzel headers, EB Garamond body, JetBrains Mono UI labels.
Angular clip-path corners, scanline overlay, CRT vignette, numbered `01 SECTION` labels.

---

## The concept change

The spatial grid used to be the whole inventory — 80 cells, capped. It now becomes a
**small loadout of what the character can physically reach**: belt, pockets, quick-access.
Bulk storage moves into **containers**, shown as unlimited filterable lists. Carry weight
becomes the only capacity limit, and it only ever slows the character down — it never
blocks picking something up.

Design consequence: the grid should feel **tight and tactical**, not spacious. Containers
should feel **effortless to browse**, not spatial.

---

## 1. Inventory screen

### Remove
- **The `n / 80 SLOTS` and `FREE` readouts** in the burden manifest. Slot count is no
  longer a limit — only weight is. Keep the weight figure, the encumbrance bar, and the
  ENC / HEAVY threshold markers exactly as they are.
- **The `02 ITEM DETAIL` panel** in the right column entirely. It is replaced by a popup
  (§3). This frees roughly 40% of the right column — give the space to the cargo panel,
  or let `LOAD / COIN` breathe.

### Change
- **The grid shrinks to 5 columns × 4 rows (20 cells).** Fixed size, no growth, no
  scrolling. These exact dimensions are required on every screen size — do not make the
  column count responsive.
- **Rename the section** from `CARGO GRID` to something that reads as a loadout —
  `ON PERSON` is the working name. The section should communicate "what you can reach,"
  not "your inventory."
- Cells stay visually as they are (category tint, rarity border, corner icon, quantity
  badge). Only the count changes.

### Add
- **A container switcher** at the top of the cargo panel — a segmented control in the
  console style: `ON PERSON | BACKPACK | REMOTE CACHE`. Selecting a tab changes **only
  the contents of that panel.** The surrounding chrome, the right column, and everything
  else must stay perfectly still. No overlay, no screen transition — the seamless feel is
  the point.
- **Tabs appear only for containers the character has equipped.** Design the empty case
  too: with no containers equipped, the switcher shows `ON PERSON` alone (or hides).
  Design for up to four tabs so a quiver or pouch fits later.
- **Container views are LISTS, not grids.** Each row: icon, name, quantity, weight,
  category tag. Comfortable row height, scannable at 100+ rows. Include a sort control
  (name / weight / value / category).
- **Category filter chips** above the list: `ALL · WEAPON · ARMOR · CONSUMABLE · TOOL ·
  QUEST · MISC`. Active chip in cyan. This is the primary way to navigate a large hoard.
- **A container header line** per list view showing what it is and what it holds —
  e.g. `BACKPACK · 24 ITEMS · 41.5 lb`, and for the bag of holding,
  `REMOTE CACHE · 12 ITEMS · WEIGHTLESS`.

### Flavour note (optional but encouraged)
The bag of holding is an extradimensional space inside a digital world — i.e. off-device
storage. `REMOTE CACHE` is the in-fiction name. Subtle system-y treatment (a latency
readout, a sync tick) fits the horror seeding, but keep it quiet — cyan, not amber.

---

## 2. Equipment screen

### Add
- **A `CARRY` module** — full width, positioned below the `04 GEAR` slot grid, styled as
  a visual **sibling of the `SHARDS` panel**. Rationale for the visual pairing: shards
  extend what the character can *do*; containers extend what they can *hold*. Both are
  system extensions and should read as the same class of thing.
  - One row per equipped container: icon, name, and what it grants
    (`BACKPACK · 24 ITEMS · 41.5 lb` / `BAG OF HOLDING · 12 ITEMS · WEIGHTLESS`).
  - Design the empty state so it reads as an equip target, not a blank panel.
- **A `back` equip slot** so a backpack can be equipped like any other worn item. It does
  **not** get its own card in the 6-slot gear grid — see below.

### Do NOT
- **Do not add a 7th card to the gear grid for the backpack.** Helmets and boots modify
  the character; containers modify the inventory screen. The `CARRY` module is their home,
  and it shows capacity, which a plain slot card could not.

---

## 3. Item detail — tooltip + popup

### Remove
- The persistent right-column detail panel (see §1).

### Add — hover tooltip (desktop only)
A small tooltip on cell/row hover. **Facts only:** name, category, rarity, weight, and the
single key stat (damage or AC). **No description prose. No buttons.** It exists purely for
scanning; if prose goes in it, it recreates the problem this redesign solves.

### Add — item popup (both platforms)
Clicking any item — in the grid **or** in a container list — opens a focused popup.
**Reuse the existing shard-upgrade modal pattern** (frame, backdrop, close treatment) so
"click a thing, get a focused panel with actions" becomes one consistent gesture app-wide.

Contents:
- Full item name, category, rarity, weight, value
- Full description (player-facing prose)
- Granted effects and granted features, if any
- Actions: `EQUIP` / `UNEQUIP`, `DROP`, and `STOW` / `RETRIEVE`
  (`STOW` moves an item from the grid into a container; `RETRIEVE` moves it back. The
  same popup serves both directions, so the player never drags between tabs.)

**Give the popup a max height with internal scrolling**, so an information-dense item
scrolls inside its own panel rather than stretching the layout.

### Platform behaviour
- **Desktop:** hover → tooltip → click → popup.
- **Touch:** tap → popup. **No tooltip at all.** Hover works on desktop because it costs
  nothing; on touch, a tap that yields only a preview is strictly worse than a tap that
  yields everything.
- On touch, the popup should render as a **bottom sheet** — slides up from the bottom,
  swipe down to dismiss, action buttons in the thumb zone. Same component and content,
  different placement.

---

## 4. Catalog Manager (DM view) — small addition

In the **item edit form**, add a `CONTAINER` sub-section (styled like the existing
`EFFECTS GRANTED` sub-section), shown when the item is a container:
- A **weightless** toggle — labelled to read as the bag-of-holding property (contents do
  not count toward carry weight).
- An optional **allowed categories** multi-select — restricts what the container accepts
  (empty = anything). This one control covers quivers, component pouches, and scabbards.
- Add `back` to the existing equip-slot select.

No grid dimensions are needed — containers are lists.

---

## 5. What to evaluate

1. Does the on-person grid read as a **tight tactical loadout** rather than a shrunken
   inventory? Does the section name and framing sell "what you can reach"?
2. Does switching container tabs leave everything around the panel **perfectly still**?
3. Are container lists comfortable to scan at 100+ rows, and do the filter chips make a
   large hoard genuinely navigable?
4. Does the `CARRY` module read as a sibling of `SHARDS` — a system extension — rather
   than as leftover gear?
5. Does the tooltip stay strictly to facts, with all prose and actions in the popup?
6. Does the popup reuse the shard-modal language closely enough to feel like the same
   gesture, and does it scroll internally when the content is long?
7. Is the whole screen still cohesive with the established player-side aesthetic?
