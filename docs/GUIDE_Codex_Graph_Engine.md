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
| **Spells** | Blocked until the Spellbook slice lands — `CharacterRow.spellbook` is currently an untyped `Record<string, Json>` with no shape to write into. Build Spellbook *with the engine in mind*. |
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

- **A combat tracker.** Marked creatures, per-creature limits, "for 1 minute" durations,
  and on-kill triggers would require initiative, enemy HP, targets, and rounds — at which
  point the app is a VTT and the DM is running combat in the app instead of at the table.
  Durations remain manual, consistent with how potion effects already work.
- **A target registry.** No targets means Condemnation's marked creatures and Balance
  Eternal's per-creature limit stay prose with a use counter.
- **Inferring triggers.** Unchanged and permanent. The graph *computes*; it never decides
  whether a creature counts as judged.
