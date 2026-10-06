# Worked example — Brutal Strike

The hardest feature in the campaign, authored end to end. It is the reference
example because it uses nearly every mechanism at once: an armed contribution, a
cancelled advantage, a pick-one of prose outcomes, a level-gated option list, a
value that changes shape at level 17, and a gate over a variable **another
feature** declares.

Live row: `feature_catalog` id `srd-2024_barbarian_brutal-strike` (published,
`modified: true` — it was SRD-imported and then hand-authored). Engine tests for
this exact shape: `src/lib/graph.test.ts` ("Brutal Strike, end to end").

---

## 1 · The rule

**Brutal Strike (Barbarian 9).** If you use Reckless Attack, you can forgo any
Advantage on one Strength-based attack roll of your choice on your turn. The
chosen attack roll must not have Disadvantage. If it hits, the target takes an
extra 1d10 damage of the weapon's type, and you cause one Brutal Strike effect of
your choice:

- **Forceful Blow** — the target is pushed 15 feet straight away from you; you may
  then move up to half your Speed toward it without provoking Opportunity Attacks.
- **Hamstring Blow** — the target's Speed drops by 15 feet until the start of your
  next turn; only the most recent one applies.

**Improved Brutal Strike (13)** adds two more options: **Staggering Blow**
(Disadvantage on its next save, no Opportunity Attacks until your next turn) and
**Sundering Blow** (the next attack roll against it by another creature gains +5).

**Improved Brutal Strike (Enhanced) (17)** raises the die to 2d10 and lets you
cause **two** different effects per use.

---

## 2 · What that means for the engine

| The rule says | The system says |
| --- | --- |
| "If you use Reckless Attack" | a `when` gate over `recklessAttack`, a variable **Reckless Attack** declares |
| "on one attack roll of your choice on your turn" | `once: true` — an armed modifier that waits for the next matching roll, not a passive that rides every one |
| "forgo any Advantage" | an armed `dis` on `roll:attack.str`; advantage and disadvantage cancel, so this removes Reckless's `adv` rather than needing a "cancel" op |
| "extra 1d10 damage" | an armed `add` on `roll:damage.melee` |
| "one effect of your choice" | two-to-four armed `note` effects, each carrying its sentence as its `ask` — the roll panel renders several asked arms from one source as **one pick-one** |
| "…increases to 2d10" / "two different effects" | one formula each: `value: has_improved_brutal_strike_enhanced ? 2d10 : 1d10` and `picks: has_improved_brutal_strike_enhanced ? 2 : 1` |
| "the following effects are now among your options" | the extra blows are gated `&& has_improved_brutal_strike` and live on **Brutal Strike**, not on the level-13 feature |
| "one attack roll … on your turn" | `uses: { max: 1 }` + `recharge: 'turn'` |

---

## 3 · The authored row

```jsonc
{
  "id": "srd-2024_barbarian_brutal-strike",
  "name": "Brutal Strike",
  "icon": "gi:lorc/stone-spear",
  "color": "#e6827a",
  "category": "class",
  "source": "srd",
  "prerequisite": "Level 9+, Reckless Attack Feature",
  "folder": "SRD/Barbarian",
  "origin": ["Barbarian", "Features", "Reckless Attack Addons", "Brutal Strike"],
  "tags": ["class", "barbarian", "brutal_strike", "level:9"],

  "activation": "free",
  "uses": { "max": 1 },
  "recharge": "turn",
  "picks": "has_improved_brutal_strike_enhanced ? 2 : 1",
  "vars": [],

  "light_description": "If you use *[]{icon gi:delapouite/caveman}Reckless Attack*, you can forgo any **[]{icon fa-angles-up} Advantage** on one *[]{icon gi:lorc/strong}Strength*-based *attack roll* of your choice on your turn.",
  "deep_description": "The chosen attack roll mustn't have **[]{icon fa-angles-down} Disadvantage**. If the chosen attack roll *hits*, the target takes an extra **{has_improved_brutal_strike_enhanced ? 2d10 : 1d10} damage** of the same type dealt by the weapon or **Unarmed Strike**, and you can cause one *Brutal Strike* effect of your choice. …",

  "graph": [
    {
      "id": "e4vz7fx", "op": "dis", "once": true,
      "label": "Remove Advantage",
      "when": "recklessAttack && attacksThisTurn == 0",
      "target": ["roll:attack.str"]
    },
    {
      "id": "e3gjie1", "op": "add", "once": true,
      "label": "Add {has_improved_brutal_strike_enhanced ? 2d10 : 1d10} to Damage Roll",
      "value": "has_improved_brutal_strike_enhanced ? 2d10 : 1d10",
      "when": "recklessAttack && attacksThisTurn == 0",
      "target": ["roll:damage.melee"]
    },
    {
      "id": "eknmj3t", "op": "note", "once": true,
      "label": "Forceful Blow",
      "ask": "Forceful Blow: The target is pushed 15 feet straight away from you. You can then move up to half your Speed straight toward the target without provoking Opportunity Attacks.",
      "text": "*Forceful Blow:* The target is pushed *15 feet* straight away from you. You can then move up to *half* your **Speed** straight toward the target without provoking *Opportunity Attacks*.",
      "when": "recklessAttack && attacksThisTurn == 0",
      "target": ["roll:damage.melee"]
    },
    {
      "id": "egq0bdb", "op": "note", "once": true,
      "label": "Hamstring Blow",
      "ask": "Hamstring Blow: The target's Speed is reduced by 15 feet until the start of your next turn. A target can be affected by only one Hamstring Blow at a time the most recent one.",
      "text": "*Hamstring Blow:* The target's **Speed** is reduced by *15 feet* until the start of your **next** turn. …",
      "when": "recklessAttack && attacksThisTurn == 0",
      "target": ["roll:damage.melee"]
    },
    {
      "id": "bs_staggering", "op": "note", "once": true,
      "label": "Staggering Blow",
      "ask": "Staggering Blow: The target has Disadvantage on the next saving throw it makes, and it cannot make Opportunity Attacks until the start of your next turn.",
      "text": "**Staggering Blow.** The target has Disadvantage on the next saving throw it makes, and it can't make Opportunity Attacks until the start of your next turn.",
      "when": "recklessAttack && attacksThisTurn == 0 && has_improved_brutal_strike",
      "target": ["roll:damage.melee"]
    },
    {
      "id": "bs_sundering", "op": "note", "once": true,
      "label": "Sundering Blow",
      "ask": "Sundering Blow: Before the start of your next turn, the next attack roll made by another creature against the target gains a +5 bonus.",
      "text": "**Sundering Blow.** Before the start of your next turn, the next attack roll made by another creature against the target gains a **+5** bonus to the roll. An attack roll can gain only one Sundering Blow bonus.",
      "when": "recklessAttack && attacksThisTurn == 0 && has_improved_brutal_strike",
      "target": ["roll:damage.melee"]
    }
  ]
}
```

### Why each field is what it is

- **`activation: 'free'` + `uses.max: 1` + `recharge: 'turn'`** — pressing Use costs
  nothing but the once-per-turn counter, which the turn tick restores.
- **`once: true` on every effect** — Brutal Strike is a decision made *before* a
  specific swing. Without `once` the 1d10 would ride every melee damage roll for
  the rest of the fight.
- **`when` repeated on all six, not written once** — a gate lives on the effect.
  `attacksThisTurn == 0` is the engine's spelling of "on your first attack roll"
  (whitelisted in `VAR_IDENTS`, maintained by the turn tracker), and
  `recklessAttack` is declared on **Reckless Attack** — a variable declared on
  another node is legal and the audit knows it via the catalog's type index.
- **`ask` on the blows only** — the `dis` and the `add` are *taken* (no question),
  so they apply on their own; only the blows are offered. Each blow's `ask` is its
  whole sentence, because that sentence is the choice.
- **`text` as well as `ask`** — the `ask` is the question in the confirm sheet and
  the roll panel; the `text` is the prose the roll carries afterwards, and it is
  what gets posted to Foundry as "what happened to the target".
- **`label` carries `{…}`** — an interpolating label so the collapsed effect row
  and the breakdown read `Add 2d10 to Damage Roll` for a level-17 character,
  never the expression.
- **`picks` on the feature, not on each effect** — the pick count is a property of
  the *group*; four copies of one number would eventually disagree.
- **Level 13's options live on Brutal Strike** — because that is where they fire.
  Improved Brutal Strike carries only a `note` explaining itself. The link is the
  `has_improved_brutal_strike` identifier, which `expr.ts` derives from the
  feature's own name: *having* the feature is what turns the options on.

---

## 4 · Lifecycle of one use

1. **Reckless Attack** (free, once per turn): its `setVar` writes
   `recklessAttack = true`, gated `attacksThisTurn == 0`. The variable is stored,
   player-scoped, `resetOn: 'turn'`.
2. **Brutal Strike** (free, once per turn): one press arms **all six** effects into
   `resources.graph.armed`. The four blows are armed *carrying their question* —
   never pre-ticked. This is the fix behind `once` arming per selector: the confirm
   sheet must not answer the choice for the player.
3. **The Strength attack roll**: Reckless's `adv` and Brutal's armed `dis` both
   match, and cancel — that is how "forgo Advantage" is implemented, with no
   special op. The arm matches a greataxe swing (`sub: 'melee'`, `ability: 'str'`)
   because `roll:attack.str` is compared against the ability too, not only the sub.
4. **The melee damage roll**: the `add` applies on its own (it was never asked
   about); the blows arrive as **one pick-one group**, each undecided
   (`when: 'manual'`, `on: false`) and each carrying its prose as `reveal`. The
   player takes one — or two at level 17, per `picks`.
5. **Consume**: the roll spends the arms. Every d20 surface owes that write, or the
   arm pays out forever.

---

## 5 · What affects it

Nothing *targets* Brutal Strike. Coupling in this system happens three ways, and
all three are in play here:

**a · Shared variables** — the gate reads state another node owns.

| Identifier | Declared by | Kind |
| --- | --- | --- |
| `recklessAttack` | Reckless Attack (feature) | stored bool, player, `resetOn: 'turn'` |
| `attacksThisTurn` | the engine (`VAR_IDENTS`) | turn-tracker counter |
| `isRaging` | Rage (feature) | stored bool, `resetOn: 'short'` |
| `rageDamage`, `rages` | Barbarian (class carrier) | derived level tables |

**b · `has_*` identifiers** — "do you have this feature", derived from the feature's
name by `expr.ts`: `has_improved_brutal_strike`,
`has_improved_brutal_strike_enhanced`. This is how a later feature enables an
earlier one without either editing the other.

**c · The same roll selector** — anything else contributing to `roll:damage.melee`
or `roll:attack.str` lands in the same breakdown. From the live catalog:

| Feature | Op | Value | Gate |
| --- | --- | --- | --- |
| Rage | `add` | `2` | `isRaging` |
| Frenzy | `add`, once | `1d6 * rageDamage` | `isRaging && recklessAttack` |
| Reckless Attack | `adv` | — | `recklessAttack && attacksThisTurn == 0` |
| Reckless Attack | `note` | "attacks against you have Advantage" | `recklessAttack` |
| Fighting Style: Great Weapon Fighting | `reroll` | — | — |
| Savage Attacker | `reroll` | — | — |
| Fighting Style: Dueling | `add` | `2` | — |
| Bloodied Fury | `add` | `1d4` | `hp < hpMax / 2` |
| Paladin's Smite / Divine Strike / Colossus Slayer / Sneak Attack | `add`, once | `2d8` / `1d8` / `1d8` / `1d6` | — |

So a level-17 raging barbarian's Brutal Strike damage roll is: weapon dice +
Rage + Frenzy + 2d10, with Great Weapon Fighting and Savage Attacker both offering
rerolls on the finished total, and one or two blows chosen from four.

> Adjacent defect, not fixed here: **Rage**'s damage `add` is authored as the
> literal `2`, while the Barbarian class declares `rageDamage` as a level table
> (2/3/4). Above level 8 it pays the wrong number.

---

## 6 · The traps this feature already found

Each of these shipped, silently, and is now a regression test. Worth reading
before authoring anything of this shape:

- **One press armed both blows.** The confirm sheet pre-ticked every `ask`, so the
  roll showed two identical rows with nothing to choose. An armed note's toggle is
  answered at the *roll*, not at the press.
- **A `once` arms once per selector.** Two roll targets on one armed effect mint two
  modifiers — two dice for one use. `oneOf` groups them so one roll spends both.
- **`byLevel` on an armed effect was ignored.** The arm snapshotted the level-1
  value, so 1d10 stayed 1d10 at 17 — one value, two code paths, only one upgraded.
  (Hence the ternary here rather than a level table.)
- **The ability-targeted arm never matched.** `roll:attack.str` vs a swing that
  resolves as `sub: 'melee', ability: 'str'` — the arm applied to nothing, could
  never be consumed, and blocked the feature from being offered again.
- **The card printed the formula.** `has_improved_brutal_strike_enhanced ? 2d10 :
  1d10` was shown to the player verbatim; feature rows now resolve values against
  the character.
- **A non-armed note with a toggle is refused** by the audit — a toggle that only
  hides prose should have been a `when`. Armed, it is legal, because then the
  toggle commits a choice.
