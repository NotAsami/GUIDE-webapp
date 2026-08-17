# Deferred by design — the register

Things that are **designed but not built**. Not a backlog and not a wishlist:
each entry exists because the design question came up, got answered, and the
feature that would force it had not arrived yet.

Three registers, kept apart on purpose:

| | |
|---|---|
| `GUIDE_Codex_Graph_Engine.md` §20 | **Rejected.** Reasons that do not expire. |
| each slice's *Still owed* | **Should build.** Known gaps in shipped work. |
| **this file** | **Would build, when something forces it.** The design is done; the trigger has not happened. |

Every entry names its **trigger** — the shape of content that means "now". §14
set that precedent for parentheses in formulas: *"add with the feature that
forces it, named in the comment."* Two rejections have already been revisited
this way (parentheses, and `and` target lists in §54), so the pattern works. If
you are reading an entry because you just hit its trigger, the design below is
meant to be enough to start from.

---

## Nested target conditions — `(A & B) | C`

**Trigger.** You want one effect whose targeting is genuinely two alternatives,
at least one of which is a conjunction. Concretely:
`(tag:fire & roll:damage.melee) | tag:epic_spell`.

**Why the workaround stops being enough.** Two separate effects already express
this — one `and` list, one plain list, same label and value. That is correct
while the branches are **mutually exclusive**. The moment something satisfies
both — an epic fire spell that also rolls melee damage — **both effects match and
the contribution lands twice**. Overlap is the signal that you have hit the real
case; if the branches cannot overlap, keep the two effects.

**The design: disjunctive normal form.** Every AND/OR expression over positive
selectors flattens to an OR of ANDs, nesting no deeper than two.

```ts
target?: string[]           // today — a single group
targetGroups?: string[][]   // [[tag:fire, roll:damage.melee], [tag:epic_spell]]
```

Backward compatible by construction: today's `match: 'and'` list is the
one-group case, and today's `or` list is N groups of one. Matching stays a single
pass and one line:

```ts
groups.some(g => g.every(t => keySet.has(asKey(t))))
```

**Cost.** The engine is ~10 lines. **The expense is entirely authoring UI** —
chips inside bordered groups with "or" between them, add/remove group, move a
chip between groups. Call it 150–200 lines in `components/GraphEffects.tsx`. The
audit's unsatisfiability check (§54) runs per group instead of once.

A cheaper presentation if the nesting is not worth drawing: keep one flat chip
list and put a small group number on each chip — `¹tag:fire ¹roll:damage.melee
²tag:epic_spell`. Same data, no nested layout.

**Add with it:** a warning when two groups can both match at once, since that is
§54's double-count wearing a new hat.

**Do NOT** implement this as an expression *string*
(`"(tag:fire & roll:damage.melee) | tag:epic_spell"`). `lib/expr.ts` could be
extended to parse it, and it would still be wrong: §2 chose picked-from-catalog
identity so that a rename cannot silently break a target and a typo cannot
silently match nothing. A parser hands both failure modes back.

---

## Advance Turn — a round tracker

**Trigger.** Scheduled: the pass after the Features screen redesign. Recorded now
because the notification work already reserved a slot for it.

**The button.** In the Roll Context Panel, which is the right home — it is the
surface that already persists across screens and is where per-roll state is
resolved. Pressing it:

1. Clears every effect lasting **1 turn**.
2. Decrements every longer effect by one turn — *1 minute* being 10 turns.
3. **One more thing, not yet recalled.** Left explicitly open rather than
   guessed; ask before building, because it may be the item that decides the data
   shape below.

**The blocker, and it is a data-model change first.** *Nothing stores a number of
turns.* Three separate free-text fields, and the type already admits it:

| field | what it holds |
|---|---|
| `EquippedItem.duration` | `"10 rounds"`, `"1 minute"` — commented *"NOT auto-counted — there's no round tracker"* |
| `ActiveEffect.note` | *"free-text duration reminder shown on the status chip"* |
| `Spell.duration` | `"1 minute"`, `"Concentration, up to 1 minute"` |

Checked against live data: the one active effect in the campaign is Haste on
Cornelius, and its `note` is `"Haste"` — the field is being used as a **label**,
not a duration. So there is nothing to migrate and nothing to decrement. `at` (a
wall-clock timestamp) is the only number on it, and wall-clock is not turns.

**So the shape is:** `ActiveEffect.turns?: number`, set at apply time — parsed
from the source's duration string, or authored outright, which is the cheaper and
more honest of the two. Everything else follows: the button decrements and
filters, and an effect with no `turns` is untracked rather than wrongly cleared.

**It already has somewhere to report.** `pendingOf` (lib/rollView.ts) names a
turn-tick slot in a comment; filling it means the toast's call-to-action and the
nav badge both surface "3 effects ticked, 1 expired" with no change to either
surface.

**Decide with it, do not discover later:** *concentration*. Haste is a
concentration spell, and a round tracker that silently keeps ticking an effect the
caster stopped concentrating on is a wrong number rather than a missing feature —
the failure mode this project keeps finding.

---

## Modifiers on another creature's roll

**Trigger.** Content whose rule lands on somebody else's dice. The Cloak of
Elvenkind is the canonical one and it is already in the catalog: *"Wisdom
(Perception) checks made to see you have disadvantage."*

**Why it does not work today.** `resolve()` answers "what modifies THIS
character's roll". The disadvantage above is imposed on a creature the app has no
row for, rolling dice the app never sees. The Stealth half of that same cloak is
expressible and the Perception half is not, which is a confusing place for an
author to land — the item reads like one rule.

**The honest options, and they are design decisions rather than implementations:**

1. **A note, which is what to do today.** `note` surfaces the sentence on the
   roll it is relevant to, and the DM applies it. Costs nothing, already works,
   and keeps the rule visible at the moment it matters.
2. **An "imposes" list on the character** — a queryable set of effects the DM's
   screen could read when rolling for a monster. Real, and it needs a DM-side
   roller to consume it, which does not exist.

Not built because option 1 is genuinely adequate for a four-player table where
the DM rolls in the open. It stops being adequate the moment the DM's own screen
rolls dice.

---

## Negation in selectors — `NOT tag:cursed`

**Trigger.** "Every fire weapon *except* that one", where the exception cannot
simply be untagged.

**Design.** A `!` prefix per selector, or a parallel `exclude?: string[]`.
Matching is easy — one more condition. **The audit is the hard part**: "can this
ever match" stops being a set-size check once a selector can be negated, and
match counts (`matchCount`) stop being countable without evaluating against every
candidate.

Rejected in §20 alongside `and`, and unlike `and` nothing has met its trigger.
Worth resisting: an exception is usually better expressed by fixing the tags.

---

## What "active" means for a carried item

**Trigger.** Either half of this pair, both owed:

- §19's `AmmoBonus` deletion, owed since slice 4 — nocked ammunition should be a
  graph contributor like anything else, but a nocked stack is *carried*, not
  equipped, so it is not in `activeSources`.
- A consumable's own `graph` applying when it is drunk. `EquippedItem.graph` says
  "while EQUIPPED", and a potion in a bag is not.

**The question is one decision, not two:** does "active" mean equipped, or does
it extend to a carried item at the moment it is used or nocked? Answer it once
and both fall out. Until then `consumeEffect` resolves only OTHER nodes targeting
the item, which is the useful half.

---

## Multi-type damage

**Trigger.** A spell dealing two damage types at once — Sacred Flame's radiant +
fire is the canonical one, and it is in the mockup's own catalog example.

**State.** `RollTotals.byType` has been plural and waiting since 5b, and riders
already fan out into it by `dmgType`. What is singular is the base roll:
`RollEntry.damage?: DamageRoll` is one block, and `Spell` models one
`dice`/`dmgType` pair — so the type cannot express it before the panel can.

**So it is a spell-model change first**, not a panel change: `Spell` needs a
damage *list*, with its `SpellForm` controls in the same change. `lineViews`
then loops instead of `if (d)`, and `rerollAt` already indexes by line so a
second damage line costs it nothing.

---

## Concealed shard-node graphs for players

**Trigger.** A concealed node whose mechanics should apply before the player is
told what they are.

**Why it is not a slice.** Making it work means sending the mechanics to the
player's client, which is what `shard_tree_secrets` exists to prevent — it has no
player policy, ever. The honest options are both design decisions, not
implementations: reveal the node, or accept that a concealed node is inert for
the player (which is what its `mods` and `features` already do).

---

## Draft / publish for spells and items

**Trigger.** Wanting to park an unfinished spell or item the way a feature draft
parks, rather than saving straight to the live row.

**State.** Only `feature_catalog` has a `draft` column (migration 0014); shards
have their own publish path. `SpellForm` and `CatalogForm` save directly to
`data`. A migration plus `useLocalDraft` plumbing per catalog.

Not needed while the graph saves with the form, which is why 6b did not build it.

---

## A chip for `roll:save.*` armed modifiers

**Trigger.** Arming something for a saving throw rather than an attack.

**State.** The armed queue is keyed by roll kind and already supports it; the
weapon and feature cards show a chip, and the Character screen does not. The
query is the same `armedMatches` call. It needs a **design decision about where
a chip goes in the hex grid**, not code.
