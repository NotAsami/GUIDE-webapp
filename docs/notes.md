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

## ISSUES
- Add a way to add a picture of shopkeeper to the menu (needs design (both shopkeeper editor & the actual menu) + better image uploads)
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. — **OPEN, and unscoped.** The effect editor exists; what "integration" means does not: which effects a spell may grant, whether casting applies them, and how they expire. Needs reading before building.
- Nested target conditions `(tag:"fire" & roll:"damage.melee") | tag:"epic_spell"` — the `or`/`and` toggle shipped; the NESTED form is designed, costed and deferred in `GUIDE_Codex_Deferred.md` with a named trigger (two workaround effects both matching at once, so the contribution lands twice). Not open work — waiting on its trigger.
- §19's `AmmoBonus` deletion is still owed: nocked ammunition adds a flat, named bonus through its own path rather than being a graph contributor like everything else. Blocked on "what does active mean for a carried item" in `GUIDE_Codex_Deferred.md` — a nocked stack is *carried*, not equipped.

## DECISIONS WORTH KEEPING
- The roll context panel is a **modal with a scrim**, so it can never be sticky as built. A genuinely sticky panel would have to stop being a modal — drop the scrim, drop `aria-modal`, and give the 436px rail its own column in the Layout grid. Deliberately not wanted for now; the toast and the counted badge cover it.
- *"Perception checks made to see you have disadvantage"* is a modifier on **someone else's** roll, which the engine cannot express — it resolves this character's rolls only. Use a `note`; recorded in `GUIDE_Codex_Deferred.md`.

## GRAND UNIFICATION
- A centralized editor for everything (except shards). Effects, features, spells, items, shopkeeprs, loot tables. Exactly like in Dicecloud, where you first set what each node is supposed to be and then edit from there, like you set an item node and you get stuff regarding items in the editor. Exactly like in Dicecloud (last, post launch, just QOL)

## LEFT TO DO:
COMPLETELY DESIGNED:
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- Level up characters for DM-view (designed, need to review the design and make sure it is implemented correctly)

SMALL CHANGES TO DESIGN:
- Graph Engine — **built through slice 6c** (all four node kinds author a graph, tags, armed queue, activations, `or`/`and`). Spec: `GUIDE_Codex_Graph_Engine.md`; how-to: `GUIDE_Codex_Authoring.md`. **Still a reserved overlay: the Dependency Graph panel** — the visual of which features feed which. Button and panel exist; the contents say "Not built in this pass".
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
