## PARTY OVERVIEW FEATURE
- Implement some sort of party list for the players, so that they know how the rest of their team is doing something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: if more than 4 players we need some sort of scrolling feature, maybe a small arrow on the side that will scroll the list up and down, or maybe a small scroll bar on the side. This will be a problem for mobile users, so we need to make sure that it is easy to use for them as well. Maybe a swipe up and down feature for mobile users. Also need to make sure that it is not too big, so that it doesn't take up too much space on the screen. Maybe make it collapsible, so that it can be hidden when not needed.
    - Not a problem currently since we are only max 4 players
## SHOP FEATURE
- A shop feature, it pops up on the players screens, they can spend money from their inventory, it will automatically deduct it from their balance it will automatically give them the item they purchased, the DM will be able to make these shopkeepers from their dm view, they will have a few presets that will take items they already created from some categories (they can't sell relics) and the dm will also be able to make their own custom one and save that as a preset so they can randomly generate a for example potion seller that will sell the potions from the potions list that is in the database. Integrates with the Loot table engine slice.
  - Problems: ~~Need to sync very fast so that when a player purchases something it will be out of stock for the other players already~~ (FIXED BY SERVER SIDE CHECK OF ITEM PURCHASE, FIRST ONE WINS, OTHER GETS OUT OF STOCK POPUP). Increased complexity (maybe performance issues?)
- An already premade list of items in dnd, not sure where to get it, but this would be for sake of easy use so that the dm doesn't have to create every single item from scratch, like health potions of giant's strength, daggers, swords, pikes and other weapons and armor.
## FEATURE ENGINE & ROLL CONTEXT PANEL
- Current state of features is that they are only descriptive, they can't grant wisdom boost, effects like healing or anything, question is how to implement a way to actually use these features Like we would need a list of a lot of things the feature could do, but you also need specific ones for specific ones, like you can't make a list of everything a feature would want. Difficult. Like we have features ranging from Judgment’s Edge: When you hit a creature affected by your Arbiter’s Judgment, deal +1d4  radiant or  necrotic damage (your choice), to Final Strike: You declare a creature’s final judgment. Your next attack against them is an automatic critical hit, and they make death saves with disadvantage if reduced to 0 hit points. There is no easy way to make this happen. This will be a MAJOR slice. ALREADY DESCRIBED IN INVENTORY REFACTOR (??) → MOVE TO OWN DOC ← NAMED FEATURE ENGINE & ADDITIONAL ROLL CONTEXT PANEL, SOME DESCRIPTION IN GITHUB README.md 
## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN
## ISSUES
- The stat shard has overlapping text if bonus to constitution or intelligence, the text is too long and the +2 or +1 is overlapping with it
- If you slot a shard, upgrade it and then unslot said shard, it doesn't save what you had upgraded.
- The shard picker: after pressing the + button it should bring up a picker (designed in G.U.I.D.E. Shards.html on claude design)
## LEFT TO DO:
COMPLETELY DESIGNED:
- Spell editor in DM-view catalog (designed)
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- Roll context panel, opens with a button in the bottom bar (only for decor currently) (designed)

SMALL CHANGES TO DESIGN:
- Feature Engine (small change to feature editor in dm-view needed to be designed)
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip))

NO DESIGN / ONLY PART:
- Level up characters for DM-view (needs design)
- Shop Feature (needs design)
- Mobile port (only inventory designed)
