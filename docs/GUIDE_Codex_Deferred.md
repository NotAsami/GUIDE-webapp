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

**Not to be confused with catalog-query negation, which SHIPPED.**
`tag:martial !relic` works today in loot pool rows, starting-kit pools and the
DM search boxes — `lib/catalogSearch.ts`. That is a different subsystem: it
picks ITEMS OUT OF THE CATALOG at author or roll time, against a finite list
that can simply be counted. This entry is about `target:` selectors on a graph
effect, which match against a roll at resolve time and are where the audit
problem above actually bites. Shipping one did not ship the other.

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

---

## Targeting a class or a race — `target: ['class:arbiter']`

**Trigger.** Authoring an effect that must reach *every member of a class or
race* rather than one named feature. "Arbiters take no damage from their own
judgment", "elves are immune to magical sleep" — a rule about the group, not
about a thing the group happens to carry.

**State.** A class and a race reach a character as a CARRIER FEATURE
(`lib/classes.ts assignClass`, `lib/races.ts assignRace`): a per-character
snapshot with ids `cls:<id>` / `race:<id>` and no `feature_catalog` row behind
it. So the carrier is targetable only by accident — `feature:cls-arbiter` is not
a gid anything mints, and `useCatalogNodes` never emits one, which means a
`class:` selector would read as a dangling reference and the audit would be
right to say so.

Today the workaround is honest and usually enough: target one of the features
the class actually grants, or give every such feature a shared tag
(`tag:arbiter`) and target that. Tags already reach across catalogs, and the
class/race editors both have a tags block — a carrier passes its own `tags`
down, so tagging the class tags the carrier.

**What it would cost.** A `class:`/`race:` gid kind in `lib/graph.ts` `gid()`
and `sourceGid()`, both catalogs emitted by `lib/useCatalogNodes.ts` so the
dangling-target audit can see them, and `activeSources` recognising a carrier as
that kind rather than as a plain feature. The engine change is small; the reason
it is not built is that no authored content has needed it — every case so far
has been a rule about a specific feature, which the existing selectors already
say better.

**Do NOT** solve this by making the carrier a real `feature_catalog` row. That
would put a row in the features library that the DM did not author and must not
edit, and a grant path could copy it onto a character who has neither the class
nor the race.

---

## A richer icon set — game-icons.net

**DONE.** Adopted after all: 4180 glyphs live in `public/icons/`, rendered
through `src/components/Icon.tsx` as a CSS mask so they inherit `currentColor`
exactly as a Font Awesome glyph does, and chosen through the shared search-first
`IconPicker`. Font Awesome values keep working unprefixed, so no data migration
was needed — an icon is game-icons only if it carries the `gi:` prefix.

Attribution (CC BY 3.0) is in `docs/CREDITS.md`, and the picker names the
contributor of the selected glyph. See that file before touching
`public/icons/`: the per-author folders are the only record of who made what.

**What is still deferred:** expanding the Font Awesome side of the palette
(`ICON_GROUPS` in `src/lib/icons.ts` is 328 hand-picked names). *Trigger:*
reaching for a UI glyph — a control, a state, a marker — that is not in the
list. game-icons covers the fantasy vocabulary; Font Awesome covers the
interface, and only the latter is thin now.

---

## ~~A player-facing looting menu~~ — BUILT

Kept here, struck through, because the entry's own cost estimate was wrong in a
way worth remembering.

It shipped as: DM rolls a table → the result is parked in `loot_open` **closed**
→ DM assigns each line to a character (a real grant, same `grantMany` path as
Grant Item) → **Push To Party** flips `is_open` and the party's takeover appears
→ Close dismisses it for everyone. `src/components/LootRollOverlay.tsx` (DM),
`src/components/LootTakeover.tsx` (player), migration 0020.

**What this entry got wrong.** It called contention "the real work":

> Two players opening the same chest must not both take the last torch. That is
> the real work — a claim needs to be atomic, which points at a SECURITY DEFINER
> function like `cast_party_effect`, not a client-side write.

That problem never had to be solved, because the design removed it. **The DM
assigns; players only watch.** One writer means two players cannot race for the
last torch — there is no claim call, no atomic anything, and the player side
needs a SELECT policy and nothing else. The estimate assumed players would take
items because a chest at a table works that way, and never questioned it.

**What it got right**, and what did turn out to be the real work: the roll needs
somewhere to be parked that is not `loot_catalog`. That table has a `draft`
column whose safety rests on having no player policy (0014/0019), so exposing an
open roll from it would leak every unpublished draft. Hence a separate table,
with the container chrome and every line's item data SNAPSHOTTED onto it —
players cannot read `item_catalog` either.

---

## Generating shop stock

**Not built, and unlike most entries here it is not designed either — the
shapes below are the fork, not a decision.**

Shops today carry a hand-picked `stock: ShopStockLine[]`. There is no generator
at all: no "stock this shop from a query", no "roll this shop's inventory".

> "Same for the shop-generator, which is still not implemented."

Now cheaper than it was, because the query grammar it needs already exists and
is proven: `tag:potion !rare` parses, resolves and is audited today
(`lib/catalogSearch.ts`, `lib/loot.ts` `poolItems`).

### The constraint that decides the design

**A query can never resolve on the player's client.** `ShopStockLine.item` is a
SNAPSHOT of the catalog row, because `item_catalog` is DM-only RLS (0004) and
the player client never reads it — the snapshot is the only reason the stock
grid can render a name and icon at all. So any generator must resolve DM-side
and write real stock lines. That is not a limitation in practice (the DM is the
one who opens a shop), but it rules out "resolve the query when the player
looks", which is the obvious first instinct.

### Two shapes, for two different needs

| | what it is for |
|---|---|
| **query lines** | staples that are always in stock — `tag:ammo`, `tag:potion !rare`. Resolved when the DM opens or restocks. |
| **table-rolled** | stock that varies per visit. Point a shop at a loot table and roll it: pool rows, chances and ranges all come along free. |

They are not alternatives so much as answers to different questions, which is
why "both" is a real option and not a hedge.

### What each still has to settle

- **Price.** Stock lines carry an editable `price` seeded from the item's
  `value`; a loot table carries no prices at all. Table-rolled stock therefore
  has to derive price from `value` — and `value` is explicitly optional, meaning
  *priceless/unlisted*. An item with no value appearing in a shop needs a rule:
  skip it, price it at zero, or block the roll.
- **`item_id` is the line's identity.** `shop_buy` (0009) finds a line by
  `item_id`, not by array index. Two generated lines that resolve to the same
  item would collide — they must merge into one line, or generation must
  de-duplicate.
- **Restock semantics.** Buying decrements `data.stock[i].qty` permanently and
  there is no separate "opening" row, so re-firing a shop resumes where it left
  off. A generator has to say whether re-resolving REPLACES the stock (losing
  what was bought) or tops it up.

**Do NOT** resolve a query into the stock array on every open. That would
silently restock a shop the party had just cleared out, and the bug would read
as "the shopkeeper is cheating" rather than as a caching mistake.
