## PARTY OVERVIEW FEATURE
- An overview of the party that is sitting in the nav-bar, on the left and the right.
- Needed to make a simplified version for the navbar, more one is in the codex screen (/)

## LOOT GENERATOR ENGINE
DM view: Add a loot generator feature, you create a list of things you want to randomly give, like for example a chest, peasant corpse, knight corpse. Each would have a list like:
Chainmail Boots x1 30%
Amulet of strength x1 2%
Arrows x1-10 50%
Torch x1 40%
Rations x2 28%
…
The DM can define a list that would then parse these lists, choose what items to give based on the percentage and the amount (1-10 for arrows) and would then grant the player the items chosen from the list. When we do the list of predefined items, we can also do a list of predefined generators for chests, shelves, bookshelves, corpses. The generator should be able to store multiple lists. This would also benefit our store maker, which could use the same or slightly modified version of the generator

## UPDATE ALL THE DOCS
- Long overdue

## PREMADE LIST OF ITEMS
- An already premade list of items in dnd, not sure where to get it, but this would be for sake of easy use so that the dm doesn't have to create every single item from scratch, like health potions of giant's strength, daggers, swords, pikes and other weapons and armor.

## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN
- Worth designing it as "a campaign has settings", so you can edit the theming too.

## ADD A DM-CONSOLE BUTTON
- So the dm doesn't have to go to the url to get to the dm console.

## BETTER IMAGE UPLOADS
- Like so you don't have to use the sql for it. (probably on each character portrait or thing that has an image, you get an input for image files)

## QOL
- A utility for the DM to search the database tags, like if you search "Sanctity" in the panel or like utility thing (not sure how it'll look like??) you will get sanctity, you click on it and it shows you the tags and such of that item
- Clicking on the error in the feature audit in all editors should take you to the field that has the error, so you can fix it without having to search for it.

## UNSTYLED SCROLLBARS
- The scrollbars being unstyled happens on multiple widgets and screens, we should fix all of them.
- Present on the stat-panel screen.

## ISSUES
- Add a way to add a picture of shopkeeper to the menu (needs design (both shopkeeper editor & the actual menu) + better image uploads)
  - We would replace the effect picker in the spell editor when the spell can target allies with the updated form, where you only get a searchbar and a list to pick, because you set if the effect is a buff or debuff in the effect editor, we still need to cover heal though.
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. — **OPEN, and unscoped.** The effect editor exists; what "integration" means does not: which effects a spell may grant, whether casting applies them, and how they expire. Needs reading before building.
- Nested target conditions `(tag:"fire" & roll:"damage.melee") | tag:"epic_spell"` — the `or`/`and` toggle shipped; the NESTED form is designed, costed and deferred in `GUIDE_Codex_Deferred.md` with a named trigger (two workaround effects both matching at once, so the contribution lands twice). Not open work — waiting on its trigger.
- §19's `AmmoBonus` deletion is still owed: nocked ammunition adds a flat, named bonus through its own path rather than being a graph contributor like everything else. Blocked on "what does active mean for a carried item" in `GUIDE_Codex_Deferred.md` — a nocked stack is *carried*, not equipped.
- Pick a thing picker in the feature editor is off the screne, it's too big, make it smaller and the scrollbar is not styled.
- When you open the "wiki" on the roll context panel (you press the link to the weapon, spell ect) you get a display of what interacts with it, it should link said feature to the feature tab for further inspection, so instead of:

Condemning Strike Condeming Strike
  Hit with Sanctity

You would get:
 
[Condemning Strike](link to feature tab)

Sum like that
- Shortbow lost the ammo picker even though it's marked as ranged.
- MORE ICONS! And each editor should have the same icon list as the others, for example the feature editor has more icons than the class and item editors.
- You can't set the reputation of the players
- The stat-panel is scrollable, which means it extends into the navbar when you scroll down, that's good, but the navbar should have a background or something like on the equipment panel which also scrolls if your screen is too small.
- Can't change the character story, main story & region progress numbers nor the popup text on hover.

## DECISIONS WORTH KEEPING
- The roll context panel is a **modal with a scrim**, so it can never be sticky as built. A genuinely sticky panel would have to stop being a modal — drop the scrim, drop `aria-modal`, and give the 436px rail its own column in the Layout grid. Deliberately not wanted for now; the toast and the counted badge cover it.
- *"Perception checks made to see you have disadvantage"* is a modifier on **someone else's** roll, which the engine cannot express — it resolves this character's rolls only. Use a `note`; recorded in `GUIDE_Codex_Deferred.md`.

## GRAND UNIFICATION
- A centralized editor for everything (except shards). Effects, features, spells, items, shopkeeprs, loot tables. Exactly like in Dicecloud, where you first set what each node is supposed to be and then edit from there, like you set an item node and you get stuff regarding items in the editor. Exactly like in Dicecloud (last, post launch, just QOL)

## MARKDOWN INPUT FIELDS
- Implement to all input fields that are prose or don't need to resolve to anything or you know in which it makes sense, color support, bold, italics, markdown links [](), etc.
- CTRL + B for bold, CTRL + I for italics, CTRL + K for links, etc.

## GAPS WHILE PORTING ARBITER
- Sanctity has: Ability Mod: You may use Wisdom instead of Strength or Dexterity for attack rolls, but you currently can't set that in the item editor.
- Magical Bonus: +1 to attack and damage rolls, increases with Path features, which put the bonus to +2 on 10 points, and ect. Possible now?

## LEFT TO DO:
COMPLETELY DESIGNED:
- Party overview in the nav-bar or somewhere else, not sure where though, maybe a panel like the roll-context panel? (designed)
- Level up characters for DM-view (designed, need to review the design and make sure it is implemented correctly)

SMALL CHANGES TO DESIGN:
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip), should be like a category or some indicator that you got it from a feature)

NO DESIGN / ONLY PART OF DESIGN:
- Mobile port (only inventory designed)
- Campaign switcher / character switcher (needs design) (last thing to implement)
- Loot table engine (needs design)
- Class editor
- Race editor

NO NEED TO DESIGN:
- List of premade items
- Implement markdown parsers to most input fields (see ## MARKDOWN INPUT FIELDS)

---

## NEXT
Open field. The Turn Tracker shipped; what remains on the ISSUES list is
shopkeeper pictures (image work), spell-granted effects (unscoped), and §19's
AmmoBonus deletion (blocked on the carried-item question).
