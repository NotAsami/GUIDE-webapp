# Rules engine port — deviations, measurements and the fix list

The engine is being ported from TypeScript (`src/lib/expr.ts`, `dice.ts`, `graph.ts`) to Rust
(`engine/`), compiled to WebAssembly (`packages/engine-wasm/`). The port's rule is **same output
for every input**, including outputs that look wrong. This file is where the exceptions to that
rule and the wrong-looking behaviour are written down.

Status: **slices 1 (expression evaluator), 2 (dice), 3a (the sheet layer) and 3b (the feature
graph: variables, resolver, audits) are done.** The whole engine now exists in Rust. Callers still
use the TypeScript engine; they move in slice 4.

## 1. Where the two engines differ on purpose

Shadow mode reports each of these if it ever happens in play.

| # | Input | TypeScript | Rust | Why |
|---|---|---|---|---|
| 1 | An expression nested more than 256 deep | Evaluates, until it dies with a RangeError near 10,000 | Throws at 257 (`MAX_DEPTH`, `engine/core/src/expr.rs`) | A fixed limit is what guarantees the port never overflows the stack. Authored formulas nest about 10 deep. Approved in the plan. |
| 2 | Indexing an array with NaN, e.g. `[1,2][x]` with `x = NaN` | `flat: undefined` | `flat: NaN` | Reachable only when NaN is already in the scope. Matching it would make every `flat` optional. Approved in the plan. |
| 3 | Lowercasing one of 28 capital letters added in Unicode 17 (U+A7CE, U+A7D2, U+A7D4, U+16EA0–U+16EB8) | Depends on the browser: Node 24 leaves them unchanged | Lowercases them | Rust's tables are fixed by the pinned toolchain; JavaScript's follow whatever the host ships. Found by the every-code-point test. Affects `hasIdent` not at all (non-ASCII collapses to `_`) and `normalizeTag` only for tags in Beria Erfe or three rare Latin letters. |
| 4 | A scope value that is neither a number nor a boolean (`null`, a string) | Coerces it (`null + 1` is `1`) | Throws | The type forbids it and no scope builder produces one. Only a value a formula actually reads is checked. |
| 5 | Rolling more than 100,000 dice in one call | Allocates and rolls until the tab runs out of memory | Throws (`MAX_DICE`, `engine/core/src/dice.rs`) | Same reasoning as the nesting limit. The largest roll in the SRD is 40d6. |
| 6 | `rerollDie` given a die carrying fields other than `v`, `sides`, `orig`, `rerolled`, `crit` | Copies them through | Drops them | The `RolledDie` type has exactly those five; no caller adds more. |
| 7 | `rollHeal` given something that is neither a number nor a string | Coerces it to a string | Throws | The type forbids it. |
| 8 | Malformed character data where reading a property of `undefined` or `null` is unguarded (`attuned: null` on a shard slot, `saves: null` on an effect) | Throws a TypeError | Reads the property as absent and carries on | The sheet layer is written against a JavaScript-shaped value (`engine/core/src/value.rs`); tracking every unguarded read to throw in the same places is not worth its weight. About 10% of generated characters hit this and are skipped by the property test. |
| 9 | A string or an object where a number belongs (`ac: "3"`) | JavaScript coercion: `"3" + 5` is `"35"` | The arithmetic reads it as NaN | The types forbid it. `null` (0), booleans (0/1) and `undefined` (NaN) do match. |
| 10 | An object with integer-like keys (`{"2": …, "1": …}`) | Iterates them in numeric order first | Iterates in the order written | No engine-read object is keyed that way; variable names must start with a letter. |
| 11 | A variable named after an inherited object property (`constructor`, `toString`) | `name in scope` finds the inherited property, so the variable is skipped | Treated like any other name | Fix-list item 15, not reproduced: it would mean modelling JavaScript's prototype chain. |
| 12 | An effect with no `op`, or an op the schema does not know | Throws a TypeError in `IS_ACTIVATION` — in the audit AND on every roll that matches it | Treats it as a passive op with no fields | Covered by deviation 8's rule (malformed data reads as absent), but worth its own line: one bad row breaks a character's rolls in the original. |

## 2. Step 0 measurements (Apple silicon, Node 24.11.1, Rust 1.99.1, wasm-bindgen 0.2.130)

**Size.** `engine_bg.wasm` with the evaluator only: **96 KB raw, 58 KB gzipped**, after `wasm-opt -Oz`.
With dice added (slice 2): **127 KB raw, 71 KB gzipped** — most of the growth is the first use of
serde deserialisation, not dice. With the sheet layer (slice 3a): 171 KB raw, 91 KB gzipped.
With the whole engine (slice 3b): **276 KB raw, 135 KB gzipped.** The main JS chunk it sits beside
is 516 KB raw, 157 KB gzipped. Not worth lazy-loading: the engine is needed for the
first render, and Vite already emits it as a separate hashed asset fetched alongside the main chunk
(516 KB raw, 157 KB gzipped).

**Per-call cost.** `evalExpr("level / 2 + wis", scope)` with a 51-name scope:

| | per call |
|---|---|
| TypeScript | 0.9 µs |
| WebAssembly, scope serialised with serde-wasm-bindgen | **175 µs** |
| WebAssembly, scope read in place, one property per identifier used | 1.3 µs |

Serialising the scope on every call was 200× slower than the original, and the evaluator is called
in loops. So a scope is **never serialised**: the binding hands Rust the JavaScript object and the
evaluator reads only the names the formula mentions (`Lookup` in `expr.rs`, `JsScope` in
`engine/wasm/src/lib.rs`). `interpolate`: 1.7 µs → 2.3 µs. String-only calls such as `hasIdent`:
0.2 µs → 0.5 µs.

**Whole-character payload** (72 KB of JSON: 30 features, 20 spells, 11 equipped items, 40 carried),
in and back out through an untyped value:

| | round trip |
|---|---|
| serde-wasm-bindgen | 1.32 ms |
| JSON string (including `JSON.stringify` and `JSON.parse`) | 0.86 ms |

JSON is 1.5× faster, under the plan's 2× threshold, and both are about a millisecond once per
character change. **Decision: serde-wasm-bindgen stays** (it carries NaN, Infinity and -0; JSON
cannot). To be re-measured with the real typed structs in slice 3a, where skipping unread fields
should help both.

**Loading.** The one `--target web` build loads under Node (`initSync` with file bytes,
`scripts/engine-node.mjs`), Deno (`init` with a file URL) and a Vite production build.
Handle finalisation is unverified: no handle exists until slice 3b.

### Slice 3a: a whole character across the boundary

An 88 KB character (30 features, 20 spells, 6 equipped items, 40 carried), per call:

| | TypeScript | WebAssembly, stateless |
|---|---|---|
| `effectiveSheet` | 14 µs | **1,460 µs** |
| `activeSources` | 4 µs | **1,850 µs** |

The port's own work is negligible; the cost is copying the character in and the result out, and it
is 100× the original. `effectiveSheet` is called without a memo from about eleven render paths and
many library functions, so **the sheet layer must not be called statelessly once callers move.**
Slice 4 has to put a per-character cache in front of it — the character converted once per change
and held in the engine (the handle the plan already calls for in `buildContext`), with results
cached on the JavaScript side by the character object's identity. That is a design decision for
slice 4, not something this slice settles.

### Slice 3b: the graph, through a handle

The same 88 KB character, 30 features with graphs:

| | TypeScript | WebAssembly |
|---|---|---|
| `buildContext` | 100 µs | 1,620 µs, once per character change |
| `resolve`, one roll | 12 µs | **14 µs**, through the handle |
| `characterVars`, stateless | 77 µs | 1,570 µs |
| `auditNode` against 1,633 catalog nodes | 132 µs | 3,610 µs |
| `auditNode` with no node list | — | 116 µs |
| `normalizeTag`, `gid` and other string helpers | under 1 µs | under 1 µs |

The handle does what the plan wanted: a roll costs the same in either engine, because only the
request and the result cross. Everything stateless that takes a whole character or the whole
catalog pays the copy. For slice 4 that means two more things need the handle treatment before
their callers move: `characterVars` (called from rest, level-up, classes, races, backgrounds and
the DM console) should be read off a context, and `auditNode` needs the catalog's node list held
in the engine rather than sent on every keystroke in the editor.

## 3. Corrections to the plan found while building

- **`GraphContext` is a handle with a plain face.** `buildContext` in the facade returns the object
  callers already expect (`scope`, `armed`, `problems`, and the two index maps, built on first
  read) with the WebAssembly handle attached out of sight. A caller that spreads a context to
  change part of it gets an object without the handle, and is answered by the TypeScript engine.
  Slice 4 has to find those callers; slice 5 cannot delete the original until none are left.
- **The five engine-owned types stay in `database.types.ts` for now.** The graph reads
  `GraphEffect`, `VarDef`, `ArmedMod` and `GraphState` as `Val`, like the rest of the character.
  Generating their TypeScript from Rust would mean typed structs that re-decide `undefined`
  against `null` field by field, which is the thing `Val` exists to avoid. What Rust does own, and
  a test pins, is the op schema table the audit reads. Whether to go further is a slice 5 question.
- **A generator that produces `null` freely proves nothing.** The first run of the graph property
  tests passed while skipping nearly every case, because the original throws on a stray `null`.
  The generators now produce missing fields but few nulls, and the skip rate is measured: none for
  audits and variables, about a tenth for rolls.

- **The sheet layer reads a JavaScript-shaped value, not typed structs.** The originals lean on
  `undefined` against `null` against a missing key, on `{...spread}` carrying unknown fields
  through, and on object identity. `Val` (`engine/core/src/value.rs`) keeps all three, so the port
  follows the original line by line. The plan's "reading view" of each row type is this, made
  dynamic. Whether the five engine-owned types (`GraphEffect`, `VarDef`, …) become typed Rust
  structs is decided in slice 3b.
- **Small helpers now exist twice.** `abilityMod`, `proficiency`, `isPrepared`, `shardSlots`,
  `getGear` and a dozen like them are used all over the UI and are also needed inside the engine.
  They are ported, and the TypeScript copies stay for now. Slice 5 has to choose, helper by helper,
  between the UI calling the engine and an accepted duplicate held equal by a parity test.
- **Snapshots of real characters are not committed.** The repository is public. The catalog
  corpus below does not need them.
- **The catalog corpus reads `supabase/catalog_snapshot.sql`**, which is already committed and
  holds every authored row with its graph: 393 features, classes, races and backgrounds, 962
  items, 340 spells, 5 shard trees, 9 effects. `src/lib/engine.corpus.test.ts` places each on a
  level-10 character and asks the sheet layer about it on both engines.

- **Randomness is the LAST argument of every rolling function in the port**, so the facade fills in
  optional arguments before it (`rolledDiceTerms`' `double`). Shadow mode records what the original
  drew from `Math.random` and replays that tape into the port; drawing a different number of times
  is reported as a difference.

- **No top-level `await` in `main.tsx`.** Vite's default build target rejects it. Slice 4 wraps
  boot in an async function (`initEngine().then(render)`) instead.
- **`wasm-opt` needs its feature flags named**, and the release profile must not strip the
  `target_features` section. Both are handled in `scripts/engine-build.mjs` and `Cargo.toml`.
- **The oracle's wire format is ASCII-only.** Node's `readline` also breaks lines at U+2028/U+2029.

## 4. Behaviour to fix after the port

All of this is reproduced faithfully by the port. Line numbers are `src/lib/`.

1. `evalExpr` throws, despite its "never throws" contract, on a dice count past 1e21 scaled twice (expr.ts:159), on runaway nesting, and on `when: null` in data.
2. A guarded division still rejects: `x == 0 ? 0 : 10 / x` fails when `x` is 0, because both ternary branches are evaluated (expr.ts:340).
3. `boost()` ignores the booster's `when`, `ask`, `once` and `match` (graph.ts:982).
4. Two `add` effects on one owner each receive that owner's full chained boost, so the booster counts twice.
5. `when` is evaluated, and can report a problem, for ops that are then skipped (graph.ts:1048 against 1092–1115).
6. A `once` note with no `ask` is printed on every matching roll (graph.ts:1083 runs before 1115).
7. A hit-gated note with unknown hit and no `ask` is shown as if the attack hit.
8. `ask: ''` with unknown hit applies the effect as active.
9. `when: ''` passes the audit and fails on every roll.
10. `rider.formula` and `parts` show `eff.value` even when a level table supplied the formula (graph.ts:994 against 1174).
11. Every use-counter variable logs a false "Variable did not resolve" (`characterVars` walks it before binding it).
12. Runtime never receives `catalogTypes`, so a condition reading a variable from an inactive feature fails instead of reading zero.
13. Runtime and author time disagree on derived variables holding dice or strings (graph.ts:310 against 162).
14. A stored variable named `level` overrides the real level; roll names override declared variables.
15. `name in scope` walks the prototype chain: a variable called `constructor` or `toString` is skipped.
16. The AND-clash audit has false positives: `roll:d20` with `roll:attack`, and `roll:attack.melee` with `roll:attack.str`.
17. `roll:attack.melee.x` passes the audit (graph.ts:1903).
18. Sheet ops skip the target, identifier and level-table checks (graph.ts:1771, 1821); `minimum` and `faces` are never identifier-checked.
19. An armed `crit` sets no threshold; armed `floor` and `reroll` are ignored (graph.ts:1276–1278).
20. The comments at expr.ts:147–156 say `parseDice` rejects a leading sign. It accepts one.
21. `rollDiceTerms` (dice.ts:86) has no callers.
23. An armour or sheet AC of `null` is treated as set: `baseAc: null` makes the item body armour worth 0, and `sheet.ac: null` overrides the computed AC with 0 while the breakdown shows `base: null` (effects.ts:275, 323).
24. `armorClass` finds the shield's own source with `s.obj.id === shield.id`; when neither has an id, `undefined === undefined` picks the first source without one (effects.ts:333).
26. An effect with a missing or unknown `op` throws in `IS_ACTIVATION` (opSchema.ts:351), from the audit (graph.ts:1545) and from `resolve` (graph.ts:1097), so one malformed row stops every roll that matches it.
27. A variable declared with no `name` is walked, reported with no id, and bound in the scope under the key `"undefined"` (graph.ts:74, 100).
28. `suppressedEffects` throws when an applied effect has no `name` (graph.ts:1356 into 460).
25. `compileEffects` looks stats up on plain objects, so a stat named `constructor` or `toString` matches an inherited property (modEditor.ts:57, 69). Not reproduced by the port.
22. `docs/GUIDE_Codex_Authoring.md:387` says arithmetic is integer. Only `/` floors; `1.5 + 1` is `2.5`.
