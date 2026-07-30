-- Item catalog seed (Phase 2 slice 5). Paste into the Supabase SQL editor and Run.
--
-- Seeds the DM's authoring library with the same SRD templates the player already
-- carries (see seed_inventory.sql) so the catalog starts populated and Grant Item
-- has something to hand out on day one. Each row's `data` is the item definition
-- MINUS per-instance state (id/qty/col/row) — Grant Item stamps those on per copy.
--
-- Idempotent: re-running RESETS each template's data to exactly this (upsert by id).
-- It does NOT touch already-granted copies in anyone's inventory (snapshots), which
-- is the intended behaviour until the live-hydration refactor lands.

insert into item_catalog (id, data) values

  ('cat-longsword', jsonb_build_object(
    'name', 'Longsword', 'category', 'weapon', 'rarity', 'common', 'icon', 'fa-khanda',
    'weight', 3, 'w', 1, 'h', 2, 'ability', 'str', 'damageDice', '1d8', 'type', 'Slashing',
    'properties', jsonb_build_array('Versatile (1d10)'),
    'rows', jsonb_build_array(
      jsonb_build_array('Damage', '1d8 slashing'),
      jsonb_build_array('Properties', 'Versatile')),
    'flavor', 'A standard arming sword — reliable in one hand or two.')),

  ('cat-handaxe', jsonb_build_object(
    'name', 'Handaxe', 'category', 'weapon', 'rarity', 'common', 'icon', 'fa-hammer',
    'weight', 2, 'w', 1, 'h', 1, 'ability', 'str', 'damageDice', '1d6', 'type', 'Slashing',
    'properties', jsonb_build_array('Light', 'Thrown (20/60)'),
    'rows', jsonb_build_array(
      jsonb_build_array('Damage', '1d6 slashing'),
      jsonb_build_array('Properties', 'Light, Thrown')))),

  ('cat-shortbow', jsonb_build_object(
    'name', 'Shortbow', 'category', 'weapon', 'rarity', 'common', 'icon', 'fa-bullseye',
    'weight', 2, 'w', 1, 'h', 2, 'ability', 'dex', 'damageDice', '1d6', 'type', 'Piercing',
    'properties', jsonb_build_array('Ammunition (80/320)', 'Two-Handed'),
    'rows', jsonb_build_array(
      jsonb_build_array('Damage', '1d6 piercing'),
      jsonb_build_array('Range', '80 / 320')))),

  ('cat-chain-mail', jsonb_build_object(
    'name', 'Chain Mail', 'category', 'gear', 'slot', 'armor', 'rarity', 'common', 'icon', 'fa-shirt',
    'weight', 55, 'w', 2, 'h', 2,
    'rows', jsonb_build_array(
      jsonb_build_array('Armor Class', '16'),
      jsonb_build_array('Type', 'Heavy'),
      jsonb_build_array('Stealth', 'Disadvantage')),
    'flavor', 'Interlocking rings over a layer of quilted fabric. Heavy, loud, dependable.')),

  ('cat-ring-protection', jsonb_build_object(
    'name', 'Ring of Protection', 'category', 'gear', 'slot', 'accessory', 'rarity', 'rare', 'icon', 'fa-ring',
    'weight', 0, 'w', 1, 'h', 1, 'attune', 'Ring of Protection',
    'effects', jsonb_build_object('ac', 1, 'saves', 1),
    'rows', jsonb_build_array(
      jsonb_build_array('AC', '+1'),
      jsonb_build_array('Saves', '+1 all')),
    'flavor', 'A plain silver band that turns aside the worst of a blow.')),

  ('cat-cloak-elvenkind', jsonb_build_object(
    'name', 'Cloak of Elvenkind', 'category', 'gear', 'slot', 'cloak', 'rarity', 'uncommon', 'icon', 'fa-user-tie',
    'weight', 1, 'w', 2, 'h', 1, 'attune', 'Cloak of Elvenkind',
    'rows', jsonb_build_array(
      jsonb_build_array('Perception', 'Disadv. to see you'),
      jsonb_build_array('Stealth', 'Advantage')),
    'flavor', 'Shifting grey-green cloth that blurs the edges of you. Pull the hood up to fade.')),

  ('cat-potion-healing', jsonb_build_object(
    'name', 'Potion of Healing', 'category', 'consumable', 'rarity', 'common', 'icon', 'fa-flask',
    'weight', 0.5, 'w', 1, 'h', 1, 'heal', '2d4 + 2',
    'rows', jsonb_build_array(jsonb_build_array('Restores', '2d4 + 2 HP')),
    'flavor', 'Red, faintly sweet. Drink as an action to knit wounds.')),

  ('cat-potion-hill-giant', jsonb_build_object(
    'name', 'Potion of Hill Giant Strength', 'category', 'consumable', 'rarity', 'uncommon', 'icon', 'fa-flask',
    'weight', 0.5, 'w', 1, 'h', 1, 'duration', '1 hour',
    'effects', jsonb_build_object('abilitySet', jsonb_build_object('str', 21)),
    'rows', jsonb_build_array(
      jsonb_build_array('Sets STR', '21'),
      jsonb_build_array('Duration', '1 hour')),
    'flavor', 'Cloudy liquid with a bit of giant fingernail at the bottom. Your STR becomes 21 for an hour.')),

  ('cat-rations', jsonb_build_object(
    'name', 'Rations', 'category', 'misc', 'rarity', 'common', 'icon', 'fa-drumstick-bite',
    'weight', 2, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Use', '1 day of food')))),

  ('cat-torch', jsonb_build_object(
    'name', 'Torch', 'category', 'misc', 'rarity', 'common', 'icon', 'fa-fire',
    'weight', 1, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Light', '20 ft bright')))),

  ('cat-rope', jsonb_build_object(
    'name', 'Hempen Rope (50 ft)', 'category', 'misc', 'rarity', 'common', 'icon', 'fa-link',
    'weight', 10, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Length', '50 ft')))),

  ('cat-bedroll', jsonb_build_object(
    'name', 'Bedroll', 'category', 'misc', 'rarity', 'common', 'icon', 'fa-bed',
    'weight', 7, 'w', 2, 'h', 1))

on conflict (id) do update set data = excluded.data;

-- Sanity check: how many templates are now in the library.
select count(*) as catalog_items from item_catalog;
