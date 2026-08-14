## PARTY OVERVIEW FEATURE
- Implement some sort of party list for the players, so that they know how the rest of their team is doing something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: if more than 4 players we need some sort of scrolling feature, maybe a small arrow on the side that will scroll the list up and down, or maybe a small scroll bar on the side. This will be a problem for mobile users, so we need to make sure that it is easy to use for them as well. Maybe a swipe up and down feature for mobile users. Also need to make sure that it is not too big, so that it doesn't take up too much space on the screen. Maybe make it collapsible, so that it can be hidden when not needed.
    - Not a problem currently since we are only max 4 players
      - Potentially considering a fifth and sixth player, so we do actually need the scaler (not sure if they will join)

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

## GRAPH ENGINE & ROLL CONTEXT PANEL
- Current state of features is that they are only descriptive, they can't grant wisdom boost, effects like healing or anything, question is how to implement a way to actually use these features Like we would need a list of a lot of things the feature could do, but you also need specific ones for specific ones, like you can't make a list of everything a feature would want. Difficult. Like we have features ranging from Judgment’s Edge: When you hit a creature affected by your Arbiter’s Judgment, deal +1d4  radiant or  necrotic damage (your choice), to Final Strike: You declare a creature’s final judgment. Your next attack against them is an automatic critical hit, and they make death saves with disadvantage if reduced to 0 hit points. There is no easy way to make this happen. This will be a MAJOR slice. ALREADY DESCRIBED IN INVENTORY REFACTOR (??) → MOVE TO OWN DOC ← NAMED FEATURE ENGINE & ADDITIONAL ROLL CONTEXT PANEL, SOME DESCRIPTION IN GITHUB README.md 
- A notification icon in the roll context panel when you roll something that incentivises to open it, like a yellowish or red ping corcle
- FULL DOC MADE, NOW DESIGN

## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN

## BETTER IMAGE UPLOADS
- Like so you don't have to use the sql for it.

## TURN TRACKER (not a VTT)
- A turn tracker per-player button that when you press effects like poison get sent to the roll context panel that remind the player they took 1d6 damage (can roll in there) the button just “advances” the players turn, no tracking actual combat. The effects then need to be able to read the turn has advanced and remind themselves. Inspiration from dicecloud

## QOL ADDITIONS
- A notification icon in the roll context panel when you roll something that incentivizes to open it, like a yellowish or red ping corcle (Also written in feature engine part) — DEFERRED, roll context panel is still a "Coming Soon" stub, this ships with it
- Add a description of the effect that is in the effect panel, when you hover it, you get a tooltip that describes what the effect does, like “advantage on dex saves” or “+2 AC” or “speed x2” or “the extra limited action; the lethargy when it ends”
  - This will be possible due to the new effect editor having fields for descriptions — DEFERRED, needs the Effect Library built first (see that section above)

## ISSUES
- Currently, there is no way to make an item grant proficiency or expertise.
- Add a way to add a picture of shopkeeper to the menu (needs design).
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. (Fix with the effect editor)

## LEFT TO DO:
COMPLETELY DESIGNED:
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- Roll context panel, opens with a button in the bottom bar (only for decor currently) (designed)
- Level up characters for DM-view (designed, need to review the design and make sure it is implemented correctly)

SMALL CHANGES TO DESIGN:
- Graph Engine (Missing graph panel)
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip), should be like a category or some indicator that you got it from a feature)

NO DESIGN / ONLY PART OF DESIGN:
- Mobile port (only inventory designed)
- Campaign switcher / character switcher (needs design) (last thing to implement)
- Loot table engine (needs design)

NO NEED TO DESIGN:
- List of premade items
- Implement markdown parsers to most input fields
