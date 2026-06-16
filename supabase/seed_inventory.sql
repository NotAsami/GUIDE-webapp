-- Inventory fixtures for the Inventory carry-grid (`inventory` column).
--
-- A spread of STANDARD SRD equipment so the screen, the equip flow and Burden are
-- demonstrable. Like the other seeds, this invents NO lore: every item, weight,
-- damage die and effect is straight SRD (PHB equipment + DMG magic items). Magic
-- items use only the numeric `effects` the engine models (ac / saves / abilitySet);
-- descriptive perks (e.g. Cloak of Elvenkind's stealth advantage) stay as flavor.
--
-- Grid fields: `w`/`h` = footprint in cells (default 1x1); `col`/`row` are omitted
-- so the grid auto-packs them — drag to rearrange, the positions then persist.
-- Weights drive Burden (carried + equipped vs STR x 15 capacity).
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run. Re-running RESETS the
-- inventory to exactly this list (anything currently equipped stays equipped).

update characters set
  inventory = jsonb_build_array(

    -- ---- weapons (equip into a hand) ----
    jsonb_build_object(
      'id', 'inv-longsword', 'name', 'Longsword', 'category', 'weapon',
      'rarity', 'common', 'icon', 'fa-khanda', 'weight', 3, 'w', 1, 'h', 2,
      'ability', 'str', 'damageDice', '1d8', 'type', 'Slashing',
      'properties', jsonb_build_array('Versatile (1d10)'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d8 slashing'),
        jsonb_build_array('Properties', 'Versatile')),
      'flavor', 'A standard arming sword — reliable in one hand or two.'
    ),
    jsonb_build_object(
      'id', 'inv-handaxe', 'name', 'Handaxe', 'category', 'weapon',
      'rarity', 'common', 'icon', 'fa-hammer', 'weight', 2, 'w', 1, 'h', 1,
      'ability', 'str', 'damageDice', '1d6', 'type', 'Slashing',
      'properties', jsonb_build_array('Light', 'Thrown (20/60)'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d6 slashing'),
        jsonb_build_array('Properties', 'Light, Thrown'))
    ),
    jsonb_build_object(
      'id', 'inv-shortbow', 'name', 'Shortbow', 'category', 'weapon',
      'rarity', 'common', 'icon', 'fa-bullseye', 'weight', 2, 'w', 1, 'h', 2,
      'ability', 'dex', 'damageDice', '1d6', 'type', 'Piercing',
      'properties', jsonb_build_array('Ammunition (80/320)', 'Two-Handed'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d6 piercing'),
        jsonb_build_array('Range', '80 / 320'))
    ),

    -- ---- worn gear (equip into a slot) ----
    jsonb_build_object(
      'id', 'inv-chain-mail', 'name', 'Chain Mail', 'category', 'gear',
      'slot', 'armor', 'rarity', 'common', 'icon', 'fa-shirt',
      'weight', 55, 'w', 2, 'h', 2,
      'rows', jsonb_build_array(
        jsonb_build_array('Armor Class', '16'),
        jsonb_build_array('Type', 'Heavy'),
        jsonb_build_array('Stealth', 'Disadvantage')),
      'flavor', 'Interlocking rings over a layer of quilted fabric. Heavy, loud, dependable.'
    ),
    jsonb_build_object(
      'id', 'inv-ring-protection', 'name', 'Ring of Protection', 'category', 'gear',
      'slot', 'accessory', 'rarity', 'rare', 'icon', 'fa-ring',
      'weight', 0, 'w', 1, 'h', 1,
      'attune', 'Ring of Protection',
      'effects', jsonb_build_object('ac', 1, 'saves', 1),
      'rows', jsonb_build_array(
        jsonb_build_array('AC', '+1'),
        jsonb_build_array('Saves', '+1 all')),
      'flavor', 'A plain silver band that turns aside the worst of a blow.'
    ),
    jsonb_build_object(
      'id', 'inv-cloak-elvenkind', 'name', 'Cloak of Elvenkind', 'category', 'gear',
      'slot', 'cloak', 'rarity', 'uncommon', 'icon', 'fa-user-tie',
      'weight', 1, 'w', 2, 'h', 1,
      'attune', 'Cloak of Elvenkind',
      'rows', jsonb_build_array(
        jsonb_build_array('Perception', 'Disadv. to see you'),
        jsonb_build_array('Stealth', 'Advantage')),
      'flavor', 'Shifting grey-green cloth that blurs the edges of you. Pull the hood up to fade.'
    ),

    -- ---- consumables (Use from the bag, or stow in Quick Access) ----
    jsonb_build_object(
      'id', 'inv-potion-healing', 'name', 'Potion of Healing', 'category', 'consumable',
      'rarity', 'common', 'icon', 'fa-flask', 'weight', 0.5, 'w', 1, 'h', 1,
      'qty', 3, 'heal', '2d4 + 2',
      'rows', jsonb_build_array(jsonb_build_array('Restores', '2d4 + 2 HP')),
      'flavor', 'Red, faintly sweet. Drink as an action to knit wounds.'
    ),
    jsonb_build_object(
      'id', 'inv-potion-hill-giant', 'name', 'Potion of Hill Giant Strength', 'category', 'consumable',
      'rarity', 'uncommon', 'icon', 'fa-flask', 'weight', 0.5, 'w', 1, 'h', 1,
      'qty', 1, 'duration', '1 hour',
      'effects', jsonb_build_object('abilitySet', jsonb_build_object('str', 21)),
      'rows', jsonb_build_array(
        jsonb_build_array('Sets STR', '21'),
        jsonb_build_array('Duration', '1 hour')),
      'flavor', 'Cloudy liquid with a bit of giant fingernail at the bottom. Your STR becomes 21 for an hour.'
    ),

    -- ---- adventuring kit (misc — weight only, no equip/use) ----
    jsonb_build_object(
      'id', 'inv-rations', 'name', 'Rations', 'category', 'misc',
      'rarity', 'common', 'icon', 'fa-drumstick-bite', 'weight', 2, 'w', 1, 'h', 1,
      'qty', 5, 'rows', jsonb_build_array(jsonb_build_array('Use', '1 day of food'))
    ),
    jsonb_build_object(
      'id', 'inv-torch', 'name', 'Torch', 'category', 'misc',
      'rarity', 'common', 'icon', 'fa-fire', 'weight', 1, 'w', 1, 'h', 1,
      'qty', 3, 'rows', jsonb_build_array(jsonb_build_array('Light', '20 ft bright'))
    ),
    jsonb_build_object(
      'id', 'inv-rope', 'name', 'Hempen Rope (50 ft)', 'category', 'misc',
      'rarity', 'common', 'icon', 'fa-link', 'weight', 10, 'w', 1, 'h', 1,
      'rows', jsonb_build_array(jsonb_build_array('Length', '50 ft'))
    ),
    jsonb_build_object(
      'id', 'inv-bedroll', 'name', 'Bedroll', 'category', 'misc',
      'rarity', 'common', 'icon', 'fa-bed', 'weight', 7, 'w', 2, 'h', 1
    )

  )
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- Sanity check: item count + total carried weight.
select jsonb_array_length(inventory) as item_count,
       (select sum((coalesce((i->>'weight')::numeric, 0)) * coalesce((i->>'qty')::numeric, 1))
          from jsonb_array_elements(inventory) i) as carried_weight_lb
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
