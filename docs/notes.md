- Implement some sort of party list for the players, so that they know how the rest of their team is doing
something like in fortnite or other fps games. **DESIGN ALREADY CREATED IN CLAUDE DESIGN!**
  - Problems: hard to implement with more than 4 players, would need some form of automatic scaling
- A shop feature, it pops up on the players screens, they can spend money from their inventory, it will automatically deduct it from their balance
it will automaticall give them the item they purchased, the DM will be able to make these shopkeepers from their dm view, they will have a few presets that will take items
they already created from some categories (they can't sell relics) and the dm will also be able to make their own custom one and save that as a preset
so they can randomly generate a for example potion seller that will sell the potions from the potions list that is in the database 
  - Problems: Need to sync very fast so that when a player purchases something it will be out of stock for the other players already (FIXED BY SERVER SIDE CHECK OF ITEM PURCHASE, FIRST ONE WINS, OTHER GETS OUT OF STOCK POPUP). Increased complexity (maybe performance issues?)
- A already premade list of items in dnd, not sure where to get it, but this would be for sake of easy use so that the dm doesn't have to create every single item from scratch, like health potions
potions of giant's strength, daggers, swords, pikes and other weapons and armor.
- QOL UPDATE TO INVENTORY & FIXES:
  - Currently, there is no way to put an item from a backpack to the bag of holding or sack, and vice versa, if you want to transfer them, you need to retrieve it from the backpack into ON PERSON, and then put it into the other container, very annoying
  - A bug from the eariler version of the inventory crept in, the inventory has a slight gap between the items, so when you hover over each the tooltip shows, then disappears while crossing the gap and then reappears on the next item, fix would be to increase the hover radius
  - On larger screens with 110% zoom which is needed for me at least because the screens are dense and sometimes smaller than I would like for my reading, the DM view categories have their bottom part cut off, so the line isn't rendered, categories include: Party Overview, Quest log, Session log, Catalog. 
  - Issue is occuring with the "PLAYER-FACING" widget that is next to the description of the item, it doesn't have the angled lines. This appears with items that have the ATTACK ABILITY, DAMAGE DICE, DAMAGE TYPE, HEAL ON USE, DURATION input fields below the icon, so with consumable and weapon type of items.
  - The RECHARGE picker in the features catalog editor has the bottom part cut off on 110% zoom.
  - The ICON in the top left of the DM-view has a strange shadow on the bottom part on 110% zoom.
- QUESTION ABOUT ARROWS
  - Do the different types of arrows do anything? Do they increase damage, apply effects? It would be nice to get a tooltip when hovering the arrows in the quiver to see what the arrow does.
  - Currently, the ammo picker doesn't read from ON-PERSON, so if you have arrows on your person, but you don't have a quiver, the ammo isn't read.
  - The ranged weapons still let you attack even if you don't have arrows.
# ISSUES
- Current state of features is that they are only descriptive, they can't grant wisdom boost, effects like healing or anything, question is how to implement a way to actually use these features
Like we would need a list of a lot of things the feature could do, but you also need specific ones for specific ones, like you can't make a list of everything a feature would want. Difficult. Like we have features ranging from Judgement’s Edge: When you hit a creature affected by your Arbiter’s Judgement, deal +1d4  radiant or  necrotic damage (your choice), to Final Strike: You declare a creature’s final judgment. Your next attack against them is an automatic critical hit, and they make death saves with disadvantage if reduced to 0 hit points
There is no easy way to make this happen. This will be a MAJOR slice. ALREADY DESCRIBED IN INVENTORY REFACTOR (??) -> MOVE TO OWN DOC
- Issues with display on zen laptop, where the attack button is dangerously close to the description and is almost touching the name of the weapon, fix, make the attack button scale, but then arrow display needs to scale too
- Issues with display on chromium laptop, bottom of the equipment UI is dangerously close to colliding with the bottombar, it has almost no space between.
- These issues all stem from the fact that the smaller screens are just difficult to work with, for the chromium issue making the botoom bar smaller would fix, but the sides are empty and I can't do anything else for zen on laptop