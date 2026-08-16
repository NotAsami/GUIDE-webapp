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
| **Saves & checks** | ~~Blocked on the Character (Rolls) screen, still a router stub.~~ **Stale — corrected in §41.** `Character.tsx` rolls ability checks, saving throws and skills today (`rollAbilityCheck` / `rollSave` / `rollSkill` → `pushCheck`), so `save` and `check` are real targets NOW and roll context applies unchanged. |
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
  /** Stored variable values, split by who may write them (§30, §31). A feature
   *  being ON lives here as an ordinary bool — see the note below. */
  vars: Record<string, number | boolean>,
  dmVars: Record<string, number | boolean>,
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

> **`active: Gid[]` is deleted; a feature being ON is a stored bool variable.**
> This section originally carried `active` because §12's `when: 'active:<gid>'`
> read it. §32 replaced that with an expression over variables, so "while raging"
> is `isRaging` — and §16's own reason for keying by gid, *"a gear- or shard-granted
> feature is a snapshot living on the item… there is nowhere on the object for state
> to live"*, is satisfied identically by `resources.graph.vars`. Keeping both would
> put two records of one fact in the same blob, free to disagree.
>
> Consequences: `resolve()` reads only the variable scope (`lib/graph.ts`
> `buildContext`), and slice 5's "active toggles" become `setVar`. The DM console
> panel of §8 #4 renders the bools.

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
| **6** | Spells, saves & checks, items, shards (§6) | Each ~20 lines of wiring. ~~Saves/checks stay blocked on the Character screen.~~ **Stale — they are not blocked; see §41.** |

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
  `(mercy >= 20 || condemnation >= 20) ? 10 : 5`. Everything downstream updates.
- **Tiers.** `mercyTier = isMercy ? mercy / 5 : 0`. Features gate on
  `mercyTier >= 2` instead of needing per-tier flags. `/` already floor-divides (§14),
  which is exactly why there is no `floor()` — see §39.

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
missing-variable table. 1c's are §18's existing list, plus the two obligations 1a hands
it — the negated-dice roll path and the null contribution — spelled out in §39.

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

---

# Part V — Slice 1a as built

**Precedence: §39 wins over Parts I–IV**, on the same terms Part IV set. It is the first
section written *after* code exists, so where it disagrees with an earlier passage, the
earlier passage was a guess and this one was compiled.

## 39. What 1a settled, and what it hands to 1c

Built as `src/lib/expr.ts` + `src/lib/expr.test.ts`. §37's contents in full: precedence-
climbing parser with parens, the three §36 value types, arrays, comparisons/booleans/
ternaries, the dice rules, and §33's two whitelists.

### Settled

| Question | Settled |
|---|---|
| Where the code lives | `src/lib/expr.ts`, **not** §10's `lib/graph.ts`. `graph.ts` arrives with 1b/1c and imports it. §10's one-file, ~250-line estimate predates §28's doubling and §37's re-cut. |
| Negated dice | **Legal.** `1d8 - 1d4` → `dice: ['1d8','-1d4']`; unary `-2d6` likewise. Bane forces it: §12 has only an `add` op, so `-1d4` has no other spelling. Obligation 1 below. |
| Array elements | §35's "numeric literals only" is a **type** restriction, not a syntax one. An element may be any dice-free `num` expression (`[level, level * 2]`); bools and dice in arrays stay rejected. |
| Roll-context identifiers | `ROLL_IDENTS = ['cast']` **alone**. §33's "subject, roll kind" cannot be identifiers — §36 has no string type, and a gid contains `:`. If 1c needs them, the shape is a **predicate** (`isSave`, `isAttack`), which the language already expresses; a value would need a fourth `FormulaValue` variant. |
| `floor()` and `or` | **Neither exists, and neither is missing.** §21's examples predate §14's floor-division rule: `/` already floors, so `floor()` is redundant. §22 names `&&`/`||`/`!` exclusively. §21's two examples are corrected in place. **The language has no functions and no word operators** — parens (§29) were the only reversal. |
| Division by zero, fractional dice counts | **Rejections.** §36 leaves both open; `Infinity` and `4.5d6` are exactly the wrong-number-at-the-table outcome §29 exists to prevent. |

### Obligation 1 — `parseDice()` must learn a leading sign

`dice.ts:13`'s regex is anchored with no sign, so it returns null for `-1d4`. A Bane rider
authored today therefore **passes the audit and then fails at the roller** — a silently
missing contribution rather than a parse error, which is the worst failure shape in this
document.

> **The test must run the whole path** — author `-1d4`, through `evalExpr`, through
> `resolve()`, to the rolled number — and assert the total goes *down*. A
> `parseDice('-1d4')` unit test in isolation passes while the rider still never reaches
> the number.

### Obligation 2 — what `resolve()` does with a null contribution

**Not decided. 1c decides it**, and this is the shape of the problem.

Author-time coverage is real but partial:

| Formula | Caught by the audit? |
|---|---|
| `5 / 0` | **Yes** — null in every scope, so §17's "formula doesn't parse" row blocks it |
| `x / mercy` | **No, and it cannot be.** It passes at `mercy = 12` and returns null mid-session the moment `mercy` hits 0 |

So a null contribution will reach `resolve()` eventually, and **dropping it silently is not
available**: §16 already settled the analogous case — *"a pending bonus the player can't see
is worse than no bonus, because they roll without it and never learn why the number was
low."* That argument is stronger here, since a dropped contribution leaves no chip to
notice. The proposal is a visible broken rider carrying its `label` and source into
`Resolution.notes`; recorded so 1c makes it a decision rather than inheriting a default.

**A second-order trap in the audit's own scope.** Whichever values the audit evaluates
against, one of the two errors above is possible. Against §30's type-zeros, `x / mercy`
rejects at author time on *every* character, since `mercy` is 0 there — the false positive
is now the blocking one. Pick which error the audit prefers deliberately; there is no scope
that avoids both.

---

## 40. Slice 1c as built — the engine is complete

Built as the second half of `src/lib/graph.ts` (`gid`, selectors, `buildContext`,
`resolve`, `total`, `auditNode`, `matchCount`) plus `src/lib/dice.ts`. **§39's precedence
rule applies here too**: this section was written after the code, so where it disagrees with
an earlier passage, the earlier passage was a guess.

### Both of §39's obligations are discharged

**Obligation 1 — done.** `parseDice()` takes an optional leading sign and returns a signed
`count`. The test runs the whole path §39 demanded — authored `-1d4` → `resolve()` →
`parseDice` → `rollDice` — and asserts the applied number is *negative*. A `parseDice('-1d4')`
unit test would have passed while the rider still never reached the roll.

**Obligation 2 — settled as `Resolution.problems: AuditItem[]`.** §39 proposed folding the
failure into `notes`; that was wrong and the code does not. `notes` is where authored `note`
ops land, so a broken formula rendered there is indistinguishable from rule text the DM
wrote. A separate field also matches what 1b already does (`characterVars → { scope, audit }`)
and gives the DM console the same surface §30 uses for variable collisions. The rest of the
roll resolves normally around the failure.

### Settled while building

| Decision | Why |
|---|---|
| **`Rider` carries `op`** | §13's shape had `flat`/`dice` only, so a toggled `adv` or `crit` had no way to say what it granted. A pre-existing gap — §12's `when: 'manual'` always applied to every op — surfaced by §32 making toggles first-class. |
| **`shardnode:` gids are `shardnode:<shardId>.<nodeId>`** | A shard node has no catalog back-ref and node ids are unique only within a tree. `installShard()` seeds every shard with `core`, so the unqualified form collides across slots. |
| **One `normalizeTag()`, shared** | Free-text tags fragment silently. The effect form already normalises to `trim → lowercase → \s+ → _`; if the matcher used a different rule, targeting would fail with **no error at all**. Exported from `graph.ts`; the editor slice should adopt it rather than keep its inline copy. |
| **`total(res)` composes** | `flat`/`dice` hold only the unconditional fold; a resolved (`when`-true) rider carries its own value. A caller summing both would double count, so the composition is done once in the engine. |
| **`ask` on a `note` is an authoring error** | A note is prose — there is nothing to resolve. Caught by `auditNode` rather than half-honoured at roll time. |
| **`value` on a flag op is an authoring error** | `adv`/`dis`/`crit` are flags, never numbers. This is the `ItemEffects` rule, now enforced. |

### What §17's "condition references a node's value" check turned out to cost

**Nothing — it needs no code.** There is no `contribution(gid)` syntax, and a gid contains
`:` so it could never be an identifier. `expr.ts`'s existing unknown-identifier rejection
already covers the whole class. This is §33's "enforcement is by grammar, and is therefore
free — if it is taken now" paying out exactly as predicted.

### What is still owed

| Owed | To whom |
|---|---|
| Nothing consumes a `Resolution` yet — every breakdown in the app is a preformatted string (`CheckRoll.breakdown` is `"14 + 2 DEX + 3 PROF"`), and `RollEntry` has no field for structured contributions. Slice 4 needs a `toBreakdown()` at the boundary or a new `RollEntry` variant. | Slice 4 |
| `once: true` is parsed and ignored — the armed queue. | Slice 5 |
| §31's `guard_dm_vars` trigger. Still no writer, so still not urgent; it must land **before** the first one, not before the first reader. | Activations |
| `catalogTypes` has no source on a player client (§30 row 2). | Whoever hits it |
| The editor's inline tag normaliser should call `normalizeTag()`. | Slice 3 |

---

## 41. Slice 3 as built — the editor, and what it forced

Built as `src/screens/FeatureEditor.tsx` + `.module.css`, `src/lib/opSchema.ts`,
`src/lib/draft.ts`, migration `0014_feature_drafts.sql`, plus changes to `graph.ts`,
`dm.ts`, `dmShards.ts` and `ShardLattice.tsx`. **§39's precedence rule applies here too**:
written after the code, so where it disagrees with an earlier passage, the earlier passage
was a guess.

### §39's second-order trap, resolved — and it was worse than §39 said

§39 left open "what scope `auditNode` evaluates against" and named one failure. **There
were two**, and both were live in shipped 1c code, which bound every identifier to the
number `0`:

| Formula | Was | Why |
|---|---|---|
| `x / mercy` | **blocked on every character** | `mercy = 0` → division by zero. §39's named trap. |
| `isRaging && hasCharge` | **blocked** | Both bound to the NUMBER `0`; `&&` on nums is a §36 rejection. **§39 did not name this one**, and it sits on the single most likely thing a DM writes — a `when` gate over two bools. |

Settled as **`probeScope()`: type-correct, and non-zero.** Stored variables read their
declared `type`, derived ones are resolved by the same walk `characterVars` uses, and the
numeric probe is **`1`**.

- **Non-zero draws the line where §39 said it had to be drawn.** A *literal* `5 / 0` is
  wrong in every scope and still blocks. A division by a *variable* is only wrong at some
  values, is not knowable at author time, and is no longer reported here — because §40
  already built the runtime answer for it in `Resolution.problems`. Author time and roll
  time now cover **disjoint** cases instead of the former swallowing content it cannot
  judge.
- **Type-correct is why `VarDef.type` was made required in the first place (§30).** An
  audit that discards it re-introduces exactly the error the field exists to prevent.

The walk itself was factored out of `characterVars` into `walkDerived` — one traversal,
two callers, so runtime and author time cannot drift. A variable **cycle** is now caught in
`auditVars` as a by-product; it used to reach the table before anyone heard about it.

### Settled while building

| Decision | Why |
|---|---|
| **Three damage-flag ops** — `resist`/`vuln`/`immune` join `GraphOp` | §25 named them; the editor is the first thing that could author them. |
| **They do NOT ride on `Resolution`** | `Resolution` answers "what modifies *this roll*". Being hit by fire is not a roll the player makes, and there is no `ResolveReq` that means it — overloading `kind: 'damage'` (a damage roll the player rolls) would make the two indistinguishable. They are read by `damageFlags(ctx, dmgType)`: same matcher, same `when` gate, separate question. `resolve()` skips them. |
| **`ask` on a damage flag is an authoring error** | Same reasoning as §40's `ask`-on-a-note: incoming damage raises no roll, so there is no surface for the checkbox. |
| **A damage flag with no target is an error** | Its target names the damage kind. With none it says nothing at all — the one case where "no selector = own roll" is meaningless. |
| **`auditNode` reads required-ness from the op schema** | §26 asked for validation beside the schema entry so the audit and the renderer walk one declaration. The hardcoded `add`-with-no-value branch is gone; `crit`'s threshold and `note`'s text are required because the schema says so, and the next op needs no audit branch. |
| **`crit` carries a `threshold`, `note` carries `text`** | §12's shape had nowhere for either. Improved Critical could not say *19*; a note's breakdown line and its rule text were the same string. **Lowest crit threshold wins** — a crit range is a threshold, not a stacking bonus. |
| **`byLevel` is honoured, not just parsed** | §35's level table. Sparse means STEP: a table filled at 1/5/11 reads "3 from level 11 up", so an empty slot walks down to the last filled one. Out of range clamps. Anything less would have been an authoring surface the engine ignores — the failure this document exists to prevent. |

### The draft ladder, and the RLS asymmetry that shapes it

Three tiers, shared by both editors via `lib/draft.ts`:

```
localStorage  ──autosave──>  the row's draft slot  ──publish──>  the published payload
 (keystroke)                    (Save Draft)                        (Publish)
```

**"Sandboxed" had three incompatible meanings before this slice.** `ShardLattice` had no
autosave and no sandbox at all — `Save Draft` wrote the live row, and only RLS hid
unpublished trees. The editor mockup autosaved into an in-memory map that never survived a
refresh. Neither matched the telemetry line both of them displayed. Now the claim is
literal: **nothing a player reads moves until Publish.**

Where the draft is parked differs, and RLS forces it:

| | Draft lives in | Why |
|---|---|---|
| **Features** | a `draft jsonb` column on `feature_catalog` (migration 0014) | The table has *no player policy at all* — a non-DM select matches nothing. Every column is already DM-only. |
| **Shards** | `shard_tree_secrets.data.draft` | `player_read_published_shards` grants players SELECT on the **catalog row**, and RLS is row-level — a `draft` column there would hand them the DM's unpublished work. Concealed node text already lives in secrets for exactly this reason. |

Shard drafts are stored **merged**, not split: `splitForSave()` exists to protect the
player-readable catalog, and nothing in secrets is player-readable.

### What `published` gates on a feature

**The Grant picker.** Players never read `feature_catalog`, and a granted feature is a
snapshot — so editing a template already could not reach a sheet, and publishing it still
cannot. The only path from catalog to player is a DM grant, so that is the gate: an
unpublished feature is not offerable.

### Owed by this slice, paid

§40's last row — *"the editor's inline tag normaliser should call `normalizeTag()`"* — is
discharged: `EffectForm.addTag` imports it, and the Feature Editor never had a second copy.

### Deliberately not built

| | Why |
|---|---|
| **Pane 02, the dependency graph** | §27 defers it by name; its own build order says panes 1 and 3 first. Ships as the reserved overlay the mockup specifies, so its absence is a stated decision rather than an oversight. |
| **The five activation ops** (`heal`, `tempHp`, `grantEffect`, `setVar`, `addVar`) | Activations are a later slice. `grantEffect` additionally needs `EffectRef`'s shape and a snapshot-on-grant, because players cannot read `effect_catalog` either. The `reference` field type is declared in the schema and has no control yet — the type costs a union member; the control waits for a caller. |
| **Persisted empty folders** | `folder` is a name on the feature and the folder list is derived from its members, so there is no second store to drift. The cost is that a folder emptied of its last member stops existing. |

### Still owed

| Owed | To whom |
|---|---|
| Nothing consumes a `Resolution` yet — unchanged from §40. | Slice 4 |
| `once: true` — the armed queue. | Slice 5 |
| §31's `guard_dm_vars` trigger. **This slice authors `scope: 'dm'` variables but still writes no values**, so the trigger is still not urgent — it must land before the first *writer*, which is the activation slice. | Activations |
| `catalogTypes` has no source on a player client (§30 row 2). | Whoever hits it |
| `auditNode` runs over the whole catalog on every keystroke to count Issues; memoized on the library, not indexed per row. | Whoever feels it |

---

## 42. Corrections found by using the editor

Both of these were caught by the DM driving the thing rather than by a test, which is the
point of shipping a slice and then opening it.

### The Rolls screen is not a stub — §6 and §18 were stale

§6's integration table and §18's slice 6 row both said saves and checks were "blocked on
the Character (Rolls) screen, still a router stub". **They are not, and have not been for
some time.** `src/screens/Character.tsx` is a full screen that rolls ability checks
(`rollAbilityCheck`), saving throws (`rollSave`) and skills (`rollSkill`), all funnelling
through `pushCheck`.

The consequence is not cosmetic: **`roll:save`, `roll:save.dex`, `roll:check` and
`roll:check.stealth` are live targets today.** A feature authored against them in the editor
resolves the moment slice 4's boundary lands — saves and checks do not have to wait for a
screen that already exists. It also means `pushCheck`'s `parts: string[]` is a second
consumer for whatever `toBreakdown()` shape slice 4 settles on, not a later port; §13
already noted that `rollSave` folds two distinct sources into one `PROF` label, so
attribution is being lost there *now*.

Both rows are struck through in place rather than rewritten, so it stays visible that the
claim was made and why it was wrong.

### `order` shipped inert, and that is the failure this document exists to prevent

Slice 3 added `Feature.order` and a plan that described fractional reordering — and then
implemented **drag-to-refile only**. Dropping a feature onto a folder moved it; dropping it
between two siblings did nothing. The field was written by nothing and read by nothing: an
authoring surface that silently does nothing, which §41 had just finished rejecting for
`byLevel` and the activation ops. Shipping it here was the same mistake, one slice later.

Fixed, and the shape is worth recording because it is the reason `order` is a **number**
rather than an index:

- The drop handler writes the **midpoint between the two neighbours** the row lands
  between. One row write per drag — a folder of 46 Sanctity features does not get
  renumbered because one moved.
- That requires every sibling to already have a number, so `order` is assigned on create
  (`nextOrder` — one past the last in that folder) and was **backfilled** for existing rows
  in migration 0014, seeded from the alphabetical order they already displayed in.
- Sort is `order` ascending, ties broken by name; a row with no `order` sorts last, which is
  exactly where it sat before ordering existed.

Both backfills in 0014 are guarded (`where … is null`), so re-running the file cannot
flatten an arrangement the DM has since made by hand.

---

## 43. Slice 4 as built — the first number a player sees

Built as `src/lib/useGraph.ts`, `src/components/Riders.tsx`, changes to
`weapons.ts` / `rolls.tsx` / `Equipment.tsx` / `Character.tsx` / `RollToast`, and
`src/lib/weapons.test.ts`. §39's precedence rule applies: written after the code.

### Saves and checks came forward out of slice 6

§18 scoped this slice to attacks. They were pulled in because §3 names
"attack-shaped assumptions baking in" as the one failure mode of this work, and
**the only way to prove a boundary is not attack-shaped is to run something that
is not an attack through it in the same slice.** A save has no subject at all —
`resolve(ctx, { kind: 'save', sub: 'dex' })` — which is exactly the case that
would have been awkward to retrofit. It was not awkward, which is the result the
test was for.

### Riders are grouped by roll, not concatenated

The first cut merged attack and damage riders into one array and lost which was
which before anything could render it. `+1d4 to the attack` and `+1d4 to the
damage` are different statements. `RollEntry.riderGroups: { label, riders }[]`.
`notes` and `problems` stay flat — a note is prose about the action, a problem is
the engine failing; neither belongs to a sub-roll.

### `ask` renders, and deliberately does not yet toggle

§32's `manual` riders show their **formula** and an unresolved marker. They are
not flippable, and that is a decision rather than an omission: the roll toast
lives 4.8 s, dismisses on any click, and **retires for rolls once the Roll
Context Panel is built**. Wiring toggles into it would be work thrown away.
`RollLogValue` still has no update path, which is the missing piece when the
panel lands — note that `addRoll` already returns the created entry including its
id, which is the handle that flow will need.

The `Riders` component is shared by the toast and the Character roll log
precisely so the two cannot drift.

### Settled while building

| Decision | Why |
|---|---|
| **adv/dis COMPOSES with the player's manual toggle** | `Character.tsx` has a player-set adv/dis. A feature granting advantage and a player asking for it are the same request: effective adv = manual OR graph, same for dis, then one of each cancels. Overriding the player would have been the engine front-running a decision. |
| **Graph dice on a d20 roll are rolled immediately; graph dice on damage are not** | A d20 total is one number with nowhere for an unrolled term to live. Damage dice must stay unrolled so a crit can double them — which is the whole reason `resolve()` returns `dice: string[]`. |
| **§13's attribution loss fixed** | `rollSave` folded `proficiency(view)` and `saveBonuses[key]` into one `PROF` label; a player could not tell +3 proficiency from +2 proficiency plus a +1 ring. They print as separate terms now. Same for skills. |
| **The toast got a height cap** | It is anchored by `bottom` with no `max-height`, so riders grew it upward without limit and would eventually push the head off screen. |

### What the tests pin, and one they caught

`weapons.test.ts` stubs `Math.random` with an ordered queue rather than asserting
on ranges — a range-tolerant test passes while a contribution silently goes
missing, which is the failure this document exists to prevent. The queue throws
when it runs dry, and it **caught a real ordering assumption during writing**: a
nat 20 doubles the weapon's damage dice, so the crit path consumes more dice than
the normal one.

### The gid gap, pinned rather than discovered at a table

`gid('weapon', w)` reads the catalog back-ref first (§11) and falls back to the
instance id — and **`EquippedItem.item_id` is optional**. Checked against the
live database:

| Character | Weapons | `item_id` | `tags` |
|---|---|---|---|
| Ros Chrisstone | Dagger, Hand Crossbow | **none** | none |
| Cornelius the III. | Shortbow | `cat-shortbow` | none |

So one authored `weapon:` target reaches Cornelius and can never reach Ros, and
`tag:` targeting weapons matches nothing at all because equipped instances carry
no tags. **The editor shows "1 match" in every case**, correctly — `matchCount`
counts against the catalog by design (§17), so it is not lying; the two simply
answer different questions. There is now a test asserting both halves, so the
behaviour is known.

**Owed to slice 6 (items):** propagate `item_id` and the catalog's `tags` onto
equipped instances at grant time, or `weapon:`/`tag:` targeting stays a coin flip
depending on how the gear got there.

### `AmmoBonus` survives, and §19 underestimated it

§19 expected slice 4 to delete `AmmoBonus` and the ammo special case. It cannot,
and the reason is not the one first given (the item editor exists —
`OperatorConsole.tsx:1250` — it simply does not author `graph`/`tags`/`vars`).
The real blocker: **a nocked arrow is an `InventoryItem`, not equipped**, so it is
not in `activeSources()` and its contributions would never enter `resolve()` no
matter what the item form could author. Ammo is contextual to *one attack*, which
`ResolveReq` has no concept of. That is a design question — a per-roll source —
not bookkeeping, and it wants answering when spells and items land and there are
three cases to generalise from rather than one.

### What the manual pass caught that 137 tests did not

Slice 4 shipped green and then failed four times in front of a DM. Worth
recording, because three of the four were in code the tests could not reach:

| Found | Cause |
|---|---|
| The editor crashed on load | `foldered` was declared above `parsed` but calls it through `matches()` — a temporal dead zone. `tsc` does not model TDZ through a function reference, and there is no linter configured. |
| **Riders applied but were invisible** | `RollToast` paints its card interior with an opaque `::before` and lifts only `.head`/`.line` above it. The rider block rendered behind the fill: correct, applied, unseeable. **Any new child of a layered card needs `position: relative; z-index: 1`.** |
| Reordering felt impossibly precise | A midpoint rule gives only half a row: dragging down, "insert before the row I am already above" is a no-op, so only the lower half swapped. Replaced with direction — compare indices, and the whole row is a target. |
| A save totalled one less than the sheet said | Splitting the save bonus into its own term for §13's attribution added it to the breakdown and **not to the sum**. |

The last one is the instructive one. The fix was not the missing addition — it
was that **the total and the breakdown were computed separately at all**, which
is what allowed them to disagree. Both now derive from one `CheckTerm[]`; the
display filters zeros, the sum does not.

That arithmetic also moved out of `Character.tsx` into `lib/dnd.ts`
(`saveTerms`/`skillTerms`/`abilityCheckTerms`/`composeCheck`/`effectiveMode`),
next to `saveTotal`/`skillTotal`, because inside a component it was untestable —
and it had taken two bugs in a day. `dnd.test.ts` now pins the invariant that
would have caught it: **the named parts sum to the number the sheet shows**, for
every ability and every skill.

`rollDiceTerms` was lifted into `dice.ts` at the same time; the weapon path and
the check path each had their own copy of the signed-count logic, and that sign
is the whole of Bane — a caller reaching for `Math.abs` turns a penalty into a
bonus.

**Confirmed working by manual test:** a `when`-gated damage rider on a live
character, riders rendering in both the toast and the roll log, a feature's
advantage cancelling against a player's manual disadvantage, `ask` rendering
unresolved without applying, and a broken formula surfacing in `problems` while
the rest of the roll resolved.

---

## 44. Slice 5a as built — state becomes writable

§18's slice 5 was split: **5a makes variables writable end to end**; the armed
queue, the consumption chip and the DM console state panel are 5b. Built as
`src/lib/graphState.ts`, migration `0015_guard_dm_vars.sql`, the `setVar`/`addVar`
ops, and the Features screen's state block + activation confirm. §39's precedence
rule applies: written after the code.

### §31's trigger landed, and the hole it closes is real

`guard_dm_vars` had never been migrated. It went in verbatim and was **tested
against the database on a throwaway row**, not trusted:

| Attack (as a non-DM) | Result |
|---|---|
| Edit `resources.graph.dmVars` directly | Reverted |
| Write `resources` with **no `graph` key at all** | `dmVars` survived, and the legitimate part of the same write still landed |
| Write the player's own `graph.vars` | Allowed — the guard does not over-reach |

The middle row is why the doc's `coalesce` is there: `jsonb_set` creates only the
last path element, so on a target with no `graph` key it silently no-ops and
`dmVars` is simply gone. **Reverts, never raises** — a player's write succeeds
and the DM's value wins, rather than the player getting an error for something
their client did on its own.

§40 said this had to land "before the first writer, not before the first reader".
5a is that writer.

### Settled while building

| Decision | Why |
|---|---|
| **Two routes write the same key** | A direct toggle/stepper for every stored player-scope variable, AND `setVar`/`addVar` from Use. §16 says active toggles *become* `setVar`, but a DM can declare a bare bool with no activation authored, and then nothing could ever flip it. Both write `resources.graph.vars`, so they cannot disagree. |
| **Use opens a confirm sheet** | Every write is listed before it happens, with `ask` outcomes as unticked boxes. §32 allows `ask` on activation outcomes and §24 needs it; unlike a roll rider this is answered on a deliberate press, so it needs no Roll Context Panel. **`ask` is therefore real for activations while still deferred for riders** — the two are not the same problem. |
| **`VarDef.resetOn?: 'short' \| 'long'`** | Mirrors `Feature.recharge` exactly. Forced by content the editor mockup already seeds (`used_this_fight`, `ward_charges`). A long rest takes both, matching how `longRestPatch` already treats pact slots. |
| **`addVar` is planned as a DELTA** | Not as a computed next value. Two `addVar`s on one variable then stack; a precomputed result would have to be un-applied to combine them. |
| **Activations never reach a `Resolution`** | Same rule the damage flags get: `resolve()` skips them. Folding a `setVar` into a Resolution would fire it on every roll that matched, which is not what "on activation" means. |
| **`graphState.ts` returns patches, never writes** | So a use folds its roll, its use counter and its variable writes into ONE `updateSections` call. Two writes could land apart and leave a feature spent but not activated. |

### `shortRestPatch` had to be extracted first

`longRestPatch` was shared by the player Rest button and the DM console, but the
general short rest was **inlined in `RestButton.tsx`** and `rest.ts` never saw it.
Adding `resetOn` handling would have meant writing the rule twice, in two shapes,
with nothing keeping them in step — precisely the drift §16's Lifetime note warns
about. Extracted, then the rule written once; the variable reset now rides in the
**same** `resources` object that already carries `activeEffects: []`.

### The audit gained §31's author-time half

`auditNode` blocks an activation that writes a DM variable, a derived variable,
an undeclared one, or that carries a target. `planActivation` refuses the same
cases at runtime — not redundancy: a granted feature is a **snapshot**, so a copy
on a character can predate a rule the catalog now enforces.

### Caught during the build

The activation palette was **written into the schema and never rendered** — a DM
could not have added a `setVar` at all. Same inert-authoring-surface failure this
document has now caught four times (`byLevel`, `order`, and twice here). The
pattern is worth naming: *adding a thing to a schema is not adding it to the app.*

### Still owed

| Owed | To whom |
|---|---|
| The armed queue (`once: true`), the consumption chip, and the DM console state panel (§8 #4). | 5b |
| `heal` / `tempHp` / `grantEffect` — activation outcomes that touch HP and effects rather than variables. `grantEffect` needs a snapshot, since players cannot read `effect_catalog`. | later |
| Roll-rider `ask` toggles — still the Roll Context Panel's. | that slice |
| `uses.current` lives on `sheet.features[]` while variables live in `resources.graph.vars`. Both are state, stored two ways. | unresolved |
| §9's "per-character turn tick" is named as in scope and specified nowhere. | whoever wants it |
| **Manual verification of 5a has not been run yet.** | next session |

---

## 45. Slice 5b as built — the Roll Context Panel

Built as `src/components/RollContextPanel.tsx` + `.module.css`, a pure view model
in `src/lib/rollView.ts`, plus small changes to `graph.ts`, `rolls.tsx` and
`weapons.ts`. §39's precedence rule applies.

The panel is the surface two earlier slices were waiting on. Slice 4 deferred
`ask` riders and slice 5b's armed queue is still deferred, both for the same
reason: the toast lives 4.8 s, dismisses on any click, and the roll log was
append-only. **`ask` riders are now answerable.**

### `Rider.when === 'always'` had never been emitted

`resolve()` folded unconditional contributions into `flat`/`dice` and returned
before building a rider, so their **label and source were discarded** — the roll
knew it was +2 but not that the +2 was Rage. The variant was declared in 1c for
exactly this case and had sat unused since; the panel's contribution lines are
the first thing that needed it.

Now emitted alongside the fold. Two consequences, both load-bearing:

- **`total()` must exclude `always` riders.** They are already inside
  `flat`/`dice`; adding them again doubles every unconditional contribution,
  silently. One filter, one test.
- **`Riders.tsx` must exclude them too**, for a different reason: the toast and
  the Character roll log print the breakdown string *and* the rider rows, so an
  `always` rider would show the same number twice. The panel renders them in its
  own contributions section, where they are explicitly labelled as part of the
  breakdown.

`flat`/`dice` keep their previous meaning exactly, so every slice-4 assertion
still holds. The rider is additional, not a replacement.

### The split the panel exists to draw

| | Renders as | Because |
|---|---|---|
| **resolved** (`always`, `active`) | a breakdown line, never a control | the engine already decided; there is nothing to ask |
| **unresolved** (`manual`) | a toggle showing its FORMULA | §7 — a pre-rolled `1d6 [6]` shown before the player decides whether the creature was judged puts a thumb on that decision |
| §32's two non-surfacing rows | nothing | `resolve()` already dropped them, so the panel needs no third case |

**Rolled riders lock.** Once answered and rolled, the roll button is gone and
toggling reuses the value — §8 #2's "reopening the panel never re-rolls, that
would be a free reroll and would undo the honesty property in §7". The lock falls
out of storing the faces: `rolled` + `rolledDice` on `Rider`, written by the
panel and never by `resolve()`, which keeps the engine pure.

### Settled while building

| Decision | Why |
|---|---|
| **`updateRoll` on the roll log** | Answering an `ask` mutates a roll that has already happened, which an append-only log cannot express. Deliberately narrow — the panel is the only caller; every other producer stays fire-and-forget. |
| **Fold state is local to the panel** | It is how you are reading the list, not part of the roll. |
| **`AttackRoll` keeps the d20 pair and its mode** | The pair was always rolled and the loser thrown away, so a weapon attack could not render the dropped-die chip a check already could. Two lines. |
| **Exactly one die is marked kept** | Two 17s under advantage would otherwise render as two dropped dice and no winner, or as no drop at all. Pinned by a test. |
| **Die sides recovered from `diceExpr`** | Rather than stored. Nothing else had to change. |
| **The arithmetic lives in `rollView.ts`, not the component** | It is the part that can be silently wrong — a rider counted twice, or an answered `ask` that never reaches the total, is a number the player trusts and shouldn't. Thirteen tests, no renderer needed. |

### What is still owed

| Owed | Why deferred |
|---|---|
| **Per-die reroll** | Needs `{ sides, v, dropped, rerolled, orig }` on every die everywhere and touches every `addRoll` caller. It is also the one feature that lets a player change a number after the fact — a decision on its own merits, not something to inherit from a mockup. Chips render, inert. |
| **The catalog sheet** | Needs a subject gid on `RollEntry` and a catalog lookup that does not exist app-side. |
| **Tooltips** | Hand-rolled positioning, and largely redundant now the chips carry their own labels. |
| **Multi-type damage** | `damage?: DamageRoll` is singular; `byType` is built to take more the moment it is. A spells problem. |
| **The armed queue** (`once: true`) | 5c — now unblocked, since the chip has a surface to live on. `once` is still absent from the op schema, so it cannot yet be authored. |
| **DM console state panel** | 5d. |
| **The toast** | Still shows its read-only summary. It retires for rolls when this panel has been used in anger. |

---

## 46. Slice 5b-fidelity — the panel as designed

5b shipped the panel's structure and its arithmetic and deferred four things as
"polish". They were not polish: the design was arrived at over many iterations,
and the deferred list contained the two subsystems that make the panel readable
(the catalog sheet and the tooltips), the one interaction it exists to allow (the
reroll), and the frame that makes it look like this app at all.

This slice worked a full gap list of the mockup against the port — every class,
state and interaction — rather than the previous slice's summary of it.

### The frame is two layers, not a border

`.entry` had been flattened to a plain 1px rectangle. The design is a chamfered
silhouette painted by `.e-frame` with `.e-inner` sitting 1.5px inside a slightly
smaller one — a border cannot follow a `clip-path`, which is the recurring bug
`docs/Chamfered_clip-path_corners_fix.md` exists for. `--edge` is the whole
state machine: `latest`, `crit` and `fumble` each only repaint it.

### The wiki cannot read the catalogs

Checked across all 13 migrations rather than assumed:

| Table | Player policy |
|---|---|
| `item_catalog`, `spell_catalog`, `feature_catalog`, `effect_catalog` | **none** |
| `quests`, `sessions` | `player_read_*` (0007) |
| `shard_tree_catalog` | published only (0008) |
| `shop_catalog` | open shops only (0009) |

A player's client gets **zero rows** from every catalog the sheet would want. So
`catalogView()` reads the snapshots on their own character row, resolved through
`activeSources()` — the same pattern `ApplyEffectCard` already states: *"the
player never reads the effect catalog, so this is the one copy their Effects
panel tooltip has."* A subject that is no longer active resolves to `null` and
the sheet says "No longer carried" rather than drawing a blank.

The mockup's authored "Interacts With" list becomes **this roll's riders**. That
is not a substitution for missing data — it is the only version that cannot go
stale against the character's actual state.

`RollEntry.subject` is the INSTANCE id, not a gid: a gid falls back to the
instance id when `item_id` is absent (§43's live gap), and the lookup is local.

### `ask` was authored prose that nobody ever read

`resolve()` set `rider.label = eff.ask`, so the ask sentence landed in the name
slot — uppercased, letter-spaced, 9.5px — and `eff.label` was discarded. The
feature's name was the thing the player could not see. Now the label stays the
name and the sentence rides as `Rider.text`, rendered as prose under it, which
is exactly the mockup's `.rd-text`. No schema change: `ask` was already required
to be a sentence.

### The two behavioural divergences

| | Was | Is |
|---|---|---|
| `.rd-head` click | toggled the rider | **folds** it; only `.rd-sw` toggles |
| rider die chips | built with `sides: 0` | real sides, so `.max` fires and a `-1d4` face of 1 no longer false-positives `.min` |

The first matters because the switch is the gesture that changes the roll. It
should take a deliberate hit, not the whole row.

### Per-die reroll

A die is a `<button>`. Clicking it rerolls, marks it `rerolled`, keeps the face
it FIRST showed in `orig` (a second reroll never overwrites it), and moves every
total above it. Refused for two dice: one dropped by adv/dis (it did not count —
rerolling it would imply it could) and one belonging to a locked rider (§8 #2 —
the value is settled; the mockup's own handler skips them for the same reason,
which is why `DieAddr` has no rider case).

**`crit` and `fumble` are frozen at roll time.** Recomputing them from a
rerolled d20 would leave a doubled damage roll attached to a hit that is no
longer a crit. The mockup freezes them too.

This is not a contradiction of the lock. The lock is about the panel never
re-rolling on its own; a reroll is the player spending something and saying so.

### Settled while building

| Decision | Why |
|---|---|
| **`RolledDie` everywhere** | `{ v, sides, orig?, rerolled?, crit? }` on `AttackRoll.rolls`, `DamageRoll.dice`, `CheckRoll.rolls` and `Rider.rolledDice`. 5b recovered `sides` by re-parsing `diceExpr` — which is how a 6 gets drawn as a maximum roll on a d8. The die knows now. |
| **`dropped` stays on the view, not the die** | The same face is kept under advantage and discarded under disadvantage. It is a property of the line. |
| **Named modifier parts** | `CheckTerm[]` on all three roll types. The modifier read-out is the only itemised breakdown anywhere in the design, and re-splitting our own breakdown string to get there is parsing our own output. |
| **Only `sev: 'err'` reaches the Problems block** | It rendered every audit item, `ok` and `warn` included, as a red "Not applied". That is the panel lying about the roll. |
| **Its own tooltip, not `useItemTooltip`** | That one is a facts-only item card positioned to the right; this is a key/value/hint strip that flips above. Same doctrine, different shape. |
| **`--teal` and `--violet-hot` added to tokens** | Cold was borrowing `--cyan-hot`, and cyan is the player's own voice on this rail — a cold damage chip painted cyan reads as "yours" rather than "frost". |
| **The rail stays a modal overlay** | The mockup docks it permanently with the host inset by `--rail-w`. No screen in this app reserves that gutter. The one deliberate divergence; everything inside the rail follows the mockup. |

### Still owed

| Owed | Why |
|---|---|
| **`.p-src`** | The mockup prints `source · fault` under a problem's name. `AuditItem` is `{ sev, id, t, s }` — `id` is a node id, not a name. Needs either extra fields on `AuditItem` or an id→source map. |
| **`rh-num` ("07")** | A mockup-deck artifact. This app has no panel numbering to be the 7th of, so inventing one would be inventing lore. |
| **A subject on Inventory rolls** | `activeSources()` covers equipped gear, not carried items, so a consumable's sheet would always resolve to "no longer carried". Wants a carried-item lookup, not a subject. |
| **Multi-type damage** | Unchanged from 5b: `damage?: DamageRoll` is singular. Slice 6. |

---

## 47. Inline compute, and the toggle a note can earn

§25 specified inline compute in prose and nothing ever implemented it. §40's owed
list did not mention it either, so it fell between slices: `resolve()` pushed
`eff.text` to `notes` verbatim, and a description written the way §25 describes
would have shown a player raw braces.

### `{...}` computes, at resolve time

`interpolate(text, scope)` in `lib/expr.ts`. Display only — it touches no number
the engine computed; it stops a description quietly lying as the character
levels. It runs inside `resolve()` rather than in a renderer because the scope
lives there: doing it later would mean handing every surface that shows a note
the variable scope as well.

| Input | Reads as |
|---|---|
| `DC {8 + prof + wis}, Wisdom save.` | `DC 15, Wisdom save.` |
| `Deals {2d6 + 1}.` | `Deals 2d6 + 1.` — display must not roll (§13) |
| `held{upgraded ? " and restrained." : "."}` | picks the phrase |
| `It is {raging}.` | **refused** — "you deal true damage" is not prose |

**A span that does not compute is left exactly as written and reported.**
Silently dropping it hides the fault from author and player both. `auditNode`
catches these at authoring time; `Resolution.problems` catches any that still
reach a roll, exactly as a broken contribution formula does.

§25's conditional phrase needed string values, so `FormulaValue` gained
`{ t: 'str' }`. Literals only, chosen between by a ternary — there is no string
arithmetic, and `evalExpr` still rejects everything else. A variable cannot hold
one (`VarDef.type` is `num | bool`), so `characterVars` and `runActivation` both
refuse a string the same way they refuse an array.

### The usage scan had to learn to read prose

`auditNode`'s "Variable is never used" warning scanned `value`, `when`,
`threshold` and `byLevel`. A variable read only by an interpolation was reported
as dead state — which is **most of what inline compute is for**: a number the
player reads in a sentence and nothing else consults. A warning that fires on the
correct case trains the author to ignore the one that catches the real one.

### `ask` on a note: an error only when there is nothing to reveal

§40 refused every toggle on a note: prose has nothing to resolve. That reasoning
holds for a note that only carries text, and does not hold for one whose text
**computes** something — the DC exists only if the hit landed, and the toggle is
what decides whether the player sees it. Refusing that shape forced the author
into an `add` of `0` purely to buy a checkbox, with a meaningless `+0` in the
breakdown as the price. Sanctified Arrest and Judgement Cut are both this shape.

The rule now asks the question it always meant: **does answering this reveal
anything?**

```
op: note   ask: "hit with Sanctity"   text: "DC {8 + prof}, Wisdom save."   → legal
op: note   ask: "did it hit?"         text: "Ignores half cover."           → error
```

An asked note becomes a `manual` rider carrying `Rider.reveal` — the sentence
with its number already in it, held back until the player says yes. It
contributes nothing and grants nothing, so `RiderView.kind` gained a third value
rather than pretending to be a flag with no flag.

**It rides the same `ask` group as any contribution sharing the question.** That
is the reason it goes through the rider path instead of a list of its own: `+2d8
radiant` and `DC 16, Wisdom` are one confirmation, and two checkboxes for one
fact is the thing §32's grouping exists to prevent.

---

## 48. Slice 5c as built — the armed modifier queue

### `once` meant the opposite of what it said

`GraphEffect.once` landed in slice 1a documented as "arms once instead of
applying continuously". Nothing ever read it. `resolve()` had no branch, so a
`once: true` contribution applied to **every** matching roll — not a missing
feature, a live wrong number, and the reason the coverage map added in §46
recorded it as `'deferred'`.

`resolve()` now skips it beside the existing `IS_ACTIVATION` skip, for the same
reason: it is not a passive contribution. That fix lands before anything can arm.

### One predicate, three readers

`ArmedMod` already carried `kind`/`sub`/`subject` — the vocabulary `ResolveReq`
matches on. `armedMatches(mod, req)` is exported rather than hidden inside
`resolve()` because the pre-roll chips must give the **same** answer the roll
will: §16's visibility rule is worthless if the card promises a bonus the roll
then fails to apply.

An absent `sub`/`subject` is a WIDER match ("your next attack"), not a narrower
one. Deliberately not tag-matched, unlike a graph selector: an armed mod is
minted by one activation naming one target, so it says what it hits rather than
describing it.

### Arming is a press, so it is planned like one

`Outcome` became a discriminated union — `kind: 'var'` and `kind: 'arm'` over a
shared `{ eff, ask, summary }`. One list, so the confirm sheet renders both with
no change, `ask` gates an arming exactly as it gates a variable write (§32 does
not care what is being resolved), and one press produces **one** `resources`
object. Two lists would have meant two confirm sheets and two write paths.

Selector translation, since the queue is keyed by roll kind:

```
roll:attack    -> { kind: 'attack' }             "your next attack"
roll:save.dex  -> { kind: 'save', sub: 'dex' }
(no target)    -> { kind: 'feature', subject }   this node's own roll
anything else  -> an authoring error
```

A gid or a tag cannot be expressed as a queue key, and arming one would produce a
chip promising a bonus that then matches no roll. `auditNode` blocks it.

`isUsable()` counts a `once` effect, or a feature whose only effect is "arm your
next attack" would have no button to arm it with.

### The two decisions that are not §16's

| Decision | Why |
|---|---|
| **A short rest clears `armed` too** | §16 says long only. An armed modifier is the pending effect of a use already spent; if a short rest hands the use back, letting the pending effect survive lets a "1/short rest" feature bank one armed bonus per rest. Both rests clear it in the SAME patch that clears `activeEffects` — §16's own Lifetime argument. |
| **Re-arming refreshes, it does not stack** | One entry per `source:effect[:selector]`, which is what `ArmedMod.id` is built from. A doubled bonus from a double-tap is a silent wrong number, which is the entire class of bug the roll panel exists to prevent. Two genuinely independent bonuses come from two effects. |

### Consumed-ness is derived, never stored twice

An armed rider carries `Rider.armedId`. The panel asks whether that id is still
in `resources.graph.armed`; gone means consumed. So `RollEntry` gains no state,
and a modifier consumed on another surface — or another device — reads correctly
everywhere without a second record to disagree.

Consuming is one tap and nothing else triggers it. §8 #1: **only the player knows
whether the attack resolved**, so an armed auto-crit does not burn on a miss.

### Settled while building

| Decision | Why |
|---|---|
| **`GraphContext` carries `armed`** | Rather than a per-roll parameter. An armed modifier the roller forgot to look up is a bonus the player was promised and did not get; making it opt-in guarantees that eventually happens. |
| **Armed riders are `when: 'always'`** | That is already the contract for "folded into flat/dice, named as a rider, skipped by `total()`'s rider sum". Reusing it means no new double-count case in either `total()` or `rollTotals`. |
| **A broken armed formula stays armed** | It reports a problem and applies nothing. Silently dropping a spent resource because its formula broke is the worst available outcome. |
| **`ArmedMod.dmgType`** | Added while building: without it an armed "+2d6 radiant" lands in the untyped bucket. Shipping that would have been §46's damage-type bug a second time, one layer down. |
| **Gold, not cyan, for both chips** | Cyan is the player's own voice — state they are holding. An armed modifier is a value already spent and waiting to land, which is what gold means everywhere else in this app. |
| **`rest.ts` imports gained `.ts` extensions** | It was the one non-testable module in the chain; Node's runner could not load it, so "both rests clear the queue" could not be pinned. |

### Still owed

| Owed | Why |
|---|---|
| **Auto-consuming on a hit** | §8 #1, and the "Deliberately not built" list names it twice. Not an oversight. |
| **An expiry or countdown** | Rest clearing is the lifetime. No chip in this app renders a countdown today, and no content needs one. |
| **The armed queue on the DM console** | 5d, with the `active` bools. |

### §32's fold, corrected (found in manual test)

Three faults in the same eight lines, all found by authoring Condemning Strike
for real rather than by reading the code.

**1. Order decided what the group did.** A grouped rider takes its `op` from its
FIRST member, and a `note` contributes prose and nothing else — so a note
authored ABOVE its contribution made the whole group a note. The toggle revealed
the text and silently dropped the dice: no roll button, no value, and nothing on
screen to notice. A contribution now outranks prose on merge. Both orders are
pinned by a test; the shipped bug only reproduced in one of them, which is
exactly why the original test passed.

**2. The revealed prose was gated on the rider's KIND**, so an upgraded group
lost it. It now renders for any rider carrying `reveal`.

**3. The ask is a KEY as well as prose**, and it was compared byte-for-byte.
A trailing space, a capital, a double space: two toggles for one decision,
identical on screen. `askKey()` normalises for grouping only — the rider still
displays the authored text verbatim. Same lesson `normalizeTag()` already
learned one field over, applied late.

The editor now offers the asks already used on a node as a dropdown, because a
grouping key you have to retype by hand is a key you will eventually mistype.

**Still lossy, now loudly:** a rider carries ONE op, so two contributions of
different kinds under one ask (an `add` and an `adv`) cannot both be represented
— one applies and the other is dropped. That predates this slice. It is now a
`warn` naming both ops rather than silence, and the fix is the author's call:
two asks, or one op. Making it lossless means a rider carrying a SET of ops,
which is a rider-model change and not worth one warning's worth of content.

### The pre-roll offer

§16 argues that a bonus you have armed and cannot see is worse than no bonus,
because you roll without it and never learn why the number was low. The same
argument one step earlier: a bonus you *could* arm, that the roll surface never
mentions, is one you forget exists — and worse, because you spent nothing and got
nothing.

Arming is a **pre-roll decision**. Before this, making it meant leaving the
weapon, finding the feature, pressing Use, and coming back — the decision on a
different screen from the roll it belongs to.

The weapon card now carries a **dashed ghost chip** per armable feature. Dashed
is what a ghost flag already means in the roll panel: offered, not taken. Tapping
it is the feature's Use in full — it spends the use and asks whatever the author
attached — and the chip becomes the solid gold armed one.

Not a sheet on pressing Attack. That would put a step between the player and
every attack forever, including the overwhelming majority with nothing armable.

**`armableFor()` routes through `planActivation`** rather than reading `once`
directly, so `when` gating, DM-variable refusal and every other rule are honoured
once rather than reimplemented for the offer. A feature already holding an armed
entry is not offered: re-arming refreshes, so the player would be paying a second
use to replace a bonus they already have.

### One definition of "use a feature"

The press moved out of the Features screen into `components/ActivationSheet.tsx`
when the weapon card gained a reason to make it. A press does four things that
must not drift — roll the expression, spend a use, apply the outcomes, and write
all of it in ONE round trip — and two copies of that is eventually a feature
spent on one screen and not the other. Same argument §16 makes about rests
having one write path.

The confirm sheet took its CSS with it, carrying its own `.overlay` rather than
reaching into a screen's stylesheet: the Features detail panel still uses that
one, and a shared component depending on a screen is backwards.

**Not offered anywhere else yet.** A `once` targeting `roll:save.dex` has no
chip beside the save on the Character screen. The query is the same call; the
hex-grid layout has no obvious slot for it, which is a design question rather
than a missing function.

### Two arithmetic faults the armed queue exposed

Reported as "consuming the charge doesn't roll the bonus dice — still +0". The
engine was right: `total()` returned `dice: ["1d6"]` and the roller rolled it.
The panel was wrong, twice, and neither fault was armed-specific.

**1. A dice contribution read as "+0".** `riderValue()` is the number a rider
adds to the panel's totals, and for a dice contribution that is genuinely zero —
the roller already folded the dice into the line's modifier. Printing it as the
contribution's amount said `+0` for a `+1d6`.

`riderAmount()` now says what it is: `+1d6`, `+1d6 + 2`, `-1d4` (a dice term
carries its own sign and must not gain a second). The toast had a correct copy of
this while the panel had an incorrect one — two implementations of one sentence,
and the wrong one was on the surface that exists to be trusted. One now, shared.

**2. The footer double-counted every `active` rider.** §45 identified this trap
for `always` riders and fixed only half of it. The rule was never about `always`
— it is about **who folded it in**:

> Every roll producer builds its bonus from `total()`, which contains the
> unconditional fold (`always`) AND every resolved rider (`active`). Both are
> inside the line's modifier before the entry exists. A `manual` rider is the
> only one that is not, because it is answered and rolled AFTER the roll — which
> is the entire reason this panel can change a total at all.

So `rollTotals` adds **only** `manual` riders. Before this, a feature granting a
flat `+3` on a true condition made the footer read three higher than the line
directly above it. Pinned by a test asserting the two agree.

---

## 49. Owed: `Resolution` records every contribution twice

Found while answering "it doesn't show the number that rolled — is that
correct?" It is not, and the reason is structural rather than cosmetic.

### The duplication

An `always` rider's contribution is stored in two places:

```ts
if (eff.when === undefined && !eff.ask) {
  out.flat += v.flat; out.dice.push(...v.dice)   // the fold
  out.riders.push({ ...v, when: 'always' })      // …and the same numbers again
}
```

Armed modifiers do the same. Every additive contribution that surfaces already
becomes a rider, so `res.flat` and `res.dice` hold nothing the rider list does
not — they are a second record of one fact, which is what
`CLAUDE.md`'s opening rule exists to forbid.

### What it has cost, twice

| | |
|---|---|
| §45 | `total()` had to learn to skip `always` riders or every unconditional contribution doubled. |
| §48 | The panel's footer did the same thing to `active` riders and read higher than the line directly above it. Fixed by "only `manual` riders are added" — a rule that is only necessary because the fold exists. |

Both are the same bug wearing different clothes, and the fix each time was a
filter rather than a removal.

### What it blocks

The roller flattens before it rolls: `total()` returns one dice list, the roller
rolls it, and the faces are summed into the line's modifier with **no record of
which rider each face belonged to**. So a `+1d6` contribution can be named but
its result cannot be shown — a number the player is told to trust and cannot
check, which is the failure this whole panel exists to prevent.

### The change

Delete the fold. `res.flat`/`res.dice` go; `total()` sums the riders, which are
then the single record. The roller rolls **per rider** and writes the faces to
`rolledDice`, the field manual riders already use — so the panel prints
`1d6 → 4` with no new shape at all.

Touches `resolve()`, `total()`, both roll producers (`rollWeaponAttack`,
`Character.tsx`'s `pushCheck`) and the tests asserting `res.flat`/`res.dice`
directly. `total()`'s OUTPUT is unchanged, so every assertion about a roll's
arithmetic still holds — which is what makes this safe to do late.

Its own slice. Not folded into 5c, because a refactor of the engine's core shape
smuggled into a feature commit is how the next person loses the ability to bisect
either.

### As built

Deleted: `Resolution.flat`, `Resolution.dice`, both writers, and the literal in
`resolve()`. Riders are the only record now.

**The split, and it is the whole of it:**

> The **roller** folds every rider that is not `manual`.
> The **panel** adds only the ones that are.

A `manual` rider is answered and rolled AFTER the roll, which is the entire
reason the panel can change a total. Everything else is already in the line's
modifier before the roll entry exists. Between them each rider lands exactly
once, and neither side needs to know what the other did. `total()` is keyed on
`when` rather than on `r.on` — a non-manual rider is always on, so the two agree
today, and naming the rule after the invariant means it keeps agreeing.

`rollResolution(res, double)` is the roller half: it throws every non-manual
contribution's dice ONCE and keeps the faces on the rider that owns them. It is
the only function in `graph.ts` that touches randomness, and deliberately not
`resolve()` — a crit doubles damage dice, so the engine hands them over unrolled
and the roller decides. Both producers return their annotated riders, so
`Equipment.tsx` and `Character.tsx` put those on the RollEntry instead of the
raw ones.

The contribution row now reads `1d6 → +4`, using the mockup's existing
`.cForm` + `.cVal` shape; the individual faces are in the row's tooltip.

**What made this safe to do late:** `total()`'s OUTPUT is unchanged. Every
assertion about a roll's arithmetic still held; only the 33 that read
`res.flat`/`res.dice` *directly* were retargeted at `total(res)`, which is the
value they were always reaching for. Three production `total()` call sites needed
zero edits, because no application code ever read the fold.

Two tests changed MEANING rather than spelling — they existed to pin the
two-record split (`assert.equal(r.flat, 0) // resolved riders are NOT in flat`).
After this there is no "in flat" for a rider to be out of, so each now asserts
the property the original was reaching for: counted, and counted once.

Verified by mutation: reinstating the old `always` filter fails 19 tests, letting
the panel's half in as well fails 3, and rolling manual riders fails 1.

---

## 50. Slice 5d as built — the DM console state panel, and the bucket nobody could write

§8 #4 asked for a read-out: "the per-character console panel surfaces which
features are currently ON (e.g. Rage). QOL, non-blocking." Scoping it found
something larger.

### `dmVars` had no writer anywhere in the app

DM-only variables were declared by authors, read by the engine (`storedValue`),
and guarded by migration 0015's trigger — and **no surface could set one**.
`mercy` and `condemnation` drive §21's entire Arbiter path and could only be
changed by hand-editing JSON.

That is §46's "in the type, not in the app" bug, one layer out from where the
coverage guard looks: the guard checks that every `GraphEffect` field is
authorable, and this was a `VarDef` *scope* with no editor. Worth remembering
that the guard's shape, not just its contents, is the lesson.

### The panel's shape IS §31

| | |
|---|---|
| **Player state** | read-only chips. Theirs to change. |
| **DM variables** | editable. Yours. |

A card that let the DM edit both would make the split invisible exactly where it
is being explained. The DM's RLS (`dm_all`) permits writing either, so this is a
choice about legibility rather than a limitation — and the rarer "force a
player's variable" case stays a conversation, which it should be.

Also on the card: the armed queue with a Clear button, and §30's promised
collision banner (`characterVars(row, …).audit`, filtered to errors).

### Verified against the live database, both branches

Migration 0015 reverts a `dmVars` change when `auth.uid()` is not in `dm_users`.
The player-side revert was proven in 5a; the **DM-permitted** branch never was,
and it is the entire premise of this card. Proven on a throwaway row by faking
`request.jwt.claims`:

| step | result |
|---|---|
| DM writes `dmVars.mercy = 18` | lands |
| non-DM writes `999` | reverted, still 18 |
| player's own `vars` bucket | untouched |

RLS confirmed alongside it: `dm_all` is `ALL` on `characters` for any `dm_users`
member, so the DM may write any row; `own_character` covers the player's own.

### Settled while building

| Decision | Why |
|---|---|
| **`scopedVars(character, scope, trees)`** | `playerVars` was the same walk with the filter one way. Two copies would be two places for §31's split to drift, when the whole point is that the bucket IS the permission. `playerVars` is now a one-line alias, so every existing caller is untouched. |
| **`seen` spans both scopes** | A name declared twice — once player, once DM — must not appear in both lists. First wins, matching `collectVars`, and the collision is reported by the banner rather than re-reported per row. |
| **`withVars` takes the bucket; `setDmVars` joins `setVars`** | `graphState.ts` stays the only writer of `resources.graph`. |
| **Number edits write on SETTLE** | The console's realtime channel fans every write to every connected client, so a stepper firing per keystroke is not free. `VarControl` (Features.tsx) solved this player-side; the control here is written against the console's amber idiom rather than extracted, because the two layers deliberately do not look alike. |
| **Clear reuses `consumeArmed`** | The DM's clear and the player's consume are the same operation. |

### Slice 5 is closed

5a state · 5b panel · 5b-fidelity · 5c armed queue + pre-roll offer · 5d this ·
5e one record per contribution. Next is slice 6 — spells, items and shards
reaching the graph, and multi-type damage with them.

---

## 51. Slice 6a as built — the read path

§18 scopes slice 6 as "spells, saves & checks, items, shards — each ~20 lines of
wiring". Saves and checks were already done. The rest splits in two, and this
slice is the first half:

- **the read path** — the roll surfaces resolving the graph, so an authored
  contribution on a spell or item actually applies. *Built.*
- **the authoring path** — a DM being able to author one. Deferred: ~375 lines of
  `FeatureEditor` are portable (`EffectRow`, `EffectCard`, `SchemaField`, the
  target picker) but sit behind a 61 KB CSS module and ~1200 lines of
  feature-editor chrome that does not transfer.

Doing the read path first was deliberate — it proves the plumbing before three
editors are built on it, and it is where the silent failures were.

### Shard nodes were dropped entirely

`buildContext()` is kind-agnostic: it filters on having a gid, so spells, items
and weapons were already indexed. `sourceGid()` returned **null** for
`shardnode`, so an attuned node's authored graph reached the index nowhere — a
third "authored, stored, doing nothing" after `once` and `dmVars`.

`ActiveSource`'s shardnode variant now carries the owning `shardId`, because a
node's own id is unique only within its tree: every shard is seeded with a node
called `core`, so an unqualified id would make one shard's Core targetable
through another's. `nodeGid(shardId, nodeId)` already existed for exactly this
and is what the editor's targets were always built from.

### A gid-targeted contribution was counted twice

Exposed by this slice and the third double-count of the session. An effect
targeting `spell:S` is ONE statement — "+4 to Sacred Flame" — and it landed
twice when S also carried its own contribution:

- directly, because the roll's `subject` IS `spell:S` and subject is a match key;
- again as a **boost**, because `boost(owner)` reads the same index bucket.

`boost()` now skips anything already in `seen` — the set of effects that matched
the roll. Chaining is for nodes the roll did **not** name (§4's "B boosts A, A
contributes"), which are exactly the ones not in `seen`. Reverting the fix fails
3 tests.

Only reachable once a roll's subject could carry its own graph. Before this slice
that was weapons only, and no weapon was authored with one.

### The three surfaces

| | |
|---|---|
| **Spells** | `rollSpellDamage` takes a `Resolution`, mirroring `rollWeaponAttack`. The roll entry stops being a prose line and becomes a real `DamageRoll` + `riderGroups`, which is what gives a cast die chips, a rerollable die, the contribution list and the catalog sheet — every panel surface from 5b–5e applied the moment the shape was right, and none of it had to know spells existed. `SpellRoll.rolls` became `RolledDie[]` with it. |
| **Items** | `consumeEffect` takes a `GraphContext` and resolves against `item:<gid>` and the item's tags, so "+2 to any potion you drink" lands on the heal. Both roll entries gained `subject`, so the panel can open the item's sheet — and the wasted-use entry carries the riders too, because the player should see what WOULD have applied. |
| **A feature's own roll** | `ActivationSheet` resolves `{ kind: 'feature', subject: gid('feature', f) }`. A feature could contribute to every roll in the app except its own. |

### Settled while building

| Decision | Why |
|---|---|
| **A carried item's own graph does NOT apply** | `EquippedItem.graph` says "while EQUIPPED", and a potion in a bag is not equipped. What slice 6a wires is other nodes targeting the item, which is the useful half. |
| **`SpellRoll.rolls` holds the spell's own dice only** | Graph contributions fold into `total` and are named in `riders`. That array is what the Spellbook's in-screen chips render as the spell's printed damage, and mixing a rider's dice into it would make the printed damage a lie. |
| **A missing item `id` means no subject** | Rather than an unresolvable one. A catalog sheet that always reads "no longer carried" is worse than no book glyph. |

### §6's spell-gid note is stale

It says "No stable `spell:<id>` graph ids yet". §11 already contradicted it, and
the code agrees: `spell_catalog.id` is a stable DB primary key, the grant path
sets `spell_id`, `gid()` reads the back-ref first, and the editor targets by it.
One residual hazard: a spell hand-seeded onto `spellbook.spells` **without**
`spell_id` falls back to a per-character instance id that no cross-character
authored target can name. Not a blocker; worth a check when seeding.

### Still owed

| Owed | Why |
|---|---|
| **The three catalog editors** | The authoring path — nothing can be authored on a spell, item or shard node yet, so this slice's read path has nothing to read until it lands. |
| **Multi-type damage** | `RollEntry.damage` is singular at every layer AND `Spell` models one `dice`/`dmgType` pair, so "1d8 radiant + 1d6 fire" cannot be expressed in the type. A spell-model change, not a panel change. `RollTotals.byType` is already plural and waiting. |
| **`AmmoBonus`** (§19) | Nocked ammunition is a carried item and not an active source, so this needs a decision about what "active" means for a nocked stack — the same question a consumable's own graph asks. |
| **The lattice audit absorbing `auditNode`** | ~5 lines; pointless until a shard node can be authored with a graph. |

### Two things manual testing added

**`roll:damage.melee` / `.ranged` / `.spell`.** "Damage dealt by a weapon, not a
spell" had no way to be said. The sub mechanism `roll:save.dex` already uses
covers it with no new vocabulary: the sub NARROWS, so `roll:damage` still
matches everything and `roll:damage.melee` matches only a melee weapon. Weapon
damage is two selectors (`melee` + `ranged`), because the target list is an OR
and there is no "weapon" roll kind to name.

Wiring it exposed that **`attack.melee`, `attack.ranged` and `attack.spell` had
sat in the editor's dropdown since slice 3 while no roll surface ever passed an
attack sub** — authoring one matched nothing, silently. The fourth of this shape
after `once`, `dmgType` and `dmgVars`. Both rolls now take a sub, and they narrow
independently: "advantage on melee attacks" is `roll:attack.melee`, "+2 melee
damage" is `roll:damage.melee`, and a bow gets neither.

A guard test now asserts every entry in `ROLL_SELECTORS` is one some roll surface
actually passes. `attack.spell` is named in it as the known exception — nothing
in this app rolls a spell attack — so it cannot be quietly forgotten a second
time.

**A spell's save DC** fills the footer slot an attack roll would occupy, which
was empty on every cast. It leads the lines, dice-less, so the math reads
`15 = 15`; `RollLineView.totalLabel` exists so the footer can say "Save DC"
rather than "Total Save DC", which a DC is not.

It is the CASTER's DC (`spellbook.saveDC`), shown on every cast, because nothing
on `Spell` records which save a spell calls for or whether it calls for one at
all. A per-spell `save` field is the proper fix and needs a `SpellForm` control
in the same change — the rule this project keeps relearning.

---

## 52. Slice 6b as built — spells can be authored

6a made a spell's graph resolve. Nothing could write one: `graph`/`vars`/`tags`
sat on `CatalogSpellData` marked "shape only for now", and `SpellForm.build()`
enumerates every key by hand, so the fields were simply absent from the save.
6a's read path was reachable only through a *feature* targeting a spell.

### Placement: a fold, not a screen

The DM side had two precedents pulling opposite ways — features and shards each
have their own screen, while the item form hosts a collapsed "Effects Granted"
fold. The fold won:

```
▸ Roll Contributions        2 effects · +1d6 radiant, adv
▸ Effects Granted           none · references the effect library
```

Same `catFx`/`fold`/`fxfHead` idiom, a summary line when closed so it stays out
of the way for the 90% of spells with no graph, and — the deciding argument —
**one component, three hosts**: items and shard nodes get the identical block in
6c. A `/dm/spells` screen would also have meant editing one spell in two places,
since the 25 scalar fields stay in the console form regardless.

An `err` from the audit **blocks save**, matching the gate the feature editor
puts on Publish (§17). An audit that does not block is a suggestion.

### The extraction

`components/GraphEffects.tsx` — `GraphEffects` (palette, rows, one expanded card)
and `VarsBlock`, plus `EffectRow`/`EffectCard`/`SchemaField` and the catalog
picker. `FeatureEditor` went 1740 → 1291 lines and renders the same two blocks.

**Self-contained on purpose.** It owns its expanded-card state and its own two
popovers — the catalog picker and the when/ask/target help — so a host form can
drop it in without learning what a `PopKind` is. The editor's other popovers
(icon, delete, revert, folder) are chrome and stayed behind.

`EffectCard`'s only coupling was `d: CatalogFeatureData`, used for exactly two
things: sibling `ask` values and `vars`. Both are node properties, not feature
properties, so it now takes `graph` and `vars` directly.

`lib/useCatalogNodes.ts` lifts the cross-catalog target list — a second copy
would be a second answer to "what can be targeted", and they would drift the
first time a catalog gained a kind. Its `ready` flag is load-bearing:
`auditNode` skips dangling-target detection on an empty node list, so an audit
that runs before the libraries load reports a clean node that is not clean.

### The CSS, measured rather than guessed

The planned split did not survive measurement. The extracted components use 83
classes: 45 are nested selectors and 27 are form atoms the editor's own chrome
still needs, so a separate module would have **copied ~128 rules** and left them
to drift.

`FeatureEditor.module.css` moved to `components/authoring.module.css` and both
hosts import it. It IS the DM authoring design language rather than one screen's
private styling, the bytes already shipped, and nothing is duplicated. The
console imports nothing new — it renders `GraphEffects`, which brings its own.

One pre-existing find: `.pickbtn` had no rule at all. Harmless under the global
`button` reset, but the catalog-picker button never showed it was clickable. It
has a hover state now.

### Still owed

| Owed | Why |
|---|---|
| **Items and shard nodes** | 6c. The identical block, two more hosts, plus the lattice audit absorbing `auditNode` (~5 lines) with the shard half. |
| **Draft/publish for spells** | Only `feature_catalog` has a `draft` column. Not needed while the graph saves with the form; a migration if that changes. |
| **A per-spell `save` field** | 6a shows the caster's DC on every cast because nothing on `Spell` records whether a spell calls for a save. Its own change, with its own `SpellForm` control. |

### Casting arms, too (6b follow-up)

`once` on a SPELL was silently dead. `resolve()` skipped it — correct, a `once`
contribution arms rather than applies — but nothing armed it: the queue was
filled only by `planActivation`, reached only from a feature's Use button.
Ticking "Arms once" on a spell effect therefore turned it off.

Found by the user asking whether "cast the spell → next attack does +2d6" was
expressible. It was the right shape and the app could not do it.

`castSpell` now runs `planActivation` + `applyOutcomes`, which needed no change:
the signature is `{ vars?, graph? }`, so a spell fits it structurally — the same
kind-agnosticism that let `auditNode` serve a second host in 6b.

**A cast accepts every outcome.** A feature's Use shows a confirm sheet where an
`ask` can be declined; casting has no second step to hang one on, because the
slot is spent by the time the outcomes are planned. The cast IS the confirmation.

Slot spend and armed modifier land in ONE `updateSections` — two writes could
leave a slot spent with nothing armed.

Also surfaced while answering: **a spell in `spellbook.spells` is an active
source unconditionally, prepared or not.** So `add 2d6 → roll:damage` on a known
spell adds to every weapon swing. That is targeting working as specified rather
than a bug — an empty target scopes it to the spell's own casts — but it is the
easiest mistake to make with the whole engine, and it is now the first thing
`docs/GUIDE_Codex_Authoring.md` says about scope. Whether an UNPREPARED spell
should contribute at all is a real design question, still open.

### Readiness, and the save a spell actually calls for

Two follow-ups the user asked for after 6b.

**Only ready spells contribute.** `activeSources` pushed every row in
`spellbook.spells`, so a spell you merely knew contributed to every roll. It now
filters on `isPrepared(sp, sb)` — which already existed and already encoded the
rule, including the trap its own comment names: cantrips are always ready, and a
known-style caster (pact magic, or `preparesSpells: false`) prepares nothing, so
reading `spell.prepared` directly would silence every spell a Warlock owns.

An unready spell's `vars` leave scope with it, which is correct and worth
knowing — a `when` over one of them cannot resolve, so the effect does not merely
fail to apply, it does not surface. One of this slice's own tests caught that.

Checked before shipping: Ros's only spell is a cantrip (always ready) and
Cornelius is pact magic, so no live data changed behaviour. No backfill needed.

**The cycle this would have closed.** `effects.ts` → `spells.ts` → `graph.ts` →
`effects.ts`, because 6a gave `rollSpellDamage` a runtime import of
`rollResolution`. Broken by having it take the ALREADY-ROLLED contribution
instead: `spells.ts` now imports only the `Rider` type, which is erased. Better
shaped anyway — a spell has no crit to decide, so there is nothing to roll inside
that the caller cannot roll outside, and `spells.ts` stays pure math.

**`Spell.save`** — the ability the TARGET rolls. Presence means "this spell calls
for a save"; absence means it does not, so the panel shows a DC only when there
is one. The DC stays the caster's (`spellbook.saveDC`) because 5e derives it once
per caster and a per-spell copy would be free to disagree.

Shipped with its `SpellForm` control in the same change, per §46's rule — a
picker beside Damage, defaulting to "no save". The panel's line and footer now
read `DEX Save DC` rather than a bare number.

**A gid is not a name.** An armed rider showed `spell:afab43d3-…` in the source
column, where every other rider shows a human name (`from.obj.name`).
`ArmedMod.source` cannot simply become the name — it is IDENTITY: `id` is built
from it, dedup keys on it, and both cards match on it. So `sourceName` rides
alongside, captured when the modifier arms.

Captured rather than looked up, because by the time it is read the source may be
unequipped or unprepared — exactly the states this slice just made matter — and a
lookup would come back empty for a bonus that is still legitimately pending. An
entry armed before the field existed falls back to the gid; any rest clears the
queue, so those age out within a session.

---

## 53. Slice 6c as built — items and shard nodes

The third and fourth hosts, and the slice that cashes in 6b's placement bet:
**one component, three hosts** turned out to be one component, four. `SpellForm`,
`CatalogForm` and `NodeInspector` render the same `GraphEffects` + `VarsBlock`
the feature editor does, with no changes to the component in either addition.

Greenfield data-wise, checked before starting: 20 item rows and 27 shard nodes,
none carrying `graph` or `vars`.

### The item form dropped them the same way the spell form did

`CatalogForm.build()` (`OperatorConsole.tsx:1464`) rebuilds `CatalogItemData`
field by field, so `graph` and `vars` were absent from every save — the second
instance of that exact trap in two slices, and the codebase had already
documented the first. Both now join the builder, omitted when empty.

The fold sits beside "Effects Granted" and is deliberately not it:
`effects`/`effectRefs` is the passive numeric layer compiled into `ItemEffects`;
`graph` is per-roll and conditional. `database.types.ts:513` already drew that
line, and now the UI does too.

### The shard leak was already prevented — and now it is tested

`splitForSave` already routed `graph`/`vars`/`tags` into secrets for a concealed
node, because it rebuilds the concealed branch field-by-field rather than
spreading, *"so that a field added to ShardNode can never leak to the player
catalog by default"*. Nothing needed changing.

What it did not have was a test, and `dmShards.ts` cannot have one — it imports
the supabase client, which reads `import.meta.env` and does not load outside
Vite. So `mergeTree`/`splitForSave` moved to **`lib/shardSecrets.ts`**: pure, no
React, no network. Five tests, and the important one is mutation-verified —
adding `graph` back to the geometry literal fails with
`graph leaked to the public catalog`.

That boundary is the one genuinely dangerous thing in this slice.
`shard_tree_secrets` has no player policy ever (0008), so a field that reaches
`shard_tree_catalog.data` is in every bound player's client, and a spoiler has
no undo.

### The asymmetry 6a created, closed

A concealed node's mechanics never reach a player. But the DM's copy HAS the
secrets merged, and 6a is what first let a shard node into the resolve index —
so the operator console would have simulated contributions the player's sheet
could not have, and the two would quietly disagree.

`activeSources` now skips a concealed, unrevealed node, which `shards.ts:156`
has always done for perks and features. A no-op on the player client (the data
is already absent) and the thing that keeps the DM honest.

### The lattice audit absorbed the graph audit

`audit(tree)` already returned the shared `AuditItem[]` and already rendered it
with click-to-select. It now appends `auditNode({ graph, vars }, nodes)` per
node, re-tagged with the node id so a graph finding selects its node like any
other. Appended BEFORE the clean-bill push, or an error renders beside "Safe to
publish"; Publish was already gated on `errs > 0`, so a graph error blocks it
with no new wiring.

The lattice loaded no catalogs, so it gained `useCatalogNodes()` and gates the
audit on its `ready` — without which `auditNode` skips dangling-target detection
and reports a clean node that is not.

### Still owed

| Owed | Why |
|---|---|
| **A carried item's own graph** | `EquippedItem.graph` says "while EQUIPPED". Still gated on the open "what does active mean for a carried item" question, which also blocks §19's `AmmoBonus` deletion. |
| **Concealed graphs for players** | Would mean sending mechanics they are not meant to have. A design question, not a slice. |
| **Multi-type damage** | Still a `Spell`-model change first. |

### Tags, on all four kinds

Included after all: `tag:` was the last piece of the vocabulary that only worked
on features. `Equipment` has always passed `weapon.tags` into every attack it
rolls and `Spellbook` passes `sp.tags` into every cast, but nothing outside the
feature editor could author one — so `tag:fire` matched a feature and nothing
else, while looking like it should match everything.

`TagsBlock` extracted alongside `GraphEffects` and `VarsBlock`, autocomplete
included, and hosted by all four forms. Normalisation on save is the point:
`radiant` / `Radiant` / `radient` all look right to an author and match nothing,
which is why the autocomplete offers what is already in use rather than trusting
anyone to retype it.

That makes the extraction's final count **three components, four hosts** — and
the feature editor's own tag block is now the shared one, so it cannot drift from
the other three.

---

## 54. `and` target lists — §20's rejection, revisited on evidence

§20 recorded "AND / negation in target selectors" as rejected: *"No catalogued
feature needs one. OR-only keeps matching a single pass."* That rejection carried
its own condition, and a feature met it.

**The case.** Tag a weapon `fire`, author `add +1 fire → tag:fire`. It applies to
the attack roll AND the damage roll — +1 twice for one swing. Not a bug in
matching: a weapon carries its tags into both resolves, and `tag:fire` says
*which weapon*, never *which roll*. There was no way to say the second half.

**What was NOT built, and why it was offered.** "OR within an axis, AND across
axes" — thing/tag selectors OR together, `roll:` selectors AND against them —
gets every case right with no field and no control, and no authored list would
have changed meaning (every one has a single selector). It was recommended and
declined in favour of the explicit toggle, which is a legitimate preference: the
implicit rule is invisible in the editor, and this one is a switch you can see.

**`GraphEffect.match?: 'or' | 'and'`**, absent meaning `or` — so every stored
effect keeps its meaning and the field is only written when set. Matching gained
one condition on the existing single pass, so §20's performance reasoning still
holds:

```ts
if (e.eff.match === 'and' && !(e.eff.target ?? []).every(t => keySet.has(asKey(t)))) continue
```

`asKey` normalises a tag target the way the index does, or `tag:Fire Damage`
would never match a request carrying `fire_damage`.

**The toggle's sharp edge, paid for in the audit.** A roll has one kind and one
subject, so an `and` naming two roll kinds, two subjects, or two sub-kinds can
never match. That is an **error**, naming both halves of the clash — the toggle's
one way to fail silently, made loud. Broad-plus-narrow of the same kind
(`roll:damage` + `roll:damage.melee`) is satisfiable and passes, because a melee
damage roll carries both keys.

The control appears only once a list has two selectors, and the collapsed effect
row joins targets with ` + ` instead of ` | ` so the mode is readable without
opening the card.

**Known limit:** an `and` list mixing a node gid with a roll kind is not a
chaining expression. `boost()` skips effects already considered, so an `and` that
failed the roll match does not boost its named node either. Nothing authored
wants that shape today; if one does, it wants naming rather than inferring.
