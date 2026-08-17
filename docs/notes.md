## PARTY OVERVIEW FEATURE
- Implement some sort of party list for the players, so that they know how the rest of their team is doing something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: if more than 4 players we need some sort of scrolling feature, maybe a small arrow on the side that will scroll the list up and down, or maybe a small scroll bar on the side. This will be a problem for mobile users, so we need to make sure that it is easy to use for them as well. Maybe a swipe up and down feature for mobile users. Also need to make sure that it is not too big, so that it doesn't take up too much space on the screen. Maybe make it collapsible, so that it can be hidden when not needed.
    - Not a problem currently since we are only max 4 players
      - Potentially considering a fifth and sixth player, so we do actually need the scaler (not sure if they will join)
        - I just realized that you will not get your character rendered, so if there are 5 players only 4 are needed.

## LOOT GENERATOR ENGINE
DM view: Add a loot generator feature, you create a list of things you want to randomly give, like for example a chest, peasant corpse, knight corpse. Each would have a list like:
Chainmail Boots x1 30%
Amulet of strength x1 2%
Arrows x1-10 50%
Torch x1 40%
Rations x2 28%
…
The DM can define a list that would then parse these lists, choose what items to give based on the percentage and the amount (1-10 for arrows) and would then grant the player the items chosen from the list. When we do the list of predefined items, we can also do a list of predefined generators for chests, shelves, bookshelves, corpses. The generator should be able to store multiple lists. This would also benefit our store maker, which could use the same or slightly modified version of the generator

## PREMADE LIST OF ITEMS
- An already premade list of items in dnd, not sure where to get it, but this would be for sake of easy use so that the dm doesn't have to create every single item from scratch, like health potions of giant's strength, daggers, swords, pikes and other weapons and armor.

## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN
- Worth designing it as "a campaign has settings", so you can edit the theming too.

## ADD A DM-CONSOLE BUTTON
- So the dm doesn't have to go to the url to get to the dm console.

## BETTER IMAGE UPLOADS
- Like so you don't have to use the sql for it. (probably on each character portrait or thing that has an image, you get an input for image files)

## TURN TRACKER (not a VTT)
- A turn tracker per-player button that when you press effects like poison get sent to the roll context panel that remind the player they took 1d6 damage (can roll in there) the button just “advances” the players turn, no tracking actual combat. The effects then need to be able to read the turn has advanced and remind themselves. Inspiration from dicecloud
- Located in the roll context panel? YES!
- **Scheduled: the pass after the Features screen redesign. Design + blockers written up in `GUIDE_Codex_Deferred.md` → "Advance Turn — a round tracker".**
  - Behaviour so far: clear every 1-turn effect; decrement longer ones by a turn (1 minute = 10 turns); **third behaviour not yet recalled — deliberately not guessed, it may decide the data shape.**
  - **Blocker found: nothing stores a NUMBER of turns.** `EquippedItem.duration`, `ActiveEffect.note` and `Spell.duration` are all free text — `EquippedItem.duration`'s own comment says *"NOT auto-counted — there's no round tracker"*. Live data is worse: the one active effect in the campaign is Haste and its `note` (the documented duration field) holds `"Haste"`, i.e. it's being used as a label. So this is a data-model change before it's a button: `ActiveEffect.turns?: number`, authored at apply time.
  - Already has somewhere to report: `pendingOf` (lib/rollView.ts) reserves a turn-tick slot, so the toast's CTA and the nav badge will surface "3 ticked, 1 expired" with no change to either surface.
  - **Decide with it, don't discover after: concentration.** Haste is a concentration spell, and a tracker that keeps ticking an effect nobody is concentrating on is a silent wrong number, not a missing feature.

## QOL ADDITIONS
- ~~A notification icon in the roll context panel when you roll something that incentivizes to open it, like a yellowish or red ping corcle (Also written in feature engine part)~~ ✔ **DONE**, then redone properly — it's now a **counted, pulsing badge** on the ROLLS button (`2` = two things need you), pulsing by scale + a radiating ring, hidden while the panel is open, `prefers-reduced-motion` keeps the count and drops the motion.
- ~~Remove the now redundant roll popup toast in the bottom right, only for rolls though, rest should remain active, the things that are displayed in the roll context panel shouldn't have a toast, instead the notification should be on the rolls button, see above.~~ **SUPERSEDED — deliberately reversed.** The toast was removed, that turned out to be wrong (see ISSUES → "ping is not enough"), and it came back as a **result display**: title + totals only, no riders/breakdowns/notes. **One toast for everything** now — a swing, a potion, a rest all reach it through the roll log, so there is one card and one design rather than two drifting apart.
- ~~Rolls button should be "ROLLS" not "Rolls"~~ ✔ **DONE**
- ~~In line colors (like in the feature editor so you can say that the text "fire damage" should be red or something, like {#ffffff:"Fire Damage"} or something similar)~~ ✔ **DONE**, as a markdown-flavoured span: `[Fire Damage]{fire}`. Named colours preferred (they follow the theme and share `lib/palette.ts` with the roll panel's damage tints); `{--cyan-hot}` and `{#e2b021}` also resolve. Anything unrecognised renders literally so a typo is visible.
- ~~Reorder the panels in the catalog, shards and features should be last since they bring you to a different screen.~~ ✔ **DONE** — Items, Spells, Effects, Shopkeepers, Features, Shards.
- Pressing the button that leads to the screen you are in currently on the navbar should bring you back to the codex screen that is on / — **STILL OPEN.** Verified: `Nav.tsx` uses a plain `NavLink to={item.to}`, so clicking the active screen is a no-op rather than a route home.

## ISSUES
- Add a way to add a picture of shopkeeper to the menu (needs design (both shopkeeper editor & the actual menu) + better image uploads)
- Currently, there is no way to make an item grant proficiency or expertise. (Is that in 5e?) — **STILL OPEN.** Verified: `ItemEffects.skills` is a flat per-skill *bonus* only; nothing on an item can touch `sheet.proficiencies`.
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. (Fix with the effect editor) (EFFECT EDITOR DONE, now only the integration)
- ~~The Activation Outcome in feature editor doesn't have a gap between it and the buttons of the contributions, add a little buffer.~~ ✔ **DONE**
- ~~I had a feature that had a "while up" condition which was just prose, so the player needed to check it, but it is not possible to do that now.~~ ✔ **DONE** — the `when` row has a **player toggle** button: one press declares a stored player bool and points `when` at it. This was two bugs: nothing said a variable was how you write it, AND a variable declared on an item/shard node reached no player control at all (fixed with the "Gear & Shard State" block on the Features screen). Recipe written up in `GUIDE_Codex_Authoring.md`.
  - Note the half that can't be built: *"Perception checks made to see you have disadvantage"* is a modifier on **someone else's** roll. Use a `note` today; recorded in `GUIDE_Codex_Deferred.md`.
- The icon in the effect panel when you open it when you have a debuff should be red, not cyan — **HALF DONE.** The status *chip* is correct (`.statusChip.debuff .scIcon` → `--danger-hot`). The **opened detail popover is still wrong**: its icon uses the shared `imCrystal` style with no `kind` class applied, so it stays cyan for a debuff.
- ~~The armed feature is confusing to use, you have to click use, then the checkmark and then confirm, checking the toggle shoudln't be involved in the step, if only some thing like using this will check x and do y, and if you confirm then it arms.~~ ✔ **DONE** — the `ask` boxes start **ticked**, so it's Use → Confirm, and unticking is how you decline.
- Genuine gap: you can't confiscate / take equipped gear from players. — **STILL OPEN.** Verified: `confiscate()` takes an `InventoryItem` and is only wired from `OperatorInventory`; equipped gear lives in `character.equipped`, which that flow never sees.
- Genuine gap: you can't specify a weapon is ranged, so a shortbow in the current form doesn't take ammunition — **STILL OPEN.** Verified: no `ranged`/`reach` field exists on the item type at all. Note the engine side is already there — `roll:attack.ranged` and `roll:damage.ranged` are live selectors — so it's the item model and the ammo wiring that are missing, not the targeting.
- ~~A better AND and OR, so you can have conditions like (tag:"fire" & roll:"damage.melee") or tag:"epic_spell"~~ **MOSTLY DONE.** The `or`/`and` toggle shipped (§54), with an audit error for an AND that can never match. The **nested** form `(A & B) | C` is not built — it needs disjunctive normal form and a real authoring UI; designed and costed in `GUIDE_Codex_Deferred.md`, and the trigger is when two workaround effects can both match at once (then the contribution lands twice).
- ~~The roll context panel ping is not enough to catch attention~~ ✔ **DONE** — four coordinated changes: the toast came back as a **result**; it carries a tappable **`2 unresolved · open panel`** line when there's something it can't show; the badge is a **count that pulses by displacement**; and **only the player ever opens the panel** — no auto-open on a roll, no restore across a reload, since it is a modal with a scrim and a copy appearing on its own is an interruption you have to dismiss first. Opening it settles every entry in it, an ask left switched off included — leaving a toggle off is an answer ("it missed"), so the badge must not keep pulsing at someone already done.
  - Note for later: a genuinely *sticky* panel would have to stop being a modal — drop the scrim, drop `aria-modal`, and give the 436px rail its own column in the Layout grid. Not wanted for now.
- The current rest popup has some issues, like missing angled borders, the health going across 2 lines and generally bad UX — **STILL OPEN.** (The *rest toast* is new and correct; the **modal** hasn't been touched.)

## GRAND UNIFICATION
- A centralized editor for everything (except shards). Effects, features, spells, items, shopkeeprs, loot tables. Exactly like in Dicecloud, where you first set what each node is supposed to be and then edit from there, like you set an item node and you get stuff regarding items in the editor. Exactly like in Dicecloud (last, post launch, just QOL)

## ~~"computed by engine" could be expanded~~ ✔ DONE
- ~~Regarding the roll context panel, what if the "computed by engine" could be expanded to show the summary of the feature and show the roll?~~
- ~~The thing worth deciding is what expansion reveals~~ → chose **both, summary first**, presented like the existing `Ask` fold in a quieter tint (it's a footnote you opened, not a decision waiting on you).
  - ~~The feature's summary — its prose~~ → `Rider.sourceText`, filled at resolve time (`source` is a bare display name and the prose lives on a DM-only table, so it was unreachable from the panel).
  - ~~The contribution's own breakdown — the derivation~~ → `Rider.parts`, also captured at resolve time, because the scope is a snapshot mid-roll and the operand values are gone by the time anything renders the log. A flat number or bare die carries none, and then the row doesn't offer a chevron.

## LEFT TO DO:
COMPLETELY DESIGNED:
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- ~~Roll context panel, opens with a button in the bottom bar (only for decor currently) (designed)~~ ✔ **BUILT** — the toast is the result, the counted badge is the reminder, and **only the player opens the panel** (stickiness was built and then dropped on purpose, see line 61).
- ~~Features screen redesign (mockup: `guide-hud/project/G.U.I.D.E. Features.html`)~~ ✔ **BUILT** — two-column stream, Usable/Passive tabs, source chips, the hexagon as the use control, effect sub-rows off the graph, per-feature tint, and a popup with an origin breadcrumb and a live "Affected by" reverse lookup. Dropped from the mockup on purpose: the gated/hidden counters (nothing in the data model backs them) and its Subclass chip (not a `FeatureCategory`).
- Level up characters for DM-view (designed, need to review the design and make sure it is implemented correctly)

SMALL CHANGES TO DESIGN:
- Graph Engine (Missing graph panel) — **built through slice 6c**: all four node kinds (features, spells, items, shard nodes) author a graph, with tags on all of them, the armed queue, activations, and the `or`/`and` target toggle. See `GUIDE_Codex_Graph_Engine.md` for the spec and `GUIDE_Codex_Authoring.md` for how to use it.
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip), should be like a category or some indicator that you got it from a feature)

NO DESIGN / ONLY PART OF DESIGN:
- Mobile port (only inventory designed)
- Campaign switcher / character switcher (needs design) (last thing to implement)
- Loot table engine (needs design)

NO NEED TO DESIGN:
- List of premade items
- Implement markdown parsers to most input fields

---

## NEXT
**Advance Turn / round tracker** — the Turn Tracker section above has the design and
the blocker: nothing stores a number of turns yet, so it is a data-model change
before it is a button. The third behaviour of the button is still un-recalled.
