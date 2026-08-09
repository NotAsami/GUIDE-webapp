## PARTY OVERVIEW FEATURE
- Implement some sort of party list for the players, so that they know how the rest of their team is doing something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: if more than 4 players we need some sort of scrolling feature, maybe a small arrow on the side that will scroll the list up and down, or maybe a small scroll bar on the side. This will be a problem for mobile users, so we need to make sure that it is easy to use for them as well. Maybe a swipe up and down feature for mobile users. Also need to make sure that it is not too big, so that it doesn't take up too much space on the screen. Maybe make it collapsible, so that it can be hidden when not needed.
    - Not a problem currently since we are only max 4 players
      - Potentially considering a fifth and sixth player, so we do actually need the scaler (not sure if they will join)

## SHOP FEATURE
- A shop feature, it pops up on the players screens, they can spend money from their inventory, it will automatically deduct it from their balance it will automatically give them the item they purchased, the DM will be able to make these shopkeepers from their dm view, they will have a few presets that will take items they already created from some categories (they can't sell relics) and the dm will also be able to make their own custom one and save that as a preset so they can randomly generate a for example potion seller that will sell the potions from the potions list that is in the database. Integrates with the Loot table engine slice.
  - Problems: ~~Need to sync very fast so that when a player purchases something it will be out of stock for the other players already~~ (FIXED BY SERVER SIDE CHECK OF ITEM PURCHASE, FIRST ONE WINS, OTHER GETS OUT OF STOCK POPUP). Increased complexity (maybe performance issues?)

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

## FEATURE ENGINE & ROLL CONTEXT PANEL
- Current state of features is that they are only descriptive, they can't grant wisdom boost, effects like healing or anything, question is how to implement a way to actually use these features Like we would need a list of a lot of things the feature could do, but you also need specific ones for specific ones, like you can't make a list of everything a feature would want. Difficult. Like we have features ranging from Judgment’s Edge: When you hit a creature affected by your Arbiter’s Judgment, deal +1d4  radiant or  necrotic damage (your choice), to Final Strike: You declare a creature’s final judgment. Your next attack against them is an automatic critical hit, and they make death saves with disadvantage if reduced to 0 hit points. There is no easy way to make this happen. This will be a MAJOR slice. ALREADY DESCRIBED IN INVENTORY REFACTOR (??) → MOVE TO OWN DOC ← NAMED FEATURE ENGINE & ADDITIONAL ROLL CONTEXT PANEL, SOME DESCRIPTION IN GITHUB README.md 
- A notification icon in the roll context panel when you roll something that incentivises to open it, like a yellowish or red ping corcle
- DOC IS MADE, NEED TO DISCUSS WITH CODING AGENT TO FIGURE OUT IMPLEMENTATION, THEN DESIGN

## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN

## EFFECT LIBRARY
- The gap: effects exist as instances attached to things, but there is no library of definitions. Items author modifiers inline; the DM's Apply Effect picks from a hardcoded list. A spell saying "grant Haste" has nothing to reference — so party-targeted spells currently apply effects that don't do anything.
- Fix: an EFFECTS tab in the Catalog Manager — a sixth tab, standard list + form. One definition, referenced by items, spells, features, and the console.
- DECISIONS:
  - Duration lives on the applier, not the definition. An effect defines what it does; whoever applies it decides how long. Haste is 1 minute cast, permanent-while-equipped from an item.
  - Item effects migrate to references. No inline alternative — one source of truth. The item form's EFFECTS GRANTED sub-section becomes a picker plus per-row duration.
  - The picker is a search, not a dropdown. Type to filter by name and tag, show a handful of matches. Same interaction as the shop stock item picker. A raw list of hundreds is unusable.
- The three-way split that the model rests on
| | Holds | Example (Haste) |
|---|---|---|
| **Modifiers** | Numeric stat changes | +2 AC, speed ×2 |
| **Flags** | Non-numeric mechanical effects | Advantage on DEX saves |
| **Description** | Prose the human applies | The extra limited action; the lethargy when it ends |

- **Never pretend advantage is a flat number** — the rule that already governs items
governs effects. The form must make modifiers and flags visually distinct, or the data
ends up with `advantage: +1` in six months.
- Definition also carries: name, icon, kind (Buff / Debuff / Condition — drives tint), and
tags (free-text, autocomplete from tags in use, lowercase-normalised).
- Add a markdown parser to the decsription field, so that the DM can add formatting to the description of the effect. (This should become standard practice, maybe add to claude.md, doc is present for the implementation)

## BETTER IMAGE UPLOADS
- Like so you don't have to use the sql for it.

## ADD A WAY TO HAVE ITEMS COST DIFFIRENT CURRENCIES IN SHOPS
- Describes itself, plus auto-conversion (agent said it was implemented, but I haven't tested it yet since you can't use silver or copper to set the price of an item)

## TURN TRACKER (not a VTT)
- A turn tracker per-player button that when you press effects like poison get sent to the roll context panel that remind the player they took 1d6 damage (can roll in there) the button just “advances” the players turn, no tracking actual combat. The effects then need to be able to read the turn has advanced and remind themselves. Inspiration from dicecloud

## QOL ADDITIONS
- Add a “NEW” marker on to right of newly added items to inventory, disappears after first hover. If a new item lands inside a container the player hasn't opened (say, an arrow auto-routed into an unopened backpack), the badge should also surface as a small dot on that container's tab
- A notification icon in the roll context panel when you roll something that incentivises to open it, like a yellowish or red ping corcle (Also written in feature engine part)
- Add a description of the effect that is in the effect panel, when you hover it, you get a tooltip that describes what the effect does, like “advantage on dex saves” or “+2 AC” or “speed x2” or “the extra limited action; the lethargy when it ends”
  - This will be possible due to the new effect editor having fields for descriptions

## ISSUES
- Currently, there is no way to make an item grant proficiency or expertise.
- Add a way to add a picture of shopkeeper to the menu (needs design)
- Replicate the design of the shop exactly like in the design (should put this to CLAUDE.md to always try to replicate the designs to the best of their abilities)
- The catalog screens are not scrollable to the right / left, so on laptops the shards are cut off, instead of decresing the size of the buttons, make them scroll if too long
- The LIMITED option on item stock in the shopkeeper editor has the left border missing, the unlimited is fine.
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. (Fix with the effect editor)
- The effect panel has no way to display debuffs, like red entries.

## LEFT TO DO:
COMPLETELY DESIGNED:
- Spell editor in DM-view catalog (designed)
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- Roll context panel, opens with a button in the bottom bar (only for decor currently) (designed)
- Level up characters for DM-view (designed, need to review the design and make sure it is implemented correctly)

SMALL CHANGES TO DESIGN:
- Feature Engine (small change to feature editor in dm-view needed to be designed)
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip), should be like a category or some indicator that you got it from a feature)

NO DESIGN / ONLY PART OF DESIGN:
- Shop Feature (needs design)
- Mobile port (only inventory designed)
- Campaign switcher / character switcher (needs design) (last thing to implement)
- Loot table engine (needs design)

NO NEED TO DESIGN:
- List of premade items
- Implement markdown parsers to most input fields

## DO THIS WEEK
- Shop (Already working on design) - DONE
- Roll context panel (major slice) (only parts that don't need the feature engine)
- Spellbook (minor slice) + Spelleditor (minor slice) (probably won't have the limit for it)

## NEXT WEEK
- Feature engine (major slice)
- Party overview (minor slice)
- Level up characters for DM-view (minor slice)
- Campaign switcher / character switcher (major slice)

## SOMETIME ELSE
- Mobile port (major slice, needs to be done after everything)