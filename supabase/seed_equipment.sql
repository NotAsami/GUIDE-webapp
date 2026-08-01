-- Equipment fixtures — the WORN GEAR SLOTS and WEAPONS only. Generic SRD gear so
-- the equip/unequip flow is visible (NOT the mockup's invented lore: no Castellan
-- Claymore / Brettany Plate).
--
-- SCOPE CHANGED IN THE INVENTORY REFACTOR. This file used to seed `inventory` too,
-- which meant it and seed_inventory.sql fought over the same column. Now:
--   seed_inventory.sql  owns  `inventory` + `equipped.containers`
--   seed_equipment.sql  owns  `equipped` worn slots + `equipped.weapons`
-- RUN ORDER: inventory FIRST, then this. Neither clobbers the other's keys.
--
-- ALSO GONE: `equipped.quickAccess`. The 5x4 on-person grid replaced it, so this
-- file explicitly strips the key rather than leaving a stale array in the JSONB.
--
-- Eight worn slots now (4x2): helmet · armor · cloak · boots · gloves · neck ·
-- ring1 · ring2. The old `accessory` slot became `ring1`.
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run.
--
-- Demonstrates:
--   • Helmet / armor / boots / ring1 pre-equipped; cloak, gloves, neck and ring2
--     left EMPTY — their fillers wait in the backpack (Cloak of Elvenkind, Gloves
--     of Swimming, Amulet of Health, Ring of Protection), so the equip flow is
--     testable straight out of a container tab.
--   • ATTUNED reads 1 / 3 on load (Band of Vigor). Equip the Amulet and the Ring
--     and it hits 3 / 3 and tints red — the cap that actually matters at 8 slots.
--   • Band of Vigor layers +2 STR / +1 AC over the base sheet while worn, and the
--     weapon attack/damage numbers track the boosted STR. Unequip reverts —
--     effects are display-only, never written into the base sheet.
--   • Main hand is the SHORTBOW so the weapon card's ammo picker has something to
--     pick: it reads the equipped quiver's stacks (Arrows x12, Silvered x4).
--     Unequip the quiver and the picker disappears entirely rather than emptying.

update characters set
  equipped = (equipped - 'quickAccess' - 'accessory') || jsonb_build_object(

    -- ── worn gear ──────────────────────────────────────────────────────────
    'helmet', jsonb_build_object(
      'id', 'helm-iron', 'name', 'Iron Helm', 'slot', 'helmet', 'category', 'armor',
      'rarity', 'common', 'icon', 'fa-helmet-safety', 'weight', 3, 'value', 10,
      'w', 1, 'h', 1,
      'rows', jsonb_build_array(
        jsonb_build_array('Type', 'Head'),
        jsonb_build_array('Weight', '3 lbs.')),
      'flavor', 'Standard banded-iron infantry helm.'
    ),
    'armor', jsonb_build_object(
      'id', 'armor-chain', 'name', 'Chain Shirt', 'slot', 'armor', 'category', 'armor',
      'rarity', 'common', 'icon', 'fa-shield-halved', 'weight', 20, 'value', 50,
      'w', 2, 'h', 2,
      'rows', jsonb_build_array(
        jsonb_build_array('AC', '13 + DEX (max 2)'),
        jsonb_build_array('Type', 'Medium Armor'),
        jsonb_build_array('Weight', '20 lbs.')),
      'flavor', 'Interlocking steel rings worn under a tunic.',
      'attune', 'Not required'
    ),
    'boots', jsonb_build_object(
      'id', 'boots-leather', 'name', 'Leather Boots', 'slot', 'boots', 'category', 'armor',
      'rarity', 'common', 'icon', 'fa-shoe-prints', 'weight', 2, 'value', 5,
      'w', 1, 'h', 1,
      'rows', jsonb_build_array(
        jsonb_build_array('Type', 'Feet'),
        jsonb_build_array('Weight', '2 lbs.')),
      'flavor', 'Hardened marching boots, twice re-soled.'
    ),
    -- The one attuned item on load -> ATTUNED 1 / 3.
    'ring1', jsonb_build_object(
      'id', 'acc-band-vigor', 'name', 'Band of Vigor', 'slot', 'ring1', 'category', 'armor',
      'rarity', 'uncommon', 'icon', 'fa-ring', 'weight', 0, 'value', 800,
      'w', 1, 'h', 1,
      'rows', jsonb_build_array(
        jsonb_build_array('Bonus', '+2 STR'),
        jsonb_build_array('Bonus', '+1 AC'),
        jsonb_build_array('Type', 'Ring')),
      'effects', jsonb_build_object(
        'abilities', jsonb_build_object('str', 2),
        'ac', 1),
      'flavor', 'A warm iron band that lends the wearer a giant''s steadiness.',
      'attune', 'Required'
    ),
    -- Left empty on purpose; the fillers are in the backpack.
    'cloak', null,
    'gloves', null,
    'neck', null,
    'ring2', null,

    -- ── weapons ────────────────────────────────────────────────────────────
    -- Shortbow in the main hand is what makes the ammo picker testable.
    'weapons', jsonb_build_array(
      jsonb_build_object(
        'id', 'wpn-shortbow', 'name', 'Shortbow', 'category', 'weapon',
        'hand', 'main', 'rarity', 'common', 'icon', 'fa-bullseye',
        'weight', 2, 'value', 25, 'w', 1, 'h', 2,
        'ability', 'dex', 'damageDice', '1d6', 'type', 'Piercing',
        'properties', jsonb_build_array('Ammunition (80/320)', 'Two-Handed'),
        'rows', jsonb_build_array(
          jsonb_build_array('Damage', '1d6 piercing'),
          jsonb_build_array('Range', '80 / 320')),
        'flavor', 'A plain recurve of horn and ash.'
      ),
      jsonb_build_object(
        'id', 'wpn-dagger', 'name', 'Dagger', 'category', 'weapon',
        'hand', 'off', 'rarity', 'common', 'icon', 'fa-khanda',
        'weight', 1, 'value', 2, 'w', 1, 'h', 1,
        'ability', 'finesse', 'damageDice', '1d4', 'type', 'Piercing',
        'properties', jsonb_build_array('Finesse', 'Light', 'Thrown (20/60)'),
        'flavor', 'A balanced parrying dagger.'
      )
    )
  ),
  -- Clear any stale active effects from earlier tests.
  resources = resources || jsonb_build_object('activeEffects', '[]'::jsonb)
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- ── Sanity checks ─────────────────────────────────────────────────────────────
-- 1. quickAccess and the old accessory slot must be GONE. Expect false, false.
select equipped ? 'quickAccess' as has_quick_access,
       equipped ? 'accessory'   as has_old_accessory
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- 2. Worn slots + attunement count. Expect 4 filled, 4 empty, attuned 1.
select
  (select count(*) from jsonb_each(equipped) e
     where e.key in ('helmet','armor','cloak','boots','gloves','neck','ring1','ring2')
       and e.value <> 'null'::jsonb) as slots_filled,
  (select count(*) from jsonb_each(equipped) e
     where e.key in ('helmet','armor','cloak','boots','gloves','neck','ring1','ring2')
       and e.value = 'null'::jsonb) as slots_empty,
  (select count(*) from jsonb_each(equipped) e
     where e.key in ('helmet','armor','cloak','boots','gloves','neck','ring1','ring2')
       and e.value->>'attune' is not null
       and e.value->>'attune' <> 'Not required') as attuned
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- 3. Loadout at a glance.
select equipped->'weapons' as weapons,
       jsonb_object_keys(equipped->'containers') as equipped_containers
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
