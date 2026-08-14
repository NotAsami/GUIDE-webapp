# G.U.I.D.E. Codex — Feature Graph Engine

**Supersedes §17 of `GUIDE_Codex_Inventory_Refactor.md`.** Delete that section once this
doc lands — it argues against the architecture described here, and leaving it in place
teaches the wrong lesson to anyone reading later (including future-you).

---

## 0. What changed, and why

§17 specified a deliberately flat model: contributions target rolls, never each other,
one level deep, no chaining. That was the right call *for the user it modelled* — a DM
who wants numbers to work without maintaining a dependency web.

It modelled the wrong user. Sam is a Dicecloud power user who authors deep conditional
graphs recreationally, enjoys debugging them, and has built entire classes around
state-switching feature trees. Every argument §17 made against a graph (debugging
inverts, authoring becomes programming, edits break at a distance) described costs Sam
does not experience as costs.

**What survives from §17, unchanged:**
- **The engine never infers a trigger.** No combat simulation, no targets, no initiative.
  A feature is a button pressed when the fiction says so; the app does the bookkeeping.
  The test remains "is this a write the app performs?"
- **The five-category ladder**, and the fact that category 1 (prose + a use counter) is
  the largest group and needs no machinery at all.
- **Prose is a legitimate outcome**, not a failure. Advantage, immunity, and adjudicated
  conditions stay text a human applies.
- **The escape hatch:** structured effects are opt-in per feature. Every feature can
  remain pure prose. The effect block is collapsed by default in the editor.
- **Numeric always-on modifiers reuse `ItemEffects`.** Never pretend advantage is a flat
  number.

**What changes:** features may reference and modify other features. Derivation is a real
graph, resolved at roll time.

---

## 1. The one hard rule

> **The graph is an authoring concern. The panel is a reading concern.
> They are allowed to have completely different shapes.**

This is the whole design. Dicecloud's engine is admired; its presentation is not. The
authoring model may be as deep and conditional as desired. The player-facing roll context
panel renders **flat**: composed results, plus the toggles a human must decide. No
nesting, no indentation, no derivation tree, no features the player cannot use.

Every rendering question resolves against this line:
- A toggle appears **only** because a human has to decide something.
- A number appears **already composed**.
- Nothing about the graph's structure leaks into the player's view.

---

## 2. Data model — named targets (model C)

Three models were considered:

| | Model | Identity | Verdict |
|---|---|---|---|
| A | Nested nodes (Dicecloud) | Positional — a node's parent defines what it applies to | **Rejected.** One parent per node, so a node needing two independent sources can't be expressed without duplication or path references. Cross-library targeting breaks on any move. This is the pain Sam already hit. |
| B | Nodes + explicit edges | Edge rows | Viable — it's the shard lattice model. But edges are author-time snapshots; they go stale as content is added. |
| C | **Nodes + named targets** | Nominal — stable ids and tags | **Chosen.** |

### Why C

**Identity is nominal, not structural.** Every feature, spell, attack, item, and effect
carries a stable id and a set of tags. A reference names its target — `spell:burning-hands`,
`tag:fire` — and does not care which source it came from. A shard feature retyping a
spell works identically whether that spell arrived from the SRD import or homebrew.
**Source becomes metadata, not addressing.** This is the direct fix for cross-library
targeting.

**C is a superset of B.** An id target is a selector matching exactly one thing.

**Targets resolve at read time, not write time.** When the SRD import lands forty new
fire spells, a `tag:fire` feature written today already covers them. No edges to backfill,
no stale references. Given an SRD import and continuously growing homebrew, this matters
more than the expressiveness.

### Derived edge index

Targets are the source of truth. At load time, resolve every target into the concrete
things it currently matches and build an **edge index** as a computed view. This buys
B's advantages for free:
- Reverse queries — "what targets Judgment's Cut?" — for the editor and the linter.
- Cycle detection as a standard graph walk.

Derive, don't store. Same discipline as carry weight, gear features, and available
container tabs.

### Scoping

**Targeting is scoped to the character's currently active content — not the catalog, and
not everything owned.**

"Active" excludes unequipped items and their granted features. An unequipped item counts
as non-existent for targeting purposes, consistent with how gear features already appear
and disappear with loadout. This must be explicit in the resolver, not an emergent
property of it.

### Tags

Free-text fields on every editor (item, spell, feature, shard node, attack) — the
Dicecloud pattern.

Two safeguards, because free-text tags fragment silently (`radiant` / `Radiant` /
`radient` all look correct and match nothing):
- **Normalize to lowercase on save.**
- **Autocomplete from tags already in use.** Keeps free-text speed while making the
  common case — reusing an existing tag — a pick rather than a retype.

---

## 3. What the engine is

One operation:

> **Resolve everything that applies to this roll, for this character, in this state.**

Integrations are *callers*, not features of the engine. Attack, damage, save, check,
spell attack, spell save DC — each passes a different roll kind. This is why the
armed-modifier queue must be **keyed by roll kind from the start**, not attack-only.

Under this model an integration slice is mostly wiring an existing screen to a resolver
that already works, not building new engine capability.

### Build order

1. **Core engine** — resolution, target matching, conditional evaluation, state.
2. **Editor** — the authoring UI (§5).
3. **Validation** — cycle detection, dangling targets, match counts (§4).
4. **Integrations, one slice at a time** (§6).

Do not build the engine against attacks first and retrofit. Attack-shaped assumptions
will bake into the resolver.

---

## 4. Validation

Precedent already exists: the **Shard Lattice Editor's Lattice Audit** — blocking errors
disable Publish, warnings inform. Reuse that pattern's shape.

**Blocking:**
- **Cycles.** A feature graph that can reference features can reference itself. Must be
  caught at author time with a clear error, never discovered as a hang mid-session.
  This has no equivalent in anything built so far and bites hardest if deferred.
- **Dangling id targets.** A `spell:` or `feature:` target naming something that doesn't
  exist.

**Non-blocking, but essential:**
- **Live match count in the editor** — "this targets 7 things." This is the *only* signal
  distinguishing "correctly targets nothing yet" from a typo, because a tag matching zero
  things is not inherently an error. It is the one safety net C loses relative to B, and
  the match count is how it's paid back. Same instinct as the shard editor's cost-ceiling
  warning: validate intent, not just syntax.

---

## 5. Feature editor — complete redesign

The current DM-view feature form is a flat prose form. It cannot express targeting,
conditions, or state. This is a **full redesign**, not an iteration.

Goal: Dicecloud's authoring *power* in the Codex's own visual language. Sam should feel
at home in it. Design prompt is a separate deliverable.

Structural requirements:
- Effect/targeting block **collapsed by default** — the §17 escape hatch survives. Prose
  features stay one field.
- Tag input with autocomplete on every editor that participates in targeting.
- Live match count beside every target selector.
- Validation surfaced inline, Lattice-Audit style.
- The editor may render structure as a tree if that feels right — but it is a *view* over
  flat nodes with named targets, never nested storage.

---

## 6. Integration slices

Each is a separate slice after the core lands. Enumerated so nothing is forgotten;
detailed specs come per slice.

| Slice | Notes |
|---|---|
| **Attacks** | The reference implementation. Roll kinds `attack`, `damage`. |
| **Spells** | Spellbook slice landed (`Spell`/`CharacterSpellbook` in database.types.ts, `Spellbook.tsx`). No stable `spell:<id>` graph ids yet — `spell_catalog` rows use a `spell_<base36>`/UUID id, not a slug — and this engine itself is still unbuilt, so nothing consumes them yet. |
| **Saves & checks** | Blocked on the Character (Rolls) screen, still a router stub. Once it rolls, `save` and `check` become real targets and roll context applies unchanged. |
| **Items** | Item-granted features participate in targeting. Scoped to equipped only. |
| **Shards** | Shard node features participate. The retype-a-spell case lives here. |
| **Backgrounds / racial** | Same mechanism, no special handling. |

---

## 7. Roll context panel

Already designed; implementation deferred. Splits cleanly:

- **Base breakdown** — dice, static modifiers, crit/fumble, dropped die, damage-type
  colour. **Needs nothing from the engine.** Ships standalone today.
- **Riders** — needs engine data to have anything to show.

A character with no authored rider features shows a clean roll and a quiet rider section.
Not broken — just empty until authored.

**Pre-roll rule (carried from §17, unchanged):**
- **Unconditional** contributions → pre-roll and show the value. Pure convenience.
- **Conditional** contributions → show the *formula* with a one-tap roll. The player
  decides whether the condition applies, *then* sees the number.

The reason is ordering, not entropy: a pre-rolled `1d6 [6]` shown before the player
decides whether the creature was judged puts a thumb on that decision. This extends the
core principle one step — **the engine never infers a trigger, and never front-runs the
player's decision either.**

---

## 8. Open decisions

All resolved.

| # | Decision | Resolution |
|---|---|---|
| 1 | Armed-modifier consumption on a miss | **Consumed on the next matching roll that RESOLVES.** An armed auto-crit does not burn on a miss. |
| 2 | Pre-roll timing | **Locked with the base roll.** Reopening the panel never re-rolls — that would be a free reroll and would undo the honesty property in §7. |
| 3 | `resources` namespace | **Additive** to the existing per-character shape (death saves, exhaustion). Not a parallel structure sharing a name. |
| 4 | DM console visibility of `active` state | **Yes** — the per-character console panel surfaces which features are currently ON (e.g. Rage). QOL, non-blocking, build when convenient. |
| 5 | Depth limit | **No cap.** Chaining is unbounded. Cycle detection (§4) is therefore load-bearing, not optional. |

---

## 9. What is still off the table

> **Amended.** The original rejection of anything turn-based rested on *"the DM is running
> combat at the table."* That premise was in-person play. This campaign runs online
> alongside a VTT, where combat is already on a screen and turn order is already explicit
> and externally announced — so the attention cost mostly evaporates and the cue to
> advance is reliable in a way it wouldn't be in person. A **per-character turn tick** is
> therefore in scope; the full tracker is not. See below.

- **A combat tracker.** Initiative order, enemy HP, targets, rounds as shared state.
  Marked creatures, per-creature limits, and on-kill triggers all require it, and it is
  the point at which the app becomes a VTT. **Still rejected.**
- **A target registry.** No targets means Condemnation's marked creatures and Balance
  Eternal's per-creature limit stay prose with a use counter.
- **Inferring triggers.** Unchanged and permanent. The graph *computes*; it never decides
  whether a creature counts as judged.

---

# Part II — Implementation plan

Written against the code as it stands (`src/lib/effects.ts`, `weapons.ts`, `shards.ts`,
`rest.ts`, `modEditor.ts`, `screens/Features.tsx`, `screens/ShardLattice.tsx`). Nothing
below is built yet.

## 10. The shape of the work

The engine is small. The **editor is the expensive half** — budget accordingly, and do
not let editor scope creep back into the resolver.

| Piece | Rough size | Notes |
|---|---|---|
| `lib/graph.ts` — types, gid, targets, formulas, resolve | ~250 lines | The whole engine |
| `lib/graph.test.ts` | ~120 lines | `node --test`, same idiom as `spells.test.ts` |
| Feature editor rebuild (`OperatorConsole.tsx`) | large | §5, separate design pass |
| Integration per slice | ~20 lines each | Wiring, not capability |

**No SQL migration.** Every new authored field hangs off JSONB that already exists
(`sheet.features[]`, `spellbook.spells[]`, item `features[]`/item rows, shard nodes), and
the one new state blob is `resources.graph`. If a slice proposes a migration, something
has gone wrong.

---

## 11. Addressing — the catalog id IS the stable id

§2 asks for nominal identity (`spell:burning-hands`). The temptation is to add a `slug`
field to every catalog row. **Don't.** Three reasons it's unnecessary:

- `spell_catalog` / `feature_catalog` / `item_catalog` rows already have stable primary
  keys, and every granted copy already carries the back-ref (`spell_id`, `feature_id`,
  `item_id`) precisely so a template can be matched later.
- Id targets are **never typed** — they are picked from a searchable list in the editor,
  which shows names. The author never sees `spell_k3f9q2`.
- A slug is a second name that can disagree with the first. Renames then silently break
  targeting, which is exactly the class of bug §2 chose model C to avoid.

Free text is for **tags only**, where fragmentation is handled by lowercase-on-save plus
autocomplete (§2).

```ts
export type GidKind = 'feature' | 'spell' | 'item' | 'weapon' | 'shardnode'
export type Gid = `${GidKind}:${string}`

/** Stable graph id. Reads the CATALOG back-ref first, falling back to the
 *  instance id for hand-seeded content that predates the catalogs.
 *
 *  The back-ref-first order is load-bearing, not a preference: Features.tsx
 *  gearFeatures() and lib/shards.ts shardFeatures() both REWRITE `id` when they
 *  derive a granted feature (`gear-<item>-<n>`, `shard-slot2-<node>-<n>`) so React
 *  keys can't collide. Keying the graph off `id` would give the same feature a
 *  different identity depending on which item granted it. */
export function gid(kind: GidKind, x: { feature_id?: string; spell_id?: string; item_id?: string; id?: string }): Gid
```

### Target selectors

Three namespaces, and that's the whole language:

| Selector | Matches | Example |
|---|---|---|
| `feature:` `spell:` `item:` `weapon:` `shardnode:` | exactly one thing, by gid | `spell:spell_k3f9q2` |
| `tag:<tag>` | anything active carrying that tag | `tag:radiant` |
| `roll:<kind>` / `roll:<kind>.<sub>` | every roll of that kind | `roll:attack`, `roll:save.dex` |

An effect with **no** target applies to its own node's roll (`self`). A target array is
an **OR** — matching any selector is enough. There is no AND, no negation, no wildcard;
add them only when a real feature needs one, and note here which feature forced it.

---

## 12. What gets added to the existing types

```ts
/** Free-text, lowercase-on-save. Added to Feature, Spell, EquippedItem, ShardNode. */
tags?: string[]
/** Structured contributions. Absent = a pure prose node — the §17 escape hatch. */
graph?: GraphEffect[]
```

```ts
/** Deliberately five ops, not a kind×field matrix. Each one exists because a
 *  catalogued homebrew feature needs it; add a sixth the same way. */
export type GraphOp =
  | 'add'    // numeric or dice addend  (+1d4 radiant, +2×prof)
  | 'adv'    // advantage — a flag, never a number (the ItemEffects rule)
  | 'dis'
  | 'crit'   // auto-crit / expanded crit range
  | 'note'   // prose rider shown beside the roll; the honest outcome for
             // anything adjudicated

export type GraphEffect = {
  id: string
  /** OR across selectors. Absent/empty = this node's own roll. */
  target?: string[]
  op: GraphOp
  /** `add` only. A formula (§14). Dice terms allowed. */
  value?: string
  /** Absent = unconditional → PRE-ROLLED and shown (§7).
   *  'manual'        = the player decides → a toggle, formula shown, rolled on tap.
   *  'active:<gid>'  = gated on feature state the app owns → no toggle. */
  when?: string
  /** REQUIRED. An unlabeled number in a breakdown is the bug §7 exists to
   *  prevent — the player must always be able to see where a number came from. */
  label: string
  /** `add` on a damage roll: the damage type, for the breakdown colour. */
  dmgType?: string
  /** Arms once instead of applying continuously (Boost Judgment's Cut). Moves to
   *  resources.graph.armed on activation; see §16. */
  once?: boolean
}
```

**Not added:** a `graph` on `ShardTree` itself (base effects). Author them on the core
node — `baseMods` exists because it predates the node editor, not because it's needed.
Add `baseGraph` only if a shard genuinely needs an effect before any node is attuned.

---

## 13. Resolution

One entry point, per §3:

```ts
export type RollKind = 'attack' | 'damage' | 'save' | 'check' | 'feature'

export type ResolveReq = {
  kind: RollKind
  /** Sub-key: 'dex' for a save, 'investigation' for a check. */
  sub?: string
  /** The gid of the thing being rolled — a weapon, spell, or feature. */
  subject?: Gid
  /** The subject's tags, so `tag:` selectors match. */
  tags?: string[]
}

export type Rider = {
  label: string; source: string
  formula: string           // shown when conditional
  flat: number; dice: string[]  // dice UNROLLED — the caller rolls, so crit doubling applies
  when: 'always' | 'manual' | 'active'
  on: boolean               // 'active' riders arrive already resolved; 'manual' start off
  dmgType?: string
}

export type Resolution = {
  flat: number; dice: string[]        // unconditional contributions, already composed
  adv: boolean; dis: boolean; crit: boolean
  riders: Rider[]                     // everything the panel renders
  notes: string[]                     // `note` ops
}

export function resolve(ctx: GraphContext, req: ResolveReq): Resolution
```

`spellAttack`, `spellDamage` and `spell save DC` are **not** roll kinds — they are
`{ kind: 'attack', subject: 'spell:…' }`. Kind × subject instead of a kind per source is
what keeps the union at five and stops attack-shaped assumptions leaking in (§3).

### The walk

1. **Collect** the active node set (§15) and build the edge index — `Map<selector,
   GraphEffect[]>` — once per character load, memoized.
2. **Match** the request against the index: subject gid, each of the subject's tags,
   `roll:<kind>`, `roll:<kind>.<sub>`.
3. For each matching effect, compute **that node's contribution value**, which is where
   chaining happens: evaluate the effect's own formula, then apply every effect targeting
   the *source node's* gid. Recursive, memoized by gid, with a visited-set guard.
4. **Partition** by `when`: absent → fold straight into `flat`/`dice`; `active:` →
   resolved against `resources.graph.active`; `manual` → a rider with `on: false`.

The memo key is the source node's gid, so a node contributing to six rolls is evaluated
once. The visited-set guard is belt-and-braces — cycles are supposed to be blocked at
author time (§4) — but it means a cycle that reaches production degrades to a dropped
contribution instead of a hung tab.

---

## 14. Formulas — a calculator, not a language

Whitelist: `level`, `prof`, `str dex con int wis cha` (modifiers, off the **effective**
sheet so gear boosts flow through), `hp`, `hpMax`, `cast` (the chosen cast level, only
when the subject is a spell).

**A formula is a sum of terms.** Split on top-level `+`/`−`; each term is either a dice
term (`2d8`) or a chain of `*`/`/` over atoms. `/` floor-divides — 5e never wants a
fraction, and `level / 2` meaning "half your level, rounded down" is the only reason
division exists here at all.

```ts
export function evalFormula(expr: string, vars: Record<string, number>):
  { flat: number; dice: string[] } | null
```

Dice terms come back **unrolled**, as strings. The evaluator must not roll: crit doubles
damage dice, and a rider that arrives pre-rolled can't be doubled. `n * 2d6` multiplies
the count, not a result.

```
// ponytail: no parentheses, no functions. Every catalogued homebrew formula is a
// flat sum of `atom * atom` terms. Add a real parser when one feature needs one —
// and name that feature here.
```

**Formulas never reference other nodes.** This is the constraint that makes everything
else cheap: the evaluator needs no dependency ordering, and *all* cycle risk lives in
target resolution, where §4's DFS already catches it. Corollary, and it must be enforced
in the editor: **conditions read state, never another node's computed value.** "While
raging" is legal; "when Judgment's Cut deals more than 10" is not.

---

## 15. Scoping — one definition of "active"

§2 scopes targeting to currently-active content. `lib/effects.ts` `effectSources()`
already answers a near-identical question for `ItemEffects` (worn gear + active effects +
slotted-shard mods). **Two functions answering "what is active right now" will drift.**

Refactor `effectSources()` to return the source *objects*, and derive both the
`ItemEffects[]` it returns today and the graph's node set from that one list:

```ts
/** Everything active on this character, as objects. The single answer to
 *  "what exists for targeting/effect purposes right now". */
export function activeSources(character, shardTrees): ActiveSource[]
```

Node set = `sheet.features` + gear features (equipped only) + shard features (slotted,
attuned, revealed) + spellbook spells + equipped weapons + worn gear + active effects.
**Unequipped items and their features do not exist** — this is an explicit filter in the
resolver, per §2, not an accident of which array we happened to read.

---

## 16. State — `resources.graph`

Additive to the existing `resources` shape (§8 #3), which already holds `activeEffects`,
`exhaustion`, `deathSaves`.

```ts
resources.graph = {
  /** gids of features currently ON (Rage). Keyed by gid, NOT stored on the
   *  feature object — a gear- or shard-granted feature is a snapshot living on the
   *  item, and gearFeatures() strips its `uses` and rewrites its `id`. There is
   *  nowhere on the object for state to live. */
  active: Gid[],
  /** One-shot modifiers awaiting a matching roll. Keyed by ROLL KIND from the
   *  start (§3), never attack-only. */
  armed: {
    id: string; source: Gid; label: string
    kind: RollKind; sub?: string; subject?: Gid
    op: GraphOp; value?: string
    at: number
  }[],
}
```

**Consumption (§8 #1 made concrete).** An armed modifier applies to the number
automatically, and the roll card shows it as a chip. Consuming it is **one tap on that
chip** — dismissing the card keeps it armed. Nothing burns a resource implicitly, which
is what "consumed on the next roll that RESOLVES" means in practice: only the player
knows whether the attack hit.

**Lifetime.** `rest.ts` `longRestPatch` clears `armed` and `active` alongside
`activeEffects`, in the same write. Add it in the same `patch` object — a second write
path would let the two drift.

**Visibility.** The armed chip on the target's card is not optional polish. A pending
bonus the player can't see is worse than no bonus, because they roll without it and never
learn why the number was low.

---

## 17. Validation (§4, made concrete)

Reuse the Lattice Audit's shape verbatim — `ShardLattice.tsx` already defines
`type AuditItem = { sev: 'err'|'warn'|'ok'; id: string|null; t: string; s: string }`,
renders it, and gates Publish on `sev === 'err'`. Lift that type into `lib/graph.ts` (or a
shared spot) rather than defining a second audit vocabulary.

| Check | Severity | Note |
|---|---|---|
| Cycle | **err** | DFS over the edge index. Runs on save of the edited node, against the rest of the catalog. |
| Dangling id target | **err** | Target names a **catalog** row that doesn't exist. |
| Zero live matches | warn → the **match count**, not an error | See below |
| Formula doesn't parse | **err** | `evalFormula` returned null |
| `add` with no `value`, any op with no `label` | **err** | |
| Condition references a node's value | **err** | The §14 corollary |

**Dangling ≠ zero matches, and conflating them makes the linter useless.** A target is
dangling when the *catalog* has no such row. A target matching nothing *on this
character* is normal — the character simply doesn't own that spell yet. The live match
count in the editor (§4) is counted against the **catalog**, which is what makes it the
signal that distinguishes a typo from correctly-targets-nothing-yet.

Validation has no UI of its own, so it ships **inside the editor slice**, not as the
separate step §3's build order implies.

---

## 18. Slices

| # | Slice | Done when |
|---|---|---|
| **1** | `lib/graph.ts` + `graph.test.ts`. No UI, no consumers. | Tests cover: formula eval (dice unrolled, floor division), target matching across all three namespaces, a two-level chain, a cycle hitting the guard, unequipped-item exclusion. |
| **2** | `activeSources()` refactor in `effects.ts` | `effectSources()` derives from it; no behaviour change; existing screens untouched. |
| **3** | Feature editor rebuild (§5) + validation (§17) | Effect block collapsed by default; tag input with autocomplete; live match count; audit blocks save. |
| **4** | **Attacks** — the reference integration | `rollWeaponAttack` takes a `Resolution`; riders render in the roll toast; a `+1d4 while raging` feature works end to end. |
| **5** | State: `active` toggles, armed queue, rest clearing, DM console `active` panel (§8 #4) | |
| **6** | Spells, saves & checks, items, shards (§6) | Each ~20 lines of wiring. Saves/checks stay blocked on the Character screen. |

Slice 1 is genuinely testable with no UI — do not skip ahead to slice 4 to "see it work".
Attack-shaped assumptions baking into the resolver is the one failure mode §3 names.

---

## 19. What this deletes

Deletion is part of the work, not cleanup afterwards:

- **`AmmoBonus` and the ammo special case** in `lib/weapons.ts` `rollWeaponAttack`. Its
  own comment already says dice-valued and conditional ammunition is "the features
  engine's roll-contribution mechanism". Once slice 4 lands, nocked ammunition is a graph
  contributor like anything else, and both the type and the parameter go.
- **§17 of `GUIDE_Codex_Inventory_Refactor.md`**, per this doc's header.

---

## 20. Rejected during planning

Recorded so they stay rejected:

| Rejected | Why |
|---|---|
| A `slug` field on catalog rows | The catalog id is already stable and already back-referenced; a slug is a second name that can disagree with the first (§11). |
| Formulas referencing other nodes' values | Would require dependency-ordered evaluation and move cycle risk out of target resolution, where §4 already handles it (§14). |
| A `kind` × `field` effect matrix | Five ops cover every catalogued homebrew feature. A matrix is authoring surface nobody uses and validation nobody wrote (§12). |
| AND / negation in target selectors | No catalogued feature needs one. OR-only keeps matching a single pass. |
| Parentheses in formulas | Same — add with the feature that forces it, named in the comment (§14). |
| A separate `graph_nodes` table | Nodes are the existing entities. A table means a migration, a join, and a second identity for things that already have one (§10). |
| Auto-consuming armed modifiers on roll | Only the player knows whether the attack resolved (§8 #1, §16). |

---

# Part III — Variables, activations, and the editor

Written after stress-testing the model against the two hardest pieces of real content:
the **Arbiter path system** (nine variables, four levels of derivation) and **Judgement
Cut** (a two-stage spell with save branches and an on-kill trigger).

Both exposed gaps. Part III is the delta. **Where it contradicts Part I or II, Part III
wins** — §20 in particular now has two entries reversed, marked below.

---

## 21. Derived variables — a second DAG

### The reversal

§14 said formulas never reference other nodes, and a variable could be assigned but never
derived. **That rule blocked real, already-written content** and is reversed.

The Arbiter path system is nine variables, seven of them derived:

```
judgementBias          5                                         (const)
mercy, condemnation    granted by the DM                         (stored)
judgementState         0 = Balance, 1 = Mercy, -1 = Condemnation (stored)
judgementDelta         mercy - condemnation
canSwitchToMercy       judgementDelta >= judgementBias
canSwitchToCondemnation judgementDelta <= -judgementBias
canSwitchToBalance     mercy == condemnation
nextJudgementState     canSwitchToBalance ? 0 : canSwitchToMercy ? 1
                       : canSwitchToCondemnation ? -1 : judgementState
isMercy                judgementState == 1
isCondemnation         judgementState == -1
isBalance              judgementState == 0
```

`nextJudgementState` reads three variables, each reading `judgementDelta`, which reads
two stored values. Four levels. No flat model expresses this.

### What it costs, and what survives

**Variables form their own DAG**, topologically sorted, evaluated once per state change,
before roll resolution begins. Cycle detection is §17's DFS pointed at a different graph.

**The guarantee that survives — and this is the one to protect:** contribution formulas
still never reference another node's *computed contribution*. Two separate graphs.
Variables resolve among themselves; contributions then read settled values. Neither feeds
the other's cycle risk.

§14's "all cycle risk lives in target resolution" becomes **"each graph checks its own
cycles independently."** Still nowhere near continuous re-derivation across a reference
web.

### Two kinds of variable — the editor must distinguish them

| | Written by | Recomputed | Example |
|---|---|---|---|
| **Stored** | Activations, or the DM | Never | `mercy`, `judgementState`, `riftMarks`, `karmicReserve`, `perfectJudgment` |
| **Derived** | Nothing — it is a formula | Every state change | `judgementDelta`, `isMercy`, `spellDc` |

Mixing them produces a stale `isMercy` disagreeing with the state it reflects.

### Writability — a permissions boundary, not a convention

Stored variables carry a writability flag:

- **player-writable** — resources the player spends (`karmicReserve`, `riftMarks`)
- **DM-only** — `mercy`, `condemnation`

Without this the balance exploit (30/30 unlocks everything) is prevented by good
behaviour rather than by design. `resources` lives in the character row the player can
write, so **this must be enforced in RLS and the schema**, not just greyed out in the UI.

DM-side control: the console's per-character **Currency** widget is already this shape —
a stored numeric with +/- and a log line. Mercy and condemnation reuse it. No new surface.

### Derived variables pay for themselves

Two consequences of the DAG that would otherwise be hand-maintained:

- **Locked path (20+ points).** `judgementBias` becomes
  `(mercy >= 20 or condemnation >= 20) ? 10 : 5`. Everything downstream updates.
- **Tiers.** `mercyTier = isMercy ? floor(mercy / 5) : 0`. Features gate on
  `mercyTier >= 2` instead of needing per-tier flags. Floor division is already in §14
  for exactly this.

### Don't hardcode a formula twice

Judgement Cut used `#spellList.dc` in stage 1 and `wisdom.modifier + proficiencyBonus + 8`
in stage 2. **Same number, two sources — they drift the moment anything grants a DC
bonus.** A `spellDc` derived variable, read by both.

---

## 22. Expression conditions

`when` stops being an enum (`'manual'` / `'active:<gid>'`) and becomes a boolean
expression over variables: `mercy > condemnation`, `condemnation >= 15 || perfectJudgment`.

Cheap **because** parentheses were reversed — same recursive-descent parser, returning a
boolean instead of a value. Needs comparison operators (`>= <= > < == !=`), booleans as
first-class values, `&&`/`||`/`!`, and chained ternaries.

### Containment becomes explicit

In Dicecloud, a parent toggle gating on `isCondemnation || perfectJudgment` structurally
contains its tier gates, so an inner `condemnation >= 15` is safe — it can only be
reached inside an established path.

**Model C is flat, so that containment has to move into the condition.** The tier gate
carries both parts:

```
(isCondemnation || perfectJudgment) && condemnation >= 15
```

Or the parent sets a stored variable the children read. Either works; what doesn't is
assuming position implies context. **This applies to every nested toggle in the class
port** — it is the one place flattening changes how content is written.

---

## 23. Activation outcomes

§17's original `tempHp` / `heal` / `effect` list, extended by what the class port needs:

| Outcome | Notes |
|---|---|
| `tempHp`, `heal` | Already specced |
| `grantEffect` | References an **effect library** definition (separate doc) + a duration. "Once per rest, grant Giant Strength." |
| `setVar` | Writes a stored variable. `judgementState = nextJudgementState`; `riftMarks = 1`; `perfectJudgment = true` |
| `addVar` | Increment/decrement. Consuming `riftMarks` by 1 |
| `spellSwap` | Adds/removes a spell from the spellbook. The two-stage Judgement Cut. **The most invasive write discussed** — it mutates `spellbook`. |

### Activations need `when` too

Currently `when` lives on `GraphEffect` for roll riders. **Activation outcomes need the
same gating** — see §24. Same evaluator, but it must be explicit rather than assumed.

### Commit is always a deliberate act

`nextJudgementState` is derived and always current; `judgementState` only changes when the
player triggers **Recalculate Path** (`setVar judgementState = nextJudgementState`). The
app never decides you switched paths.

**Consequence:** between a DM grant and a Recalculate there is a window where
`nextJudgementState != judgementState`. Not a bug — but the UI must surface it, or points
sit unclaimed for sessions. When they differ, the Recalculate action reads as *available*
in a way it otherwise doesn't.

---

## 24. The creature boundary — where prose is the right answer

Every remaining gap is one thing: **the app does not model creatures.** Coherent, and
exactly the line §0 drew.

### Save branches

Judgement Cut resolves differently on a failed vs. successful save. `resolve()` has no
branches — a save is a roll kind with riders.

**Damage stays prose.** Roll `4d8`, note "half on a successful save." The player applies
it. Consistent with everything else: the app rolls, the human adjudicates.

**But app-owned WRITES cannot be prose.** Mercy's variant grants temp HP and sets karmic
reserve *if at least one creature failed*. A note cannot perform a write.

**Solution — gate the writes on a manual toggle, not a branch.** The condition is "did at
least one creature fail?", which only the player knows. So the action carries a toggle
(`at least one failed the save`) and the `tempHp` and `setVar` outcomes gate on it,
exactly as rider contributions gate on `when: 'manual'`.

Mechanical outcome preserved; no tree-structured activations introduced.

### On-kill triggers

Judgement Combo ("reduce a target to 0 → recast free") needs enemy HP. **Dicecloud, with
a full computation engine, cannot do this either** — the limit isn't architectural, it's
that neither app models creatures.

A manual toggle on the **cast** action. It must **skip slot consumption**, not merely
annotate the roll — otherwise the player has to remember not to spend a slot, which is
the bookkeeping the app exists to remove.

### Multi-target

"Up to three creatures" is one roll the player applies three times. No target registry
(§9, unchanged).

### One idiom, not three

Every creature-fact gap resolves the same way: **the app asks, never infers.** Riders,
save-branch writes, and the combo trigger are all the same manual toggle. That
consistency is worth as much as the coverage.

**Judgement Cut lands ~70% mechanised, ~30% prose.** That ratio is what the design
principles predict, not a shortfall.

---

## 25. Additional ops and formula features

Added because catalogued content needs them (§20 discipline: name the feature that forces
each one).

| Addition | Forced by |
|---|---|
| `resist` / `vuln` / `immune` ops | Damage-type modifiers. **Flags, never numbers** — the `ItemEffects` rule |
| `tempHp` as an outcome | Mercy's Judgement Cut variant |
| `grantEffect` op | "Once per rest, grant Giant Strength" |
| **Array indexing** — `{[2,2,3,3,…][level]}` | Level-indexed progression tables. Belongs in the evaluator, not display sugar — most of 5e is written this way |
| Comparison operators, booleans, chained ternaries | §22 |

### Inline compute in prose — a display concern only

`{level * 2}` rendering as `16` in rule text never touches `resolve()`. Interpolation over
`evalFormula` at render time. Descriptions stay accurate as the character levels instead
of quietly lying.

```
{sanctifiedArrestUpgraded ? "and restrains the target." : "."}
{karmicReserve}
```

Both are state reads, so both are safe. Expressible **because** parentheses landed.

**Players see the computed value, never the raw expression.**

---

## 26. Editor architecture — schema-driven

The engine's cost of a new op is a switch case and a test. **The editor's cost is a
control, a layout, validation, and somewhere to put it** — and if the editor is
hand-built JSX per op, that cost compounds with every addition.

### The requirement

> **Adding an op must not require editing the editor.**

Declare each op once — its fields, their types, required-ness, validation. A generic
renderer walks the declaration. A new op is a schema entry.

**Field types are a closed set:** formula, text, selector, enum, boolean,
reference-picker. Everything discussed decomposes into these.

**Validation lives beside the schema entry**, so `auditNode()` walks the same declaration
the renderer does. Hand-built forms and hand-built validators drift within about three
additions.

### Two things to resist

**Don't make the schema general enough to express anything.** Arbitrary nesting and
open-ended types is a *form builder* — a system that can construct any form from
configuration. That is its own project, and it is always almost done. Closed field types,
flat op definitions: general enough to add ops, not general enough to become a platform.

The test: adding an op = a schema entry, good. Adding a field type = fine, occasionally.
Building a UI to author schemas = stop.

**Don't pre-add fields.** §20's discipline applies here too — the schema is what makes
future additions cheap, so there's no need to guess at them now. **Porting the Arbiter
class is the forcing function** that will say which fields are real.

The one place worth building capacity ahead of need: **formula and condition inputs as a
shared component** any op can declare. Then a new op reading conditions gets it free.

---

## 27. Editor layout — three panes

Modelled on the Shard Lattice Editor, which already solves node layout, hit-testing, and
pan/zoom in the Codex's visual language.

**Left — feature list.** Foldered grouping. Searchable, **including by target**:
`tag:fire_damage` lists every feature affecting that tag. This is a thin wrapper over
`matchCount()` (§17) — the selector namespace already does the work. Same treatment for
the spell and item editors' search fields.

**Middle — dependency graph, collapsible.** Obsidian-style: nodes linked to what they
reference and what references them. **This is a render of the edge index §11 already
builds** — the data is a by-product of the engine, not new work. `d3-force` if
force-directed; the lattice's radial layout is the alternative. Collapsing to widen the
editor is the right default: authoring outweighs surveying.

**Right — node editor.** Schema-driven (§26). Effect block collapsed by default (the §0
escape hatch). Tag input with autocomplete. Live match count. Inline audit.

### Build order

**Panes 1 and 3 first.** The middle pane is the most deferrable and the most likely to eat
a week on layout tuning. Add it once there are enough features to need an overview.

---

## 28. Scope correction

§10 estimated `lib/graph.ts` at ~250 lines with the editor as the expensive half. **With
derived variables, expression conditions, and activation writes, the engine roughly
doubles.**

Still not Dicecloud: no continuous re-derivation across a reference web, and adjudication
stays human. But ~250 lines is no longer the number, and slice 1 now carries the variable
DAG, its cycle check, and the boolean expression parser.

---

## 29. Reversed from §20

| Previously rejected | Now | Why |
|---|---|---|
| **Parentheses in formulas** | **Accepted** — recursive descent with precedence climbing, slice 1 | Rewrite-vs-extend: retrofitting a parser into a split-on-`+` evaluator means replacing the thing every formula depends on. 30 lines up front is cheaper. Dice make the arithmetic partial, so it returns typed `{flat, dice}` and **rejects** meaningless combinations (`2d6 * 1d4`, `2d6 / 2`, `(1d6 + 2) * wis`) as parse errors rather than producing a wrong number |
| **Formulas referencing other nodes' values** | **Partially reversed** — *variables* may derive from variables (§21). **Contribution formulas still may not reference another node's computed contribution** | The original rule blocked the Arbiter path system, which is real content. Two independent DAGs preserve the guarantee that mattered |

**Still rejected, unchanged:** slug fields, a `kind × field` matrix, AND/negation in
selectors, a `graph_nodes` table, auto-consuming armed modifiers, a combat tracker, a
target registry, and inferring triggers.

---

# Part IV — The settled data model

Part III named the gaps; Part IV closes them. Everything here is a **correction or a
completion of Part III**, not new capability — one op is deleted, nothing is added.

**Precedence: Part IV wins over Parts I–III.** §38 lists every earlier passage it
supersedes, so no section has to be read twice to find out whether it's current.

---

## 30. Variables — where they live

§21 made variables first-class without saying where the definitions live, where the values
live, what scopes them, or what happens when one is missing. Four answers.

### Definitions ride on the node that introduces them

```ts
/** Added alongside `tags` and `graph` (§12) on Feature, Spell, EquippedItem, ShardNode. */
vars?: VarDef[]

export type VarDef = {
  /** Identifier: /^[a-z][a-zA-Z0-9]*$/. Referenced bare in formulas — `mercy`. */
  name: string
  kind: 'stored' | 'derived'
  /** `stored` only, and REQUIRED there. `derived` variables omit it — their type
   *  comes from their formula.
   *
   *  Not optional, and not inferred from `initial`: the language is typed (§36)
   *  and its rejections turn on type, so `auditNode` cannot decide whether
   *  `mercy > 5` or `isMercy && x` is legal without knowing what `mercy` is. A
   *  stored variable with no `initial` would otherwise have no determinable type
   *  at all. Declaring it beats making `initial` required, which would force a
   *  value onto something conceptually unset. */
  type?: 'num' | 'bool'
  /** `derived` only. Expression over the VARIABLE whitelist (§33). */
  formula?: string
  /** `stored` only. Which bucket the value lands in, and therefore who may
   *  write it (§31). Absent = 'player'. */
  scope?: 'player' | 'dm'
  /** `stored` only. Value on first appearance. Absent = the type's zero. */
  initial?: number | boolean
  /** Editor + DM-console display name. */
  label?: string
}
```

Audit checks that follow from `type`: a `stored` VarDef missing it is a blocking error; an
`initial` disagreeing with it is a blocking error; a `derived` formula whose evaluated type
disagrees with how downstream expressions use the variable is the ordinary §36 rejection,
reported at the reference rather than the declaration.

No new table, no migration, and **scoping falls out for free**: an unequipped item's
variables stop existing exactly as its features do (§15). A separate `variable_catalog`
would have needed its own scoping rule invented from scratch.

### Values live in two buckets, split by writer

```ts
resources.graph.vars   = {}   // player-writable stored variables
resources.graph.dmVars = {}   // DM-only stored variables — see §31
```

Derived variables are **never stored**. Same discipline as `spent` on a shard slot and the
prepared count on a spellbook: computed from the definitions plus the stored values, so it
cannot drift.

### Missing at runtime is not an error

This is §17's dangling-vs-zero-matches distinction recurring, and it resolves the same way:

| Situation | When | Behaviour |
|---|---|---|
| Referenced name declared **nowhere in the catalog** | author time | **Blocking error** |
| Declared, but not on this character's **active set** | runtime | The declared `type`'s zero — `0` for `num`, `false` for `bool` |
| Declared and active, but never written | runtime | `initial`, else the `type`'s zero |

**Which zero is not a guess** — it reads `VarDef.type`, which is why that field is required
on stored variables rather than inferred from `initial`. A `num` fallback substituted
for a `bool` would make `isMercy && x` a type error on exactly the characters who don't
have the path.

A character who hasn't been granted the Arbiter path isn't broken; they simply have no
`mercy`. The author-time check is what makes the runtime default safe to be silent.

### The namespace is flat and global per character — knowingly

`mercy` is `mercy`, not `feature:arbiter.mercy`. Namespacing per source would cost exactly
the authoring ergonomics the variable system exists to buy. The price is collisions, and
the price is paid in two phases:

| Phase | Severity | Why |
|---|---|---|
| Two **catalog** entries declare `charges` | **warn** | They may be mutually exclusive content that never coexists on one character |
| Two **active** entries declare `charges` | **error** | Now it is real |

A resolve-time collision can neither throw (it would break the sheet mid-session) nor
last-writer-win (silent corruption). So it is **deterministic and loud**: the resolver takes
the first definition in `activeSources()` order — sheet features → gear → shards → spells
— so behaviour stays stable while it is broken, and the collision raises a banner on the
DM console's per-character panel, the surface §8 #4 already gives to `active` state. The DM
sees it that session; nothing silently disagrees.

---

## 31. Writability is a place, not a permission

**§21 is wrong where it says the writability flag can be enforced "in RLS and the
schema".** Postgres RLS is row-level. `own_character` (migration 0001) grants a player
write on their entire row; there is no policy shape that permits writing
`resources.graph.vars.karmicReserve` while refusing `resources.graph.dmVars.mercy`.

The fix turns the permission into a **location** — §30's two buckets — guarded by one
trigger:

```sql
-- Reverts, never raises. A player's legitimate write to `resources` (spending
-- karmicReserve) must not fail because their client round-tripped a stale copy of
-- dmVars alongside it; the DM's value simply wins.
-- jsonb_set creates only the LAST path element: given a target with no `graph`
-- key at all, setting '{graph,dmVars}' silently no-ops and returns the target
-- unchanged — which would let a client that writes `resources` without a `graph`
-- key wipe dmVars outright, the exact hole this trigger exists to close. So
-- `graph` is coalesced into an object before the leaf is set.
create or replace function guard_dm_vars() returns trigger
language plpgsql security definer as $$
begin
  if new.resources #> '{graph,dmVars}' is distinct from old.resources #> '{graph,dmVars}'
     and not exists (select 1 from dm_users where user_id = auth.uid())
  then
    new.resources = case
      when old.resources #> '{graph,dmVars}' is null
        then new.resources #- '{graph,dmVars}'
      else jsonb_set(
             jsonb_set(coalesce(new.resources, '{}'::jsonb), '{graph}',
                       coalesce(new.resources -> 'graph', '{}'::jsonb), true),
             '{graph,dmVars}', old.resources #> '{graph,dmVars}', true)
    end;
  end if;
  return new;
end $$;
```

This is the one place Part II's "no SQL migration" property does not hold, and it is worth
the exception: the alternative is a security boundary maintained by client-side good
behaviour. The SECURITY DEFINER RPC precedent (`cast_party_effect`, `shop_buy`) would also
work; a trigger is smaller because there is no new call path to route writes through.

**The audit check that falls out — and the reason location beats a flag:** an activation
whose `setVar` targets a `scope: 'dm'` variable is now a *structural* authoring error,
catchable when the DM writes it, rather than a write that silently no-ops at the table
months later. A boolean flag on the variable could only ever have been checked at runtime.

---

## 32. `when` and `ask` are orthogonal

**§22 is superseded.** It collapsed player decisions into the expression language, then
§24 specified an effect needing an expression gate *and* a player toggle simultaneously —
which that collapse cannot express. They are two dimensions:

```ts
/** App-evaluated boolean expression over variables (§33). Absent = always true. */
when?: string
/** A player toggle and its label — "at least one failed the save". Nothing can
 *  evaluate this; only a human knows it. Orthogonal to `when`. */
ask?: string
```

`when` gates **existence**; `ask` gates **resolution**:

| `when` | `ask` | Surfaces? | `Rider.when` | `on` |
|---|---|---|---|---|
| absent | absent | folds into `flat`/`dice` | `always` | — |
| true | absent | yes, resolved | `active` | `true` |
| **false** | absent | **no** | — | — |
| absent | present | yes, unresolved toggle | `manual` | `false` |
| true | present | yes, unresolved toggle | `manual` | `false` |
| **false** | **present** | **no** | — | — |

The last row is the one that had to be pinned: a toggle nobody can satisfy is worse than an
absent one, because the player reads it as a decision they are getting wrong.

`Rider.when` (§13) is unchanged and stays three-valued — it is the resolver's **output**,
where `active` now means "an app-evaluable expression that came out true". The split is on
the input side only.

### This moves §7's trigger, and keeps its reason

§7 splits on *conditional vs unconditional*. Under the split that is the wrong axis. §7's
stated reason is **ordering** — never front-running a human decision — and a `when`-gated
rider involves no human decision at all; the app already knows the answer.

> **`ask` decides pre-rolling, not `when`.** `when`-only riders pre-roll and show their
> value. Anything carrying `ask` shows the formula and rolls on tap.

Same principle, correctly attached.

### Both fields apply to activation outcomes

§23's outcomes (`setVar`, `tempHp`, `grantEffect`, …) take `when` and `ask` with identical
semantics. That is what §24's save-branch case needs: the writes gate on `ask`, the path
gate stays in `when`.

**`ask` toggles dedupe by label within one roll or activation.** Mercy's Judgement Cut
gates both a `tempHp` and a `setVar` on "at least one failed the save" — that is one fact
and must be one checkbox. Same label ⇒ one toggle driving every effect carrying it.

---

## 33. The two DAGs — the constraint stated in both directions

§21 protects one direction only: contributions never read another node's computed
contribution. **The converse is what actually keeps the graphs independent:**

> **Variables never read contributions. Contributions never read contributions.
> Variables read only variables and character state.**

Without the first clause, a variable reading a contribution that gates on a variable is a
cycle spanning both graphs — and neither graph's own DFS can see it, so it fails at
runtime with no author-time signal. That is a soundness hole, not a missing feature.

**Enforcement is by grammar, and is therefore free — if it is taken now.** Variables
reference each other by bare identifier; a contribution has no name, there is no
`contribution(gid)` form, and a gid could not be an identifier anyway (it contains `:`).
So the check is only: every identifier in a variable formula resolves to the whitelist or
to another declared variable, else blocking error. Written down here so that nobody later
adds a convenience accessor and silently removes the guarantee.

### Two whitelists, not one

| | May read |
|---|---|
| **Variable** formulas | `level`, `prof`, ability mods (effective sheet), `hp`, `hpMax`, other variables |
| **Contribution** formulas | all of the above **plus roll context** — `cast`, subject, roll kind |

If a variable could read `cast`, the variable DAG would stop being a function of character
state and become a function of one particular roll — requiring re-evaluation per cast
level, per roll. §21's "evaluated once per state change" depends entirely on this line
existing. In React terms that memo is keyed on the character row and nothing else, which
is the whole reason no invalidation machinery is needed.

Both whitelists are checked by the same audit walk; only the permitted-identifier set
differs.

---

## 34. `spellSwap` is deleted

§23's most invasive op does not need to exist. Add one optional field:

```ts
/** On Spell. Expression over variables; absent = always visible. The spellbook
 *  filters on it. */
when?: string
```

The two-stage Judgement Cut becomes two ordinary spells, gated `judgementStage == 0` and
`judgementStage == 1`, and the activation is a `setVar` — an op already required. Consuming
the riftMark sets `judgementStage` back to `0`, the stage-one gate is true again, and the
first-part spell is back in the book. **No mutation of `spellbook` anywhere.**

It is better than parity, not merely equal to it: the spell row never leaves the book, so
`prepared`, `spell_id` and every other per-character field on it survive automatically.
Under `spellSwap` each of those is an open question with no obviously right answer — and
they would have been discovered one at a time, at the table.

The same gate unblocks **feature-granted spells** (the old §17 case) using fields that
already exist shape-only in `database.types.ts`: put the spell on the book with
`atWill: true`, `feature_id` set, and `when` gating on the granting feature's state. No
snapshot-on-grant flow, no removal flow.

---

## 35. Arrays — indexing pinned

§25 accepted array indexing without fixing the convention, which silently shifts every
progression table by one. Pinned:

- **0-indexed.** Matches the language and every code sample in this document.
- **Out-of-range clamps to the nearest end** — no error at level 21, no wrap.
- **Numeric literals only.** Booleans in arrays are not needed yet; add with the feature
  that forces one.
- **The editor's array field pre-fills 21 slots for a level table, index 0 marked unused.**
  The footgun moves into the editor, where it is visible, instead of living in every
  authored expression.

**Port check — and check it in the right place.** Existing Dicecloud tables were written
against Dicecloud's convention, whichever it is. A level-indexed table is typically flat at
the low end (`[2,2,3,3,…]` reads identically at levels 1 and 2), so **verifying at level 1
is exactly the check an off-by-one survives.** Verify at the first index where the value
changes, and again at level 20 — the only positions where the two conventions visibly
disagree.

---

## 36. `FormulaValue`, updated

§14's `{ flat, dice }` is stale: §22 added booleans and comparisons, §25 added arrays.

```ts
export type FormulaValue =
  | { t: 'num';  flat: number; dice: string[] }
  | { t: 'bool'; v: boolean }
  | { t: 'arr';  v: number[] }
```

§14's rejection table, extended. Every row returns `null` → a blocking audit error at
author time, never a wrong number at roll time:

| Expression | Result |
|---|---|
| `2d6 * 1d4` | reject — dice on both sides |
| `2d6 / 2` | reject — halve the count in the authored expression |
| `(1d6 + 2) * wis` | reject — can't scale an unrolled dice term by a sum |
| `true * 2` | reject — arithmetic on a bool |
| `2d6 > 3` | reject — comparison on a dice value |
| `mercy[2]` | reject — indexing a non-array |
| `isMercy ? 2d6 : 1d6` | **legal** — branches may carry dice; both must share a `t` |
| `mercy ? a : b` | reject — ternary condition must be `bool` |
| `[1,2,3][level]` | legal; clamps (§35) |

---

## 37. Slice re-cut — supersedes §18's slice 1

§28 admitted the engine roughly doubles but left slice 1 carrying resolver + audit + parser
+ variable DAG + boolean expressions. Split on the same headless-testability principle:

| Slice | Contents | Depends on |
|---|---|---|
| **1a** | Expression engine: parser (precedence climbing, parens), the three value types, arrays, comparisons/booleans/ternaries, dice rules | — |
| **2** | `activeSources()` refactor in `effects.ts` | — |
| **1b** | Variable DAG: `VarDef` collection from active sources, topological sort, cycle DFS, the two whitelists, two-phase collision detection, missing-variable defaults | 1a, 2 |
| **1c** | Resolver (§13) + `auditNode`/`matchCount` (§17) | 1a, 1b |

**The `activeSources()` refactor moves earlier and stops being an independent cleanup** —
1b collects variable definitions from the active set, so it is now a hard dependency rather
than a tidy-up that could slip.

Slice 1a's tests are §36's rejection table in full, plus precedence, parens, floor
division, and array clamping at both ends. 1b's are the collision phases, a variable cycle,
a roll-context identifier rejected in a variable formula (§33), and each row of §30's
missing-variable table. 1c's are §18's existing list, unchanged.

---

## 38. What Part IV supersedes

| Passage | Status |
|---|---|
| §21 "must be enforced in RLS and the schema" | **Wrong.** RLS is row-level; see §31 |
| §21 two-DAG guarantee | **Incomplete** — stated one direction only; see §33 |
| §22 `when` as a single expression field | **Superseded** by the `when` + `ask` split, §32 |
| §23 `spellSwap` | **Deleted**; see §34 |
| §25 array indexing | **Unpinned** → pinned 0-indexed with clamping, §35 |
| §14 `FormulaValue` | **Stale** → §36 |
| §14 single formula whitelist | **Split** into two, §33 |
| §7 pre-roll trigger ("conditional") | **Re-attached** to `ask`; the stated reason is unchanged, §32 |
| §13 `Rider.when` | **Unchanged** — confirmed three-valued as the resolver's output, §32 |
| §18 slice 1 | **Re-cut** into 1a/1b/1c, §37 |
| §10 "No SQL migration" | **One exception**: the `guard_dm_vars` trigger, §31 |

**Still rejected, unchanged from §20/§29:** slug fields, a `kind × field` matrix,
AND/negation in selectors, a `graph_nodes` table, auto-consuming armed modifiers, manual-
toggle state inside `resolve()`, suppressing identical stacked effects, a combat tracker, a
target registry, and inferring triggers.
