-- Shop catalog seed (shop feature, part 1). Paste into the Supabase SQL editor and Run.
--
-- One shopkeeper to prove the loop end to end. Each stock line snapshots an
-- item_catalog template's `data` at author time (see migration 0009's header
-- for why: the player client never reads item_catalog, so the snapshot is the
-- only way the stock grid can render a name/icon/rarity). `price` starts equal
-- to the template's usual value but is a per-shop override field, same as the
-- Operator Console picker.
--
-- Idempotent: re-running resets this shopkeeper's data to exactly this
-- (upsert by id). It is seeded CLOSED (is_open = false) — the DM opens it live
-- from the console.

insert into shop_catalog (id, data, is_open, open_for) values

  ('shop-general-goods', jsonb_build_object(
    'name', 'Cross & Coin General Goods',
    'icon', 'fa-shop',
    'location', 'Brettany Market Row',
    'desc', 'A cramped stall of dented tin lamps and stacked crates. The keeper barely looks up from her ledger.',
    'stock', jsonb_build_array(
      jsonb_build_object(
        'item_id', 'cat-potion-healing', 'price', 50, 'mode', 'limited', 'qty', 4,
        'item', jsonb_build_object(
          'name', 'Potion of Healing', 'category', 'consumable', 'rarity', 'common', 'icon', 'fa-flask',
          'weight', 0.5, 'w', 1, 'h', 1, 'heal', '2d4 + 2',
          'rows', jsonb_build_array(jsonb_build_array('Restores', '2d4 + 2 HP')),
          'flavor', 'Red, faintly sweet. Drink as an action to knit wounds.')),
      jsonb_build_object(
        'item_id', 'cat-rations', 'price', 2, 'mode', 'unlimited', 'qty', 1,
        'item', jsonb_build_object(
          'name', 'Rations', 'category', 'consumable', 'rarity', 'common', 'icon', 'fa-drumstick-bite',
          'weight', 2, 'w', 1, 'h', 1,
          'rows', jsonb_build_array(jsonb_build_array('Use', '1 day of food')))),
      jsonb_build_object(
        'item_id', 'cat-torch', 'price', 1, 'mode', 'unlimited', 'qty', 1,
        'item', jsonb_build_object(
          'name', 'Torch', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-fire',
          'weight', 1, 'w', 1, 'h', 1,
          'rows', jsonb_build_array(jsonb_build_array('Light', '20 ft bright')))),
      jsonb_build_object(
        'item_id', 'cat-rope', 'price', 1, 'mode', 'limited', 'qty', 2,
        'item', jsonb_build_object(
          'name', 'Hempen Rope (50 ft)', 'category', 'tool', 'rarity', 'common', 'icon', 'fa-link',
          'weight', 10, 'w', 1, 'h', 1,
          'rows', jsonb_build_array(jsonb_build_array('Length', '50 ft')))),
      jsonb_build_object(
        'item_id', 'cat-handaxe', 'price', 5, 'mode', 'limited', 'qty', 1,
        'item', jsonb_build_object(
          'name', 'Handaxe', 'category', 'weapon', 'rarity', 'common', 'icon', 'fa-hammer',
          'weight', 2, 'w', 1, 'h', 1, 'ability', 'str', 'damageDice', '1d6', 'type', 'Slashing',
          'properties', jsonb_build_array('Light', 'Thrown (20/60)'),
          'rows', jsonb_build_array(
            jsonb_build_array('Damage', '1d6 slashing'),
            jsonb_build_array('Properties', 'Light, Thrown')))))),
    false, null)

on conflict (id) do update set data = excluded.data, is_open = excluded.is_open, open_for = excluded.open_for;

-- Sanity check.
select id, data->>'name' as name, is_open, open_for, jsonb_array_length(data->'stock') as lines from shop_catalog;
