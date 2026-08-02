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
    'name', 'Chain Mail', 'category', 'armor', 'slot', 'armor', 'rarity', 'common', 'icon', 'fa-shirt',
    'weight', 55, 'w', 2, 'h', 2,
    'rows', jsonb_build_array(
      jsonb_build_array('Armor Class', '16'),
      jsonb_build_array('Type', 'Heavy'),
      jsonb_build_array('Stealth', 'Disadvantage')),
    'flavor', 'Interlocking rings over a layer of quilted fabric. Heavy, loud, dependable.')),

  ('cat-ring-protection', jsonb_build_object(
    'name', 'Ring of Protection', 'category', 'armor', 'slot', 'ring1', 'rarity', 'rare', 'icon', 'fa-ring',
    'weight', 0, 'w', 1, 'h', 1, 'attune', 'Ring of Protection',
    'effects', jsonb_build_object('ac', 1, 'saves', 1),
    'rows', jsonb_build_array(
      jsonb_build_array('AC', '+1'),
      jsonb_build_array('Saves', '+1 all')),
    'flavor', 'A plain silver band that turns aside the worst of a blow.')),

  ('cat-cloak-elvenkind', jsonb_build_object(
    'name', 'Cloak of Elvenkind', 'category', 'armor', 'slot', 'cloak', 'rarity', 'uncommon', 'icon', 'fa-user-tie',
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
    'name', 'Rations', 'category', 'consumable', 'rarity', 'common', 'icon', 'fa-drumstick-bite',
    'weight', 2, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Use', '1 day of food')))),

  ('cat-torch', jsonb_build_object(
    'name', 'Torch', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-fire',
    'weight', 1, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Light', '20 ft bright')))),

  ('cat-rope', jsonb_build_object(
    'name', 'Hempen Rope (50 ft)', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-link',
    'weight', 10, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Length', '50 ft')))),

  ('cat-bedroll', jsonb_build_object(
    'name', 'Bedroll', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-bed',
    'weight', 7, 'w', 2, 'h', 1)),

  -- ── Ammunition. Its own category since the Inventory Refactor: a quiver that
  --    accepts only ammunition is expressible only if ammunition is a category,
  --    and it is what makes picked-up arrows route themselves into the quiver. ──

  ('cat-arrows', jsonb_build_object(
    'name', 'Arrows', 'category', 'ammo', 'rarity', 'common', 'icon', 'fa-location-arrow',
    'weight', 0.05, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Ammunition', 'Bow')))),

  ('cat-arrows-silvered', jsonb_build_object(
    'name', 'Silvered Arrows', 'category', 'ammo', 'rarity', 'uncommon', 'icon', 'fa-location-arrow',
    'weight', 0.05, 'w', 1, 'h', 1,
    'rows', jsonb_build_array(jsonb_build_array('Ammunition', 'Bow · silvered')),
    'flavor', 'Silver-washed heads for the things that shrug off plain steel.')),

  -- ── Containers. One template per shipping kind. `kind` is what enforces the
  --    caps (1 backpack, 1 bag of holding, 1 sack, 1 quiver) — granting a second
  --    of a kind can be equipped only by unequipping the first. `mode` decides
  --    presentation and is AUTHORED, never inferred: page = owns a tab, inline =
  --    expands in the storage sidebar and never gets one. ──

  ('cat-backpack', jsonb_build_object(
    'name', 'Backpack', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-bag-shopping',
    'weight', 5, 'w', 2, 'h', 2,
    'container', jsonb_build_object('kind', 'backpack', 'mode', 'page', 'weightless', false),
    'flavor', 'Oiled canvas over a bent-ash frame.')),

  ('cat-bag-of-holding', jsonb_build_object(
    'name', 'Bag of Holding', 'category', 'tool', 'rarity', 'rare', 'icon', 'fa-database',
    'weight', 15, 'w', 1, 'h', 2,
    'container', jsonb_build_object('kind', 'bagOfHolding', 'mode', 'page', 'weightless', true),
    'rows', jsonb_build_array(
      jsonb_build_array('Contents', 'Weightless'),
      jsonb_build_array('Bag itself', '15 lbs.')),
    'flavor', 'The mouth of the bag is only the access port; the storage is somewhere the Codex declines to name.')),

  ('cat-sack', jsonb_build_object(
    'name', 'Sack', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-sack-xmark',
    'weight', 0.5, 'w', 1, 'h', 1,
    'container', jsonb_build_object('kind', 'sack', 'mode', 'page', 'weightless', false),
    'flavor', 'A plain sack, folded flat. It holds a great deal.')),

  ('cat-quiver', jsonb_build_object(
    'name', 'Quiver', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-arrow-up-long',
    'weight', 1, 'w', 2, 'h', 1,
    'container', jsonb_build_object(
      'kind', 'quiver', 'mode', 'inline', 'weightless', false,
      'allowedCategories', jsonb_build_array('ammo'),
      'capacity', 20),
    'rows', jsonb_build_array(jsonb_build_array('Holds', '20 arrows')),
    'flavor', 'Stiffened leather, cut for a hip draw.'))

on conflict (id) do update set data = excluded.data;

-- Sanity check: how many templates are now in the library.
select count(*) as catalog_items from item_catalog;
