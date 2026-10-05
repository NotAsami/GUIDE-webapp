# Feature Editor — surface reference

What the DM's feature-authoring screen actually contains, field by field. Written for
anyone (or anything) that needs to design against the current surface rather than the
original mockup: `guide-hud/project/G.U.I.D.E. Feature Editor.html` is two-thirds of
this screen and none of the op schema.

**Code.** `src/screens/FeatureEditor.tsx` (screen, list, form, overlays, popovers) ·
`src/components/GraphEffects.tsx` (the Rules/Variables/Tags block, shared with the
item, spell, class and shard-node editors) · `src/lib/opSchema.ts` (every op and every
field an op shows) · `src/lib/graph.ts` (`auditNode`, `matchCount`) ·
`src/components/authoring.module.css` (the one stylesheet all authoring screens use).
Graph and Script views (§11): `src/components/FeatureGraph.tsx` + `featureGraph.module.css`
· `src/lib/featureGraph.ts` (projection, layout, every canvas edit) · `src/lib/featureScript.ts`
· `src/lib/previewScope.ts` (the class-progression lens) · `src/lib/usePanZoom.ts`.

**The rule that shapes it.** A feature can always be pure prose. Identity and tags are
always visible; Variables and Rules are collapsed and opt-in. And the form renders
FROM schema — a new op is an `OPS` entry plus a resolver case, never a new branch in
the renderer.

---

## 1 · Layout

Three-region operator frame, same chrome as the Operator Console.

| Region | Contents |
| --- | --- |
| Topbar | `Operator//Feature Editor` · sub-line `Catalog · Features · Node Authoring` · live stats **Features / Rule Nodes / Issues** · `Root · Architect` pill · **Console** back button (returns to the console's catalog tab, not the party overview) |
| **01 · Features** | The library list: new/folder buttons, search, folder tree, feature rows. In Graph view, the **Node kinds** list beneath it. Then the **Feature Audit** (≤ 35% of the column, foldable to one line). The whole region folds to a 40px rail |
| Centre | Tools bar: **Form · Graph · Script**, the sync label, the id tag and the Duplicate/Delete kebab. Below it the chosen view (§3 the form, §11 the graph and script) |
| **03 · Inspector** | Graph view only: floats over the canvas's right edge, folds to a rail, opens itself for a selection while folded (§11) |
| Overlay slot | Two slide-in panels over the centre: **Origin Chain**, **Authoring Guide**. Both stay mounted; the closed one is `inert` |
| Footer | Validation status · dirty pip · autosave clock · telemetry line · **Revert / Save Draft / Publish** |

Decoration: `.stage`, `.scanlines`, `.vignette`, chamfered region frames with
`.rCorner` marks, and a per-feature colour wash on the region-03 header.

---

## 2 · Region 01 — the feature list

- **New Feature** (cyan) and **Folder** (ghost) buttons.
- **Search** — plain text matches names; `tag:x` / `roll:x` switch it into *selector
  mode* (crosshair icon, and a hint line saying what the list now means — shown only in
  selector mode) and match features whose **effects target** that selector.
- **Folder tree** — folders are `/`-separated paths (`src/lib/folders.ts`), so nesting
  is real: rows indent by depth, a collapsed parent shows a *deep* match count for
  everything it hides, and `Unfiled` is a display bucket for `folder: undefined`. A
  search force-opens every folder — a closed folder must never answer "no results" to
  a query that has results.
- **Drag** a row to reorder within its folder, or onto a folder head to refile it.
  Drop position is decided by index direction, not the row midpoint, so the whole row
  is a target.
- **Feature row** — icon in a frame tinted by the feature's colour, name, source
  label, the matched selector (in selector mode), a `draft` / `unpublished` chip, and a
  dot that turns red when that feature has unresolved audit **errors** (computed with
  the same `auditNode` the form uses).

---

## 3 · Region 03 — the form

The header carries the feature **id** (locked, `on first save` before the first save,
with a `?` explaining why ids never change) and a kebab menu: **Duplicate feature** /
**Delete feature**, both disabled with a note while the draft is unsaved.

### 01 · Identity

| Field | Type | Notes |
| --- | --- | --- |
| Name | text, **required** | |
| Icon | picker | Opens a popover: one search field over Font Awesome **and** game-icons.net (`gi:` prefix, lazy-loaded manifest, attribution shown), plus the six-swatch **Console palette** for colour |
| Colour | native colour input | Free choice; the six console swatches are offered in the icon popover |
| Source | enum | `class · feat · racial · background · sense · other` |
| Source detail | text | e.g. `Fighter 1` |
| Prerequisite | text | A small language the app reads (`Level 9+`, `Strength 13+`, `Strength or Dexterity 13+`, `Reckless Attack Feature`). Deliberately NOT a prose field. Audited, and both failures warn rather than block |
| Origin chain | summary + button | Opens the Origin Chain panel. Empty = derived from source, level and name |
| Folder | select | Flat list of full paths, indented by depth |

### Prose

Two player-facing fields, each with an eye badge and a **live `ProsePreview`**:

- **Card text** (`light_description`) — one line, on the collapsed card. No length cap.
- **Detail text** (`deep_description`) — auto-growing textarea, the expanded card.

Both run the `markdownShortcuts` contract: `**bold**` (reads cyan), `*italic*`,
`[text]{colour}` colour spans, Ctrl+B / Ctrl+I to wrap and unwrap. The preview
evaluates `{braces}` against a `previewScope` probe, so the DM sees the number a player
would, not the expression.

### Activation, uses, and the press

| Field | Type | Notes |
| --- | --- | --- |
| Activation | enum | `none (passive) · action · bonus · reaction · free`, each with a coloured note explaining what the player gets |
| Trigger | enum | `Press only · When you roll initiative · When you drop to 0 HP · At the start of your turn` — `trigger`. Something else presses the feature: a press that spends nothing and asks nothing **runs**; one that spends a use, a slot or another counter, or asks, is **offered** in the roll panel (Use / Dismiss) and lapses when the same event comes round again. A trigger on a feature with nothing to press is an audit error. The Graph view prints it on the press node |
| Max uses | **formula** | Not a spinner: `rages` is "the Rages column of the Barbarian table". Blank or 0 = at-will. `current` is never written — absent means full |
| Resets on | enum | `Manual (DM) · Start of your turn · Short rest · Long rest`; disabled without uses |
| Of its N offers, the player may take | formula | `picks`. Appears **only** when the feature has two or more armed offers (a `once` effect carrying an `ask`) |
| …and on a short rest, give back | formula | `shortRecharge`. Appears only when Resets on = Long rest — "all on a long rest, one on a short" is Rage, and no single recharge value says it |
| Press rolls | dice | `roll`. Literal dice only — `2d6 + 2` or a plain number. A formula belongs in an `add` with no target |
| and that is | enum | `rollTone`: shown only · healing (raises HP) · a buff |
| Called | text | `rollLabel`, the name on the result |

Standing notes explain that uses are independent of activation, and that the press roll
is dice-not-formula.

### 02 · Tags

Chips plus an input with autocomplete over **every tag in use anywhere** and its count.
Normalised on save (`normalizeTag`), because `radiant` / `Radiant` / `radient` all look
right and match nothing. Tags reach across catalogs — a tag is how one effect targets a
spell, a weapon and a shard node at once.

### 03 · Variables (collapsed, opt-in)

One card per variable, `data-audit`-addressable.

- **Stored** — saved on the character. Fields: name (identifier), **Type** (Number /
  Boolean), **Initial value**, **Resets on** (`Never · Start of your turn · Short rest ·
  Long rest`), **scope** (Player / DM-only), Display label.
- **Derived** — never stored, recomputed on read, so no type to pick. Two mutually
  exclusive sources: a **Formula**, or **Feature uses** — a picker over every feature in
  the catalog, which is the only way to ask "how many Rages are left". A use-counter
  variable resolves after every other variable, so no formula may read it (the audit
  says so); use it in a `when`, a value, or a note.

### 04 · Rules (collapsed, opt-in)

The op palette in three groups, then one row per node.

- **Contributions** — `Add · Adv · Dis · Crit · Resist`, with **More** revealing
  `Vuln · Immune · Floor · Reroll · Note`.
- **On the sheet** — `Boost · Use Ability · Unarmored AC`. Its own group because it
  answers "what is this character's DEX", not "what does this roll add" — and it is the
  only group with no target at all.
- **Activation outcomes** — `Set Var · Add Var · Add Uses · Add Slot · Set HP · Grant`.
  What happens when the player presses Use.

**Collapsed row**: chevron, op glyph, op name, label (or a red `no label`), value bit,
target summary (`|` for OR, `+` for AND, `own roll` when empty), `when`/`ask` flags,
delete. Colour-coded per group.

**Expanded card**: `NODE 01` index, an op `select` (switching the op keeps targets,
label, both gates and every field the new op shares — changing the verb must not lose
your work), a group pill, the op's blurb, then:

1. **Target** (absent on sheet and activation ops, which say so in a note instead) — §5.
2. **Parameters** — rendered from `OPS[op].fields`; an op with none says "fully
   described by its target list".
3. **Statement** — **Label** (required: an unlabelled number in a breakdown is the bug
   the roll panel exists to prevent), then the two gates, §6.

---

## 4 · The op catalog (`src/lib/opSchema.ts`)

`group: passive` modifies a roll · `sheet` changes a sheet number · `activation` runs on
a press and writes. Every op's `blurb`, and every field's `desc`/`example`, are the
single source for the inline help and the authoring guide.

| Op | Group | Fields | What it does |
| --- | --- | --- | --- |
| `add` | passive | Amount (formula), Damage type (enum, 13 SRD types), Arms once, One across all targets, By level (21-slot array) | Numeric contribution to every matched target; stacks |
| `adv` / `dis` | passive | Arms once, One across all targets | Advantage / disadvantage; the target list is the whole statement |
| `crit` | passive | Crits on (formula), Arms once, One across all | Lowers the crit threshold; the lowest threshold across nodes wins |
| `floor` | passive | At least (formula) | Minimum on the finished d20 total ("use your Strength score instead"); the highest floor wins |
| `reroll` | passive | The new roll is (`advantage` / `new` / `better`), Only dice showing at most (formula) | An *offer* on a finished roll — it appears in the roll panel, never automatic. A d20 roll or a damage roll, never both in one effect |
| `note` | passive | Note text (prose, `{braces}` compute), Arms once, One across all | Rules text on the target without changing a number |
| `resist` / `vuln` / `immune` | passive | — | Halve / double / nullify the matched damage kind (target a tag) |
| `boost` | sheet | Stat (enum, modEditor's vocabulary), Amount (plain number), Up to a maximum of (number) | Moves a number ON THE SHEET — a racial +2 DEX, so every save and skill made from it moves too. The cap clamps the summed result, ability scores only, and never lowers |
| `useability` | sheet | Ability (enum) | "You may use WIS for attack rolls" — a MAY, best-of, on the wielder not the weapon |
| `unarmored` | sheet | Base (number), Plus besides DEX (enum) | Base AC while wearing no body armour. Replaces armour rather than stacking; shields still add; two rules take the better |
| `setVar` | activation | Variable (ref), Value (formula) | How a feature turns itself on. DM-only variables are refused |
| `addVar` | activation | Variable (ref), Change by (formula) | Increment a variable; negative spends a charge |
| `addUses` | activation | Change by (formula) | Moves a USE COUNTER — this feature's, or (with a feature target) another's. Clamped to that feature's max |
| `addSlot` | activation | Change by, Slot level, Or a budget of levels, …and no slot above level | Spends or restores spell slots. Blank level = the player picks at the press; a budget is combined levels and opens a picker; an unpayable cost refuses the whole press |
| `setHp` | activation | Hit Points become (formula) | Sets current HP (Relentless Rage). Clamped 0..max; `hp + 10` is how you heal |
| `grant` | activation | Amount (formula), By level (array) | Arms a bonus on ANOTHER party member (Bardic Inspiration). Resolved against YOUR scope at press time and snapshotted |

**Field types are a closed set**: `formula · number · text · selector · enum · boolean ·
reference · array`. `number` exists separately from `formula` because a sheet layer has
no roll to evaluate against — dice and identifiers there are audit errors. `array`
renders the 21-slot level grid with index 0 disabled, a filled count and an "overrides
Amount" note; sparse means *step* (1/5/11 = "3 from level 11 up").

---

## 5 · Target selectors

Three namespaces, OR'd by default. `thing` = one catalog entity by gid (picked by name
from a searchable popover over the live catalog: features, spells, items, weapons,
shard nodes); `tag:` = everything carrying the tag; `roll:` = a class of roll. An empty
list = the node's own roll.

Each row shows a **match count** — the only signal that separates a typo from a
selector that correctly matches nothing yet; a roll kind reads `always live`. A
per-effect summary sits in the sub-header. With two or more selectors an **or / and**
toggle appears: `and` requires every selector to hold of the *same* roll, which is the
only way to say "a fire weapon, on its damage roll".

`roll:` vocabulary: `d20` ·
`attack[.melee|.ranged|.spell|.str|.dex|.con|.int|.wis|.cha]` ·
`damage[.melee|.ranged|.spell]` · `save[.str…cha]` ·
`check[.athletics|.stealth|.perception|.initiative]` · `feature`.

---

## 6 · The two gates

- **`when`** — *formula · the app decides*. Gates EXISTENCE: false and the effect never
  surfaces. A **player toggle** button beside it declares a stored player bool named
  after the effect and points `when` at it in one press — that is how "while the hood is
  up" is authored, and the variable then shows in the Variables block like any other.
- **`ask`** — *prose · a human decides*. Gates RESOLUTION, orthogonal to `when`. It is
  also the **grouping key**: effects sharing one `ask` become a single checkbox, so the
  asks already on the node are offered as a `datalist` rather than retyped. On a `note`
  it REVEALS rather than applies.

Both carry a `?` opening a help popover.

---

## 7 · The audit

`AuditPanel` under the feature list (region 01), shared with the class and shard editors;
rows are clickable and **jump to the offending field** (`data-audit` + `revealAudit`, which
opens the Variables/Rules blocks first). In Graph view a row that names a rule or a
variable selects and pans to that node instead; a feature-level row switches to Form.
Errors block Publish; warnings do not.

Node-level checks come from `graph.ts auditNode` — variable cycles, formulas that do
not resolve at probe values, unknown identifiers, duplicate or badly named variables,
stored-vs-derived contradictions, a value on a flag op, arming without a roll target,
reroll/keep/die-kind mismatches, unknown stats and abilities, boost formulas that read
more than level, caps on stats with no ceiling, writes to derived or DM-only variables,
empty and zero-match selectors, `and` lists that can never match.

Feature-level checks on top: unnamed feature · no card text · no detail text · uses that
never reset · `picks` with nothing to choose between · a press roll that is not dice · a
roll with no tone ("shown, not applied") · a free stance (uses plus a toggle with
nothing that spends one) · unknown identifier or non-evaluating formula in Max uses · a
prerequisite that cannot be read, or that names no known feature.

---

## 8 · Overlays

- **Origin Chain** — an ordered list of free-text steps (add / remove / move up / move
  down) plus **As the player sees it**, the live breadcrumb with arrows and the last
  step marked. Blank steps are dropped on save.
- **Authoring Guide** — thirteen sections: Prose is enough · Prose that computes · when
  vs ask · "While the hood is up" · Target selectors · Tags · Variables · Activations &
  arming · What the player sees · Where to author what · Field types · Draft, save,
  publish · Audit. Carries a **Per-field help** toggle that expands every field's
  `desc`/`example` inline throughout the form.

---

## 9 · Saving

The draft ladder is three rungs: `localStorage` (autosave, every keystroke, this browser
only) → `feature_catalog.draft` (a DM-only column, migration 0014) → `data` on
**Publish**. `data` is the only thing a grant may snapshot, so nothing a player sees
moves until Publish — and existing grants are snapshots, so they never change underneath
a player.

Footer: validation status (`N errors — publish blocked` / `N warnings — publishable` /
`Draft valid · publishable`), an `● Unpublished changes` pip, the autosave clock, and
**Revert** (confirm popover) · **Save Draft** · **Publish** (disabled while errors
stand). Toasts confirm; popovers cover icon, thing, `when`/`ask`/target help, why the id
is fixed, delete, revert and new folder.

---

## 10 · Deltas from the mockup, in one list

Added: the `sheet` op group (`boost`, `useability`, `unarmored`) · `floor` · `reroll` ·
`addUses` · `addSlot` · `setHp` · `grant` · `dmgType` · `once` / `oneOf` / `match: and` ·
`cap` · prerequisite · origin chain · `picks` · `shortRecharge` · press roll
(`roll`/`rollTone`/`rollLabel`) · formula Max uses · variable use-counters, resets and
the player-toggle shortcut · nested folders · live prose previews and markdown shortcuts
· the real catalog behind target pickers and tag autocomplete · the shared `auditNode`
vocabulary with jump-to-field · the server-side draft column and a Save Draft button ·
game icons in the picker.

Removed: `tempHp`, `heal`, `grantEffect` — folded into `setHp` and `grant`.

The Graph and Script views have their own mockup (`G.U.I.D.E. Feature Graph.html`); its
deltas are in §11.

---

## 11 · The Graph and Script views

Three views of ONE draft: Form, Graph, Script. The graph and the script are projections
(`featureGraph.ts project()`), never a second copy — the only thing they own is
`layout` (positions, groups, pending gates), which the engine never reads. The editor
reopens in the view, fold state and preview it was left in (`guide.featureEditor.view`).

**What a node is a view of.**

| Node | Is | Edited by |
| --- | --- | --- |
| Press (pointed) | `activation`, `uses`, `recharge`, present when `isUsable()` | the inspector's copy of the form's own `ActivationFields` |
| Condition / Ask | the `when` / `ask` text shared by the activation outcomes behind it | its text in the inspector rewrites every outcome under it |
| Activation outcome · Contribution · Sheet rule | one `GraphEffect` | the form's own `EffectCard`, in the inspector |
| Variable | one `VarDef` | the form's own `VarCard` |
| External / Roll context | an identifier another node, the engine or `has_*` declares; a roll fact | read-only |
| Picks | `picks`, with `once` + `ask` contributions as its offers | `ActivationFields` |
| Target | one selector, from every rule's `target` list | retarget / remove in the inspector |

**Wires.** Flow (thick, pale): the press through its gates to each outcome — every
activation op runs on the press, so there is no unwired outcome. Data (thin, by type):
the identifiers a formula reads — show-only; edit the formula. Dotted amber: the press
arming a `once` rule. Dashed amber: an offer counting toward Picks. Orange: applies-to,
dashed when the rule has a `when`, dotted cyan when it has an `ask`; an `and` list meets
at a diamond junction.

**Editing on the canvas.** Drag nodes (positions save with the draft). Add with the Node
kinds list, a double-click or **A**. **Del** deletes a node — a gate hands its outcomes to
its parent, a target leaves every rule; the press, externals and roll context refuse.
Drag a flow wire from the press, an Ask or a Condition onto an outcome or gate
(`regate`): the outcome takes that path's `ask`/`when`, a condition hung under another
becomes `(a) && (b)`, and anything the schema cannot hold (two asks on one outcome, a
contribution, a gate under itself) is refused with the reason. A new Condition/Ask is
**pending** — kept in `layout.pending`, marked *unwired* — until an outcome is wired into
it. Drag a rule's square port onto a target, or onto open canvas to choose one; a click
selects a wire, **Del** removes that entry, the `or`/`and` badge toggles `match`. Target
legality is the audit's own answer (`targetRefusal`), never a second copy of the rules.

**Reading.** Zoom levels: **Overview** (≤ 50%) shows kind and name only; **Detail**
(≥ 115%) adds up to three lines per node. Shift-click or Shift-drag selects several nodes,
which drag together; **G** frames them in a group (layout only — Del on a group removes the
frame, never the nodes). The **class-progression** lens picks a class and one of the levels
where its grants change: it decides only `level` and that class's `has_*`, enumerates
unknown booleans through the real evaluator, leaves anything over an unknown number (or a
stored variable) undetermined, and never decides an `ask`. A contribution that is
definitely off dims with "Not at <class> <level>"; labels' `{…}` resolve where decided.

**Script.** A LOCKED placeholder: read-only text in a placeholder syntax, line ↔ node
selection. Its language is in `GUIDE_Codex_Deferred.md`.

**Deltas from the mockup.** Kept out on purpose: proposed triggers other than the press
(deferred), authoring data wires, the "Rule failures" demo. Not yet ported: applies-to
connect notices, the junction inspector, the Detail height tween. Ported with a change:
"graph helps / form fits" is derived (`graphFit`), not hand-set, and only "graph helps"
is tagged in the list; "Affected by" covers the feature catalog only (spells, items and
shards are other catalogs), and Peek is a block in the inspector, not a floating card. Changed:
region 01 folds (user's request), the inspector is 390px (the real effect card needs it),
side-by-side was removed.

**Not this.** The catalog-wide "which features feed which" graph of
`GUIDE_Codex_Graph_Engine.md` §27 is a different view and is still unbuilt.
