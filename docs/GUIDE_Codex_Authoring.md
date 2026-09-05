# Authoring the feature graph — a working guide

For the DM. `docs/GUIDE_Codex_Graph_Engine.md` is the spec and says *why*; this
says *how*, with recipes for the shapes real content keeps taking.

---

## The model, in one sentence

> **A node carries effects. An effect adds something to a roll, when its
> conditions hold.**

A **node** is anything that can be granted: a feature, a spell, an item, a shard
node. All four author identically — same block, same vocabulary — because "+2 to
your next attack" means the same thing whatever granted it.

### Which node to put it on

The kind decides WHEN the rule is live, and that is the only difference:

| put it on | live while | authored in |
|---|---|---|
| **feature** | always — it is the character's | Feature editor (`/dm/features`) |
| **spell** | that spell's own casts, and only while the spell is READY | Spell form → *Roll Contributions* |
| **item** | it is EQUIPPED | Item form → *Roll Contributions* |
| **shard node** | it is ATTUNED | Shard lattice → node → *Roll Contributions* |

> **A concealed shard node is DM-side only.** Its mechanics live in
> `shard_tree_secrets`, which no player can read, so its contributions never
> apply on their sheet — the same as its Effects and Features, and true even
> after you reveal it (a reveal sends the name and prose, not the mechanics).
> Unconceal the node when you want it to actually do something.

An **effect** answers five questions, and only the first three are required:

| | | |
|---|---|---|
| **op** | what kind of thing it does | `add`, `adv`, `crit`, `note`… |
| **label** | what it is called in the breakdown | `Condemning Strike` |
| **target** | which rolls it reaches | `roll:damage.melee` |
| `when` | is it legal right now? | `hp < hpMax / 2` |
| `ask` | did the thing happen? | `Hit with Sanctity` |

---

## The ops

**Contributions** — these change a number or a roll:

| op | does | example |
|---|---|---|
| `add` | adds to the roll. Dice allowed, and they stay unrolled so a crit can double them | `2d6`, `prof + wis`, `level / 2` |
| `adv` / `dis` | advantage / disadvantage. Never a number — the target list IS the statement | — |
| `crit` | lowers the crit threshold. Lowest across all applying nodes wins | `19` |
| `floor` | a MINIMUM on the finished total. Not a bonus — it changes nothing on a good roll. Highest floor wins, the mirror of `crit`. Checks and saves only | `strScore` |
| `note` | prose on the roll, no number. Can compute — see Inline compute | `DC {saveDc}, Wisdom save` |

**Spells also have a Saving throw field**, beside Damage. Two different abilities
meet here, so it is worth being exact:

| | whose | set where |
|---|---|---|
| **which save the target rolls** | the spell's — Fireball is DEX, Hold Person WIS | this field |
| **the DC they must beat** | the caster's — `8 + prof + their spellcasting ability` | the caster profile |

A spell never names WIS/CHA/INT, because that is the caster's class. It is why
the same spell is a harder save cast by a Warlock with CHA 20 than by a Wizard
with INT 16 — the DC moves, the target's save does not.

Leave the field at *no save* for a spell that allows none, and the roll panel
shows no DC at all. Otherwise it reads `DEX Save DC 15`, in the slot an attack
roll would fill.

**Damage flags** — these answer "what happens when damage hits *me*", so they
target a damage *type*, not a roll:

| op | does |
|---|---|
| `resist` / `vuln` / `immune` | halves / doubles / nullifies incoming damage of the matched kind. Target a tag naming the type |

**`immune` also covers CONDITIONS**, and it is the same statement: an `immune`
op targeting a tag. Mindless Rage is

```
effect   immune   → tag:frightened    when isRaging
effect   immune   → tag:charmed       when isRaging
```

and nothing else. The tag is matched against the effect's **name**, normalised on
both sides, so an effect called *Frightened* answers to `tag:frightened` with no
extra authoring. A condition you are immune to greys out in the Effects panel
with an **Immune** chip and stops counting, and the DM's Apply card refuses to
land it in the first place, saying why.

> **Suppressed, not deleted.** An immunity can be conditional, and a condition
> deleted while you were raging could not come back when the rage ended. The ✕ in
> the Effects panel is still the only thing that really removes one.
>
> A suppressed effect's **numbers** do still layer, because the sheet is computed
> below the graph. No SRD condition carries any, so this bites nothing today —
> but a homebrew condition with a `-2 AC` on it would grey out and keep the −2.

**Sheet ops** — these change the character *sheet*, not a roll. They take **no
target**, because there is nothing to match against: they apply to whoever
carries the node. They cannot be conditional either — a `when` on one is an
error, since the sheet is not evaluated per-roll.

| op | does | example |
|---|---|---|
| `boost` | moves a number on the sheet itself — an ability score, speed, darkvision. A racial +2 DEX is this: the score moves, so every save, skill and derived value made from it moves with it | `DEX` `+2` |
| `use ability` | lets the carrier use a different ability for **attack rolls** | `WIS` |

One stat is worth calling out because two entries in the list sound alike:
**Attack** is the to-hit bonus, and **Extra Attacks** is how many swings one
Attack action buys. Extra Attack grants `+1` of the second — everyone already has
one, so the grant is the EXTRA, and the Equipment screen's stat rail starts
showing *Attacks 2 / 2* counting down as you swing. Advance Turn resets it.

`boost` takes a **plain number, not a formula**. There is no roll to compute
against at sheet level, so `prof + wis` has nothing to read.

It also takes an optional **Up to a maximum of** — Primal Champion is "+4, to a
maximum of 25". The ceiling clamps the RESULT after every boost has summed, and
it never *lowers* a score that was already past it by some other route, because
"to a maximum of" limits the increase and not the character. Ability scores
only; a cap on Speed or AC is refused, because nothing clamps those.

**`use ability` is a MAY, not a swap.** "You may use Wisdom instead of Strength
or Dexterity" is a permission, so the attack uses the **best** score among
everything allowed — exactly as a finesse weapon already picks the better of STR
and DEX. Granting an ability the character is worse at therefore changes nothing,
which is why it needs no toggle. It moves **damage too**, because attack and
damage run off the same modifier.

It belongs on the **feature**, not the weapon. The property is the wielder's: a
fighter who picks the same blade off a corpse swings it with Strength. Take the
feature away and the attack goes back to STR on its own, with nothing stored to
clean up.

**`unarmored AC`** is the third sheet op, and the only one that answers a
question the others cannot: *"while you aren't wearing armor, your base Armor
Class equals 10 plus your Dexterity and Constitution modifiers"*.

| | |
|---|---|
| **Base** | the constant — 10 for Unarmored Defense, 13 for Draconic Resilience |
| **Plus (besides DEX)** | the optional second modifier: a Barbarian's CON, a Monk's WIS |

Dexterity is always included, because every printed version of the rule adds it.
It **replaces** what armour would have given rather than stacking with it, so it
competes and the better of the two wins — and it switches itself off the moment
body armour goes on. That condition needs no `when`: the sheet layer can see the
slot, where an expression could not.

> **A shield still helps**, and still adds on top. Shields share the armour slot
> with body armour, so an item marked **Shield** in the item form adds its number
> instead of replacing yours, and leaves an unarmored rule standing.

> **AC is now derived.** `sheet.ac` is a DM **override** of the base — set it and
> the armour is ignored, clear it and what the character is wearing decides.
> Magic bonuses apply either way. The Stat Panel shows the working:
> `AC 17 = 10 [Unarmored Defense] + 2 DEX + 3 CON + 2 Shield`.

> **Boost vs an Effect.** Use `boost` for what a thing *is* and cannot be
> separated from — an elf's Dexterity. Use an Effect (the Effects tab) for
> something applied to you or carried by an object, which can **end**: Bless,
> Poisoned, a gem's enchantment.

**Activations** — these run when the player presses Use, and they write state:

| op | does |
|---|---|
| `setVar` | stores a value into one of this node's variables |
| `addVar` | adds a signed amount to one |
| `addUses` | moves a **use counter** — this feature's, or **another feature's** |

`addUses` is the only activation that reaches a second node, because that is what
the rules keep asking for: *"regain all expended uses of Rage"* is a positive
amount aimed at Rage, and *"expend a use of your Rage"* is a negative one. Target
a **feature**, or leave the target empty for this one's own counter. It clamps to
the target's own max, so naming the max itself is how you say **all of them**.

> **A cost you cannot pay refuses the whole press.** A negative `addUses` bigger
> than what the target has left cancels the activation outright — every outcome,
> not just that one. "Expend a Rage to restore this" is one transaction, and a
> player with no Rages left must not get the benefit for free.

---

## Targeting

Three namespaces, and that is the whole language. A target list is an **OR** —
matching any one is enough.

**A class of roll** — `roll:<kind>[.<sub>]`. The sub *narrows*; leaving it off
matches every roll of that kind.

```
roll:attack          every attack roll
roll:attack.melee    melee weapon attacks only
roll:damage          every damage roll — weapon AND spell
roll:damage.melee    melee weapon damage only
roll:damage.spell    spell damage only
roll:save.dex        DEX saving throws
roll:check           every ability and skill check
roll:feature         a feature's own roll, and using an item
```

> **Weapon damage but not spells** is two selectors:
> `roll:damage.melee` + `roll:damage.ranged`. There is no "weapon" roll kind,
> and the list is an OR, so two entries say it exactly.

### or / and

With two or more selectors, a toggle beside the **Target** heading decides how
they combine.

**or** (the default) — any one is enough. `weapon:sword` or `weapon:axe`.

**and** — every one must hold of the *same roll*. This is the one that catches
people, so here is the case that forces it:

> Tag a weapon `fire`, then write `add +1 fire → tag:fire`. You get **+1 to hit
> AND +1 damage**, because a weapon carries its tags into both rolls and each is
> resolved separately. `tag:fire` says *which weapon*, never *which roll*.
>
> `tag:fire` **and** `roll:damage` says both. That is the whole feature.

An `and` list can be written so it never matches — a roll has one kind and one
subject, so `roll:attack` and `roll:damage` cannot both hold, nor can two
weapons. The audit calls that an error rather than letting it silently do
nothing.

**What you cannot write is a mix**: `(fire AND melee damage) OR epic spell` needs
nesting, and a list has one mode. Write it as two effects with the same label and
value — correct as long as the two branches cannot BOTH describe the same thing,
because then it applies twice. If you hit that, see
`GUIDE_Codex_Deferred.md`; the design is worked out and waiting.

**A tag** — `tag:fire`. Free text, normalised on save (so `Fire`, `fire` and
`FIRE` are one tag), matched across every catalog. Use it when the rule is about
a *kind* of thing you will keep adding to: tag three weapons `fire` and one
feature reaches all three, plus the fourth you add next month.

Every node kind carries tags — feature, spell, item and shard node all have a
**Targeting tags** field, with autocomplete over what is already in use
elsewhere. Pick from that list rather than retyping; a tag that fragments matches
nothing and looks like it should.

**A specific thing** — picked from the catalog, never typed. Stored as an id, so
renaming the target never breaks it.

**No target at all** means *this node's own roll* — a feature's `roll`, or the
spell/item it is authored on.

---

## `when` vs `ask` — the one that catches people

They are **orthogonal** and they answer different questions:

- **`when`** is a condition the app can check. It gates **existence**.
- **`ask`** is a question only a human can answer. It gates **resolution**.

| `when` | `ask` | what the player sees |
|---|---|---|
| — | — | applies, silently. Named in the breakdown |
| true | — | applies, named as a resolved contribution |
| false | — | does not surface at all |
| — | set | a toggle in the roll panel, showing its formula |
| true | set | a toggle |
| false | set | **nothing** — no toggle either |

That last row is the trap: a toggle whose `when` is false does not appear, on
purpose. A choice the player could not legally take should not be offered. The
editor warns you when a node has both.

**Why an `ask` shows a formula and not a number:** seeing `1d6 [6]` before you
decide whether the creature was judged puts a thumb on the decision. Answering
rolls it — and once rolled it locks, so reopening the panel is never a free
reroll.

**Several offers from one node become a pick-one.** Two or more `once` effects
carrying an `ask` are one decision — Brutal Strike's blows — and the roll panel
renders them as options, not switches, because the feature is *made* of the
choice.

> **Letting the player take two.** The feature's **Of its N offers, the player
> may take** field widens it. A formula, because the count is usually a level
> thing: Improved Brutal Strike (Enhanced) is `level >= 17 ? 2 : 1` and nothing
> else. It lives on the feature rather than on each effect because it is a
> property of the group — four copies of one number would eventually disagree.
> Taking fewer than the limit is a decision, so the roll stops asking after the
> first pick either way.

**Effects sharing one `ask` become one checkbox.** That is how "it hit, so deal
the damage AND reveal the DC" is one decision instead of two. Type the same
sentence in both — the editor now offers the ones already on the node in a
dropdown, so you pick rather than retype.

---

## Variables

State a node carries. Two axes:

**Stored or derived**

- **stored** — a value saved on the character. Needs a type (`num`/`bool`) and
  usually an initial. Written by `setVar`/`addVar`, or by the player's toggle.
- **derived** — recomputed from a formula on every read. Never stored, so it can
  never go stale.

**Player or DM**

- **player** — the player can change it (a toggle on their Features screen).
- **DM-only** — only you can, from the console's *Feature State* card. The
  database enforces this; a player client's attempt is reverted.

What a formula can read: `level`, `prof`, `str`…`cha` (modifiers),
`strScore`…`chaScore` (the raw scores — Indomitable Might wants 20, not +5),
`hp`, `hpMax`, `saveDc`, `attacksThisTurn`, plus every variable in scope.
Contribution formulas can also read `cast` (the level a spell was cast at),
plus two that come from the Foundry bridge: `targetAc` (the targeted creature's
Armour Class, **0 when nothing is targeted** — no creature has AC 0, so the
absence is readable) and `hit` (did the attack land).

### Writing an on-hit effect

`when: 'hit'` is how "on a hit, deal an extra…" is said. Three states, not two:

| | |
|---|---|
| **hit** | The contribution applies, with no question asked. |
| **miss** | It does not exist. |
| **no target** | It arrives as the question *"Did the attack hit?"* — exactly what the player answered before the bridge existed. |

That third row is the one that matters. With Foundry closed, or nothing
targeted, a `hit`-gated effect is never silently dropped; the rest of the
condition still refuses it (`hit && isRaging` on a character who is not raging
does not surface at all), and any authored `ask` of your own wins over the
generated question.

**A `value` is different.** `hit ? 2d8 : 0` in a value has no question to become,
so with no target it fails loudly as *"Contribution did not resolve"* rather than
quietly computing the miss branch. Gate on `when` and keep the value plain.

`targetAc` never reaches the player: screens show HIT or MISS, never the number.

A variable declared on a **class, race or background** is in scope too, on any
character carrying it — that is how a feature reads its own class's progression.
`rageDamage` and `rages` live on the Barbarian, and Frenzy's damage is literally
`1d6 * rageDamage`.

```
saveDc          derived    8 + prof + wis
isRaging        stored     bool, initial false, player
mercy           stored     num, DM-only
canSwitchMercy  derived    mercy - condemnation >= 5
rageUses        derived    uses of <Rage>          (picked, not typed)
```

Arithmetic is integer — `level / 2` at level 7 is 3, matching 5e's rounding.

---

## Inline compute

`{...}` inside a **note's text** computes and renders the value. The player sees
the number, never the expression.

```
DC {8 + prof + wis}, Wisdom save or be frightened.
→  DC 15, Wisdom save or be frightened.

Deals {2d6 + 1}.            →  Deals 2d6 + 1.     (display never rolls)
held{upgraded ? " and restrained." : "."}
```

A bare boolean is refused — `{isRaging}` would read "true". Route it through a
ternary to a phrase, as above.

This is why a note can carry an `ask`: a DC that only matters if the hit landed
should be revealed when you confirm it landed.

---

## When does an effect apply?

Before reaching for `once`, get the **target** right — it decides scope, and the
difference is large:

| target | applies to |
|---|---|
| `roll:damage` | **every** damage roll you make, weapon and spell alike |
| `roll:damage.melee` | every melee weapon damage roll |
| **(empty)** | **only this node's own roll** — for a spell, its own casts |

> **Only READY spells contribute.** A cantrip is always ready, and a known-style
> caster (a Warlock's pact magic, or any caster who does not prepare) is ready
> for everything they own. A prepared-style caster's levelled spell contributes
> only while prepared — an unprepared spell is not something you are carrying,
> and its variables leave scope with it.
>
> Even so, `add 2d6 → roll:damage` on a *prepared* spell adds 2d6 to every
> weapon swing. If you meant "this spell hits harder", leave the target empty.

---

## `once` — your next attack

Tick **Arms once** on a contribution and it stops applying continuously.
*Arming* it puts it in a queue; it lands on the next matching roll and waits
there until you tap **Consume** on the roll panel.

What arms it depends on the node:

| node | armed by |
|---|---|
| feature | pressing **Use** |
| spell | **casting** it |

For a feature, Use shows a confirm sheet where an `ask` can be declined. Casting
has no second step — the slot is already spent — so a cast accepts every
outcome. The cast is the deliberate act.

- It shows as a gold chip on the target's card, so a pending bonus is never
  invisible.
- It does **not** burn on a miss — only you know whether the attack resolved.
- Re-arming refreshes rather than stacking.
- Both rests clear the queue.
- It needs a `roll:` target (`roll:attack`), because the queue is keyed by roll
  kind. Leave the target empty to arm this node's own roll.

---

## Recipes

**A flat bonus while a condition holds** — Bloodied Fury: below half HP, +1d4
damage.

```
op      add
value   1d4
target  roll:damage.melee
when    hp < hpMax / 2
```

**A rider the player judges** — Condemning Strike: on a hit against a cursed
creature, +2d6 radiant and a save.

```
effect 1   add    2d6   radiant   roll:damage.melee   ask "Hit with Sanctity"
effect 2   note   "DC {saveDc}, Wisdom save or be frightened."
                                  roll:damage.melee   ask "Hit with Sanctity"
variable   saveDc   derived   8 + prof + wis
```

Same `ask` on both → **one** checkbox that reveals the DC and applies the dice.

**Scaling with level** — use the By level table rather than a formula when the
progression is a 5e-style table. Filling slots 1, 5 and 11 means "3 from level 11
up", not "nothing at 12".

**A toggle the player flips** — a cloak's hood.

```
variable   hoodUp   stored, bool, initial false, player
effect     adv   roll:check.stealth   when hoodUp
```

The player toggles it on their Features screen; every matching roll picks it up
while it is on. A `long` reset returns it to `false` on a rest.

**Give a resource back** — Persistent Rage: on a long-rest charge of its own,
refill Rage completely.

```
uses       1
recharge   long
effect     addUses   rages   →  <Rage>          (picked from the catalog)
```

`rages` is Rage's own max, and the clamp turns "add six" into "fill it". The same
op with `-1` is what *spends* a resource, and the two together on one node are a
trade: the cost is checked first, so the press is refused rather than half-done.

**A stance that COSTS something to enter** — Rage. The same toggle, plus the two
fields that make entering it cost one:

```
uses       rages                   (a formula — the class's own Rages column)
recharge   long
variable   isRaging   stored, bool, initial false, player, resets on short
effect     setVar   isRaging = true   label "Enter Rage"
effect     add      rageDamage        roll:damage.melee    when isRaging
effect     resist   tag:bludgeoning                        when isRaging
```

One hexagon, three states. Pressing it while OFF runs the activation — which
spends the use and sets the variable in a single write — and pressing it while
ON releases the stance for free. **Releasing never costs**, so ending a Rage
does not eat a second one.

> The `setVar` is what makes the press own the switch: a variable an activation
> writes loses its hand switch in the popup, so there is exactly one door and it
> is the one with the cost on it. Author the uses without it and the editor warns
> that the stance is free.

**A total that cannot go below something** — Indomitable Might: "if your total
for a Strength check is less than your Strength score, use the score instead".

```
op       floor
minimum  strScore
target   roll:check.str · roll:check.athletics · roll:save.str
```

No `add` can say this: it is worth nothing on a good roll and everything on a bad
one. The breakdown keeps what was rolled and names what replaced it, so a player
seeing 20 from a natural 2 can tell why.

**Once per rest, spend a use** — pair `uses` + `recharge` on the node with an
`ask` on the effect, so pressing Use spends the charge and the toggle decides
whether it applied.

**A use count that scales** — **Max uses is a formula**, not just a number. "The
number of Rages shown for your level" is `rages`, read off the class; an inline
table (`[0,2,2,3,3,3,4][level]`) works with nothing to declare. A plain number
still means exactly what it always did.

> Leave the count alone once it is authored: the character's *current* uses live
> on their sheet and the max is recomputed on every read, so levelling up raises
> the ceiling without touching what they have spent. A granted copy starts full.

**Back in part, not in full** — Rage gives back *one* use on a short rest and
*all* of them on a long one. Set **Resets on** to `Long rest`, and the field that
appears under it — *…and on a short rest, give back* — takes the partial amount
(a number or a formula). No single value of Resets-on can say this, which is why
it is its own field; a full short-rest refill hides it, because a full refill is
never improved by a partial one.

**Cast a spell, then hit harder** — the armed shape.

```
op      add
value   2d6      radiant
target  roll:damage.melee
once    ✓  Arms once
```

Casting arms it; a gold chip appears on the weapon card; your next melee hit
gets the 2d6; you tap Consume once you know it landed. Without `once` this same
effect would add 2d6 to every melee swing for as long as you know the spell.

**Boost one specific thing** — target the thing itself, picked from the catalog.

```
op add   value 2   target  <Sacred Flame>     (picked, stored as an id)
```

This also **chains**: an effect targeting a node boosts that node's own
contributions, so a shard node can amplify a feature that amplifies a weapon.

**Damage resistance** — `resist` targeting `tag:fire`.

---

## "While the hood is up" — a condition only the player knows

Some conditions are not computable. *While your hood is up*, *while you are
standing*, *while the torch is lit* — the app cannot know, and `when` takes a
formula over character state, so there is nothing to type.

The shape that expresses it is a **stored bool the player flips**. Press
**player toggle** on the `when` row and the editor declares it for you: a stored
`bool`, player scope, named from the effect's label, with `when` already pointing
at it. It then appears in the variables block like any other, so nothing is
hidden — rename it, relabel it, set its initial value.

The player finds the switch under **State**, on the feature's detail panel. For a
toggle declared on an item or a shard node, it is under **Gear & Shard State** on
the Features screen, grouped by what it came from.

**Elven Concealment, end to end.** On the cloak (or on the feature the cloak
grants):

| | |
|---|---|
| effect | `adv`, label *Hood up*, target `roll:check.stealth` |
| `when` | press **player toggle** → declares `hoodUp` |

That is the whole thing. The player flips *Hood up* and Stealth checks roll with
advantage until they flip it back.

**What this cannot do**, and it is worth knowing before you try: the other half
of that cloak — *Perception checks made to see you have disadvantage* — is a
modifier on **someone else's roll**. The engine resolves this character's rolls
and nothing else. Write it as a `note` so it surfaces on the roll and the DM
applies it; see `GUIDE_Codex_Deferred.md`.

Use `ask` instead when the condition is judged **per roll** rather than held —
"did at least one of them fail the save?" is not a stance you leave switched on.

---

## Spell attacks

A spell resolves one of two ways, and the editor asks separately:

- **Saving throw** — the target rolls, against the caster's DC.
- **Attack roll** — *Spell attack: ranged / melee*. Cast then throws a d20
  before the damage, at the caster's spell attack bonus from their profile
  (prof + their spellcasting ability). Fire Bolt is ranged, Shocking Grasp
  melee.

The spell never names the bonus for the same reason it never names the save
ability: the class decides it, so the same spell is a better attack from a
caster with a better score.

Nothing stops you setting both — 5e has a handful that do both, and refusing
them would be the app inventing a rule.

What an attack spell gains:

- **A crit doubles the damage dice**, never the modifier — the spell's own and
  any contribution alike. A cantrip doubles what it has *grown* to, so Fire Bolt
  at level 11 crits for 6d10.
- **`roll:attack.spell`** matches every spell attack, and `roll:attack.melee` /
  `roll:attack.ranged` match by which kind it is — the same vocabulary a weapon
  swing uses.
- **Hit and miss**, when a token is targeted in Foundry. Damage resolves after
  the d20, so `when: 'hit'` works on a spell exactly as it does on a weapon
  (see *Writing an on-hit effect*).

A spell with an attack and no damage is fine — the d20 still rolls, and the
entry carries it.

## Weapon mastery

A weapon has ONE mastery property; a character may use it only while that kind of
weapon is one they have trained. Two facts, kept apart everywhere — the weapon
card says `Vex` when it is yours and `Vex · not one of yours` when it is not,
because naming it without the qualifier tells the player they have something they
do not.

**Nothing needed migrating.** All 454 imported weapons already list theirs in the
free-text `properties` array (a Greataxe reads `["Cleave", "Heavy",
"Two-Handed"]`), and `masteryOf` falls back to it — the same pattern `ranged` and
`twoHanded` use. The item form now has a **Mastery** select for weapons you author
yourself, which is the half the UI could never write.

**Who may use which** is on the character, in the console's Proficiencies card,
and the cap is `weaponMastery` — a derived variable on the class, so it follows a
level-up with nothing to remember. Zero means no Weapon Mastery feature and the
section stays off that character's card entirely.

**What the app does with it.** On a swing with a mastery that is yours, the rule
rides on the roll as a note. That is deliberately all it does: of the eight, seven
are things only the player can resolve — Graze wants to know you *missed*, Cleave
wants a second creature, Sap and Slow and Push modify the TARGET rather than you
(see `GUIDE_Codex_Deferred.md`). Vex is the one the engine could arm and does not:
"advantage on your next attack against *that same creature*" needs a target
identity nothing here tracks, so arming it would hand out advantage against
whoever you swung at next. A wrong number is worse than a sentence.

## Colouring prose

Any prose field takes `[text]{colour}`:

```
Deals an extra [2d6 radiant]{radiant} damage.
The [Castellan]{--cyan-hot} guard turns away.
```

Prefer a **name** — `radiant`, `fire`, `cold`, `necrotic`, `lightning`, and the
rest of the damage types, plus `red`, `gold`, `amber`, `cyan`, `violet`, `green`.
A name follows the palette, and a damage type named here is the same colour the
Roll Context Panel tints that damage with, because both read `lib/palette.ts`.

A design token (`{--cyan-hot}`) and a literal hex (`{#e2b021}`) also work, in
that order of preference. A hex is frozen — it will not follow a theme change.

Anything unrecognised renders **literally**, so `[x]{plaid}` shows as
`[x]{plaid}` rather than silently losing its colour. That is deliberate: a typo
you can see is worth more than one you cannot.

### Where it renders

Everywhere the field is shown, which was **not** true until recently and is the
one thing to know if a tag ever shows up as raw text.

The same rule covers `**bold**`, `*italics*` and `[text](url)`: the field has to
be routed through `renderInline()` or `<Prose>` at the point it is drawn. A
weapon's description used to colour correctly in the hover tooltip and print
`[Mercy]{radiant}` as literal characters in the Equipment detail panel below it —
one authored string, two render paths, only one upgraded. Item and weapon detail,
the Inventory item popup, the shop header and the path-choice cards were all
fixed together, and `src/lib/proseFields.test.ts` now fails if a field that
*offers* the shortcuts is printed raw anywhere.

Two fields are deliberately plain, because nothing authors them as markdown:

- **op field help** in the effect editor — that copy is hardcoded in `opSchema.ts`,
  not authored
- **shard perk blurbs** — authored in a single-line input that never offered the
  shortcuts. Colour one and you will see the brackets.

---

## Traps worth knowing

| | |
|---|---|
| **A `when` that is false with an `ask` shows nothing** | Not a bug — see the table above. |
| **`ask` is a grouping key** | Two effects group only if the sentence matches. Pick from the dropdown rather than retyping. |
| **An unlabelled effect** | Blocked. An unattributed number in a breakdown is the thing the roll panel exists to prevent. |
| **A dangling target** | An error. A target matching nothing *yet* is fine; one that can never match is a typo. |
| **A variable nothing reads** | A warning. Declaring before wiring is a legitimate order of work. |
| **Two contributions of different kinds under one `ask`** | A warning — a toggle carries one op, so only the first applies. Give them separate asks. |
| **Damage type** | Set it on any `add` that targets a damage roll, or it lands in the untyped bucket and loses its colour in the split. |
| **A `when` or a target on a sheet op** | An error. `boost` and `use ability` change the sheet, which has no roll to match or to evaluate against. |
| **A formula in `boost`** | An error — sheet level has nothing to compute from. Plain number only, negative allowed. |
| **`use ability` looks like it did nothing** | It is best-of. Granting WIS to a character whose STR is already higher correctly changes no number. |

The audit rail tells you all of these while you author, and an **error blocks
save** — on features, and now on spells.
