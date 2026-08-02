- Implement some sort of party list for the players, so that they know how the rest of their team is doing
something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: hard to implement with more than 4 players, would need some form of automatic scaling
- A shop feature, it pops up on the players screens, they can spend money from their inventory, it will automatically deduct it from their balance
it will automaticall give them the item they purchased, the DM will be able to make these shopkeepers from their dm view, they will have a few presets that will take items
they already created from some categories (they can't sell relics) and the dm will also be able to make their own custom one and save that as a preset
so they can randomly generate a for example potion seller that will sell the potions from the potions list that is in the database 
  - Problems: Need to sync very fast so that when a player purchases something it will be out of stock for the other players already (FIXED BY SERVER SIDE CHECK OF ITEM PURCHASE, FIRST ONE WINS, OTHER GETS OUT OF STOCK POPUP). Increased complexity (maybe performance issues?)
- AN already premade list of items in dnd, not sure where to get it, but this would be for sake of easy use so that the dm doesn't have to create every single item from scratch, like health potions of giant's strength, daggers, swords, pikes and other weapons and armor.
- FIXES
  - The detail text in DM-view → catalog → features editor isn't scrollable, it instead scrolls the actual screen, it should scroll the textbox first and then the screen.
# ISSUES
- Current state of features is that they are only descriptive, they can't grant wisdom boost, effects like healing or anything, question is how to implement a way to actually use these features
Like we would need a list of a lot of things the feature could do, but you also need specific ones for specific ones, like you can't make a list of everything a feature would want. Difficult. Like we have features ranging from Judgment’s Edge: When you hit a creature affected by your Arbiter’s Judgment, deal +1d4  radiant or  necrotic damage (your choice), to Final Strike: You declare a creature’s final judgment. Your next attack against them is an automatic critical hit, and they make death saves with disadvantage if reduced to 0 hit points
There is no easy way to make this happen. This will be a MAJOR slice. ALREADY DESCRIBED IN INVENTORY REFACTOR (??) → MOVE TO OWN DOC
- Issues with display on zen laptop, where the attack button is dangerously close to the description and is almost touching the name of the weapon, fix, make the attack button scale, but then arrow display needs to scale too
- Issues with display on chromium laptop, bottom of the equipment UI is dangerously close to colliding with the bottombar, it has almost no space between.
- These issues all stem from the fact that the smaller screens are just difficult to work with, for the chromium issue making the botoom bar smaller would fix, but the sides are empty and I can't do anything else for zen on laptop