-- Equipment test fixtures — generic, removable gear so the equip/unequip flow
-- is visible. These are SRD-standard mechanical items (NOT the mockup's invented
-- lore: no Castellan Claymore / Brettany Plate / Ring of Ember). All 'common'.
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run (the character row
-- already exists; seed.sql uses `on conflict do nothing`, so this is a patch).
-- Re-running RESETS inventory + the armor slot to this fixture state.
--
-- Demonstrates:
--   • click Helmet / Boots / Cloak (empty) -> selector lists the matching
--     inventory item -> Equip moves it into the slot.
--   • click Armor (pre-equipped Chain Shirt) -> detail + Unequip button.
--   • "+ Equip Weapon" -> picker lists the Longsword -> Equip (auto off-hand,
--     since the Dagger holds the main hand).
--   • Each weapon card has an Attack button -> rolls attack + damage as one
--     action -> the result toast pops bottom-right.
--   • Equip the "Band of Vigor" accessory -> STR jumps 18 -> 20 (and the green
--     buff badge shows on the Stat Panel), AC +1, and the weapon attack/damage
--     numbers track the boosted STR. Unequip reverts — effects are display-only,
--     never written into the base sheet.
--   • Quick Access slot 0 (Potion of Healing) -> click -> Use: rolls 2d4+2,
--     raises real HP (toast shows the heal), spends one of three.
--   • Quick Access slot 1 is empty -> click "+" -> picker lists inventory
--     consumables (Potion of Vigor, Antitoxin) -> Add moves one into the slot.
--   • Use Potion of Vigor: applies +1 STR and +10 ft speed as a status effect.
--     Open the Effects sidebar (gear-grid button) to see it; × ends it early, a
--     future Rest clears all. Speed jumps on the quick-view; STR on the Stat Panel.
-- Wipe later when the DM grants real gear: set inventory='[]', and reset the
-- armor + weapons slots.

update characters set
  inventory = jsonb_build_array(
    jsonb_build_object(
      'id', 'helm-iron', 'name', 'Iron Helm', 'slot', 'helmet',
      'rarity', 'common', 'icon', 'fa-helmet-safety',
      'rows', jsonb_build_array(
        jsonb_build_array('Type', 'Head'),
        jsonb_build_array('Weight', '3 lbs.')),
      'flavor', 'Standard banded-iron infantry helm.'
    ),
    jsonb_build_object(
      'id', 'boots-leather', 'name', 'Leather Boots', 'slot', 'boots',
      'rarity', 'common', 'icon', 'fa-shoe-prints',
      'rows', jsonb_build_array(
        jsonb_build_array('Type', 'Feet'),
        jsonb_build_array('Weight', '2 lbs.')),
      'flavor', 'Hardened marching boots, twice re-soled.'
    ),
    jsonb_build_object(
      'id', 'cloak-traveler', 'name', 'Traveler''s Cloak', 'slot', 'cloak',
      'rarity', 'common', 'icon', 'fa-user-tie',
      'rows', jsonb_build_array(
        jsonb_build_array('Type', 'Back'),
        jsonb_build_array('Weight', '3 lbs.')),
      'flavor', 'Plain oilskin cloak. Sheds rain.'
    ),
    -- Weapon in inventory -> equippable via the "+ Equip Weapon" picker.
    jsonb_build_object(
      'id', 'wpn-longsword', 'name', 'Longsword', 'category', 'weapon',
      'rarity', 'common', 'icon', 'fa-khanda',
      'ability', 'str', 'damageDice', '1d8', 'type', 'Slashing',
      'properties', jsonb_build_array('Versatile (1d10)'),
      'flavor', 'A soldier''s arming sword, edge freshly honed.'
    ),
    -- Accessory carrying numeric EFFECTS: layered over the base sheet while worn
    -- (STR +2, AC +1) and reverted on unequip. Proves effect layering end-to-end.
    jsonb_build_object(
      'id', 'acc-band-vigor', 'name', 'Band of Vigor', 'slot', 'accessory',
      'rarity', 'uncommon', 'icon', 'fa-ring',
      'rows', jsonb_build_array(
        jsonb_build_array('Bonus', '+2 STR'),
        jsonb_build_array('Bonus', '+1 AC'),
        jsonb_build_array('Type', 'Trinket')),
      'effects', jsonb_build_object(
        'abilities', jsonb_build_object('str', 2),
        'ac', 1),
      'flavor', 'A warm iron band that lends the wearer a giant''s steadiness.',
      'attune', 'Required'
    ),
    -- Consumables in inventory -> add to an empty Quick Access slot via the picker.
    jsonb_build_object(
      'id', 'pot-vigor', 'name', 'Potion of Vigor', 'category', 'consumable',
      'rarity', 'uncommon', 'icon', 'fa-wand-sparkles', 'qty', 1,
      'duration', '10 rounds',
      'effects', jsonb_build_object(
        'abilities', jsonb_build_object('str', 1),
        'speed', 10),
      'flavor', 'A bracing draught that floods the limbs with brief strength and speed.'
    ),
    jsonb_build_object(
      'id', 'pot-antitoxin', 'name', 'Antitoxin', 'category', 'consumable',
      'rarity', 'common', 'icon', 'fa-vial', 'qty', 2,
      'flavor', 'Neutralizes a single poison. No lasting bonus — a flavour-only use.'
    )
  ),
  equipped = equipped || jsonb_build_object(
    'armor', jsonb_build_object(
      'id', 'armor-chain', 'name', 'Chain Shirt', 'slot', 'armor',
      'rarity', 'common', 'icon', 'fa-shield-halved',
      'rows', jsonb_build_array(
        jsonb_build_array('AC', '13 + DEX (max 2)'),
        jsonb_build_array('Type', 'Medium Armor'),
        jsonb_build_array('Weight', '20 lbs.')),
      'flavor', 'Interlocking steel rings worn under a tunic.',
      'attune', 'Not required'
    ),
    -- Pre-equipped weapon so the Attack button is testable on first load.
    'weapons', jsonb_build_array(
      jsonb_build_object(
        'id', 'wpn-dagger', 'name', 'Dagger', 'category', 'weapon',
        'hand', 'main', 'rarity', 'common', 'icon', 'fa-khanda',
        'ability', 'finesse', 'damageDice', '1d4', 'type', 'Piercing',
        'properties', jsonb_build_array('Finesse', 'Light', 'Thrown (20/60)'),
        'flavor', 'A balanced parrying dagger.'
      )
    ),
    -- Quick-access consumables: slot 0 pre-filled (click -> Use), slot 1 left
    -- empty so the "+" opens the picker to add a consumable from inventory.
    'quickAccess', jsonb_build_array(
      -- Instant heal: rolls 2d4 + 2, writes real HP, spends one (qty 3 -> 0).
      jsonb_build_object(
        'id', 'pot-healing', 'name', 'Potion of Healing', 'category', 'consumable',
        'rarity', 'common', 'icon', 'fa-flask', 'qty', 3, 'heal', '2d4 + 2',
        'flavor', 'Red, faintly sweet. The standard field restorative.'
      ),
      null
    )
  ),
  -- Clear any stale active effects from earlier tests.
  resources = resources || jsonb_build_object('activeEffects', '[]'::jsonb)
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- Sanity check.
select inventory,
       equipped->'armor' as armor,
       equipped->'weapons' as weapons,
       equipped->'quickAccess' as quick_access,
       resources->'activeEffects' as active_effects
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
