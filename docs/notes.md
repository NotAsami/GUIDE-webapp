## ADD CAMPAIGN SWITCHER
- Add a way to categorize characters to their respective campaign and the ability for the player to have multiple characters, if they have 2, they will get a popup on login to select the character they want. The DM then needs to have the ability switch between campaigns and see the characters that are in that campaign. This will be a major slice, but it will be a good way to organize the characters and campaigns, also the ability to create multiple characters (seed multiple characters) for 1 account. NEEDS A DESIGN
- Worth designing it as "a campaign has settings", so you can edit the theming too.

## BETTER IMAGE UPLOADS
- Like so you don't have to use the sql for it. (probably on each character portrait or thing that has an image, you get an input for image files)

## NOT DONE:
- Nested target conditions `(tag:"fire" & roll:"damage.melee") | tag:"epic_spell"` — the `or`/`and` toggle shipped; the NESTED form is designed, costed and deferred in `GUIDE_Codex_Deferred.md` with a named trigger (two workaround effects both matching at once, so the contribution lands twice). Not open work — waiting on its trigger.

## ISSUES
- Add a way to add a picture of shopkeeper to the menu (needs design (both shopkeeper editor & the actual menu) + better image uploads)
- We would replace the effect picker in the spell editor when the spell can target allies with the updated form, where you only get a searchbar and a list to pick, because you set if the effect is a buff or debuff in the effect editor, we still need to cover heal though.
- Spells that grant effects don’t currently do anything except give an indicator to the effects panel, update the effect granter when effect editor is built. — **OPEN, and unscoped.** The effect editor exists; what "integration" means does not: which effects a spell may grant, whether casting applies them, and how they expire. Needs reading before building.
- §19's `AmmoBonus` deletion is still owed: nocked ammunition adds a flat, named bonus through its own path rather than being a graph contributor like everything else. Blocked on "what does active mean for a carried item" in `GUIDE_Codex_Deferred.md` — a nocked stack is *carried*, not equipped.
- Roll initiative, (only the D20 + whatever number, this will also synergize with the Persistent rage feature.)
- Notes (feature editor) don't resolve markdown in the roll context panel.
- Feature editor should have Reset on turn in the reset picker (short and long rest) so you don't have to make variables to reset on advancing turn.
- The filters on the feature panel should be on the same line as the usable & passive filters, so it doesn't take up valuable space on the laptops and to fill the empty space on the right of them.
- In the handouts menus, what is "On screen" and "filed" like even if you close the handout that was popped out "on screen" its still filed under "on screen" can only the DM change that?
- The new NPCs only show up on the web-map, not on the actual relations in the "lore screen"
- Update the handout paper look

## GRAND UNIFICATION
- A centralized editor for everything (except shards). Effects, features, spells, items, shopkeepers, loot tables. Exactly like in Dicecloud, where you first set what each node is supposed to be and then edit from there, like you set an item node, and you get stuff regarding items in the editor. Exactly like in Dicecloud (last, post launch, just QOL)

## NODE BASED FEATURE EDITOR
Node-based is a genuinely good fit, and for a specific reason:  data already is a graph. The variable DAG is literally nodes and wires — mercy and condemnation flowing into judgementDelta, into three canSwitchTo checks, into nextJudgementState. A form hides that shape; nodes show it. And "I understand the pieces but can't put them together" is precisely the problem node editors exist to solve, because composition becomes visible wiring instead of something you hold in your head.
It also gets you something forms can't: type-checked ports. The engine's rules — contributions never feed contributions, variables never read roll context — become connections the editor simply refuses to make. The grammar gets enforced by what you can physically wire.
The one caution: nodes are great for Sanctity and worse than a form for Second Wind. So make them two views of1 the same data — simple features stay in the form, complex ones open as a graph. No migration, no choice forced. And your shard lattice editor already solved pan, zoom, and node hit-testing, so there's a head start.

## MORE THINGS
The medieval skin — illuminated manuscript, gold leaf on parchment.
A printable character sheet, styled as a G.U.I.D.E. dossier printout.

## EVOLUTION
Evolution. The core horror mechanic from your original pitch — invest enough points, evolve, gain power, lose something. Glitch marks, ones and zeroes on the body. It's the campaign's centrepiece and it has no screen.
Death and respawn. Each death pulls you closer to digitization, and respawn points drift from the city to rooftops to falling from the sky. G.U.I.D.E. reconstituting you is a gorgeous screen.
The corrupted skin. The whole app degrading as Cerberus takes hold — flickering labels, amber creeping in, helpful text turning wrong. The corrupted broadcast tone exists; the corrupted app doesn't.
The reveal. What the interface looks like the moment the players learn what G.U.I.D.E. is.
First boot — the villain's warm welcome, as onboarding.

## GAPS WHILE PORTING ARBITER
- Magical Bonus: +1 to attack and damage rolls, increases with Path features, which put the bonus to +2 on 10 points, and ect. Possible now?

## LEFT TO DO:
SMALL CHANGES TO DESIGN:
- Spellbook (designed, needs a category for spells from features though ("use sanctuary on will" → no need for spellslot (cantrip), should be like a category or some indicator that you got it from a feature)

NO DESIGN / ONLY PART OF DESIGN:
- Mobile port (only inventory designed)
- Campaign switcher / character switcher (needs design) (last thing to implement)
