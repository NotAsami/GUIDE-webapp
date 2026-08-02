-- Inventory fixtures for the refactored Inventory screen (`inventory` column +
-- `equipped.containers`). Rewritten for the Inventory Refactor — the dev DB is
-- disposable, so this REPLACES the old 8x10 auto-packed fixture rather than
-- migrating it.
--
-- Like the other seeds this invents NO lore: every item, weight and damage die is
-- straight SRD. The design mockup's named gear (Castellan Field Pack, Brettany
-- anything) is placeholder and deliberately NOT seeded.
--
-- WHAT CHANGED FROM THE OLD FIXTURE
--   • Every item now carries `containerId` — 'person' for the 5x4 on-person grid,
--     otherwise the id of the container item holding it.
--   • On-person items carry real `col`/`row` (1-indexed, top-left cell). Items in a
--     container OMIT them: a list has no geometry.
--   • `w`/`h` footprints are intrinsic and survive every move; only position drops.
--   • Categories use the expanded enum (weapon / ammo / armor / consumable / tool /
--     quest / misc). The old catch-all 'gear' is gone — worn kit is 'armor', field
--     kit is 'tool'.
--
-- RUN ORDER: this file owns `inventory` and `equipped.containers`.
-- `seed_equipment.sql` owns the worn gear slots and weapons. Run inventory FIRST,
-- then equipment. Neither clobbers the other's keys any more.
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run. Re-running RESETS the
-- inventory to exactly this list.
--
-- THE 5x4 ON-PERSON GRID this seeds (19 of 20 cells; (5,4) left free so RETRIEVE
-- from a container has somewhere to land):
--
--        c1          c2          c3          c4          c5
--   r1   Healing     Vigor       Antitoxin   Torch       Rations
--   r2   Handaxe     Waterskin   Tinderbox   Whetstone   Whistle
--   r3   Chalk       (waterskin) Mess Kit    Rope        Grap. Hook
--   r4   Healer Kit  Th. Tools   Hand Crossbow (2x1)     --free--

update characters set
  inventory = jsonb_build_array(

    -- ═══════════ ON PERSON — belt, pockets, quick-access ═══════════
    -- Row 1: consumables where a hand finds them without looking.
    jsonb_build_object(
      'id', 'inv-potion-healing', 'name', 'Potion of Healing', 'category', 'consumable',
      'containerId', 'person', 'col', 1, 'row', 1, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-flask', 'weight', 0.5, 'qty', 3,
      'heal', '2d4 + 2', 'value', 50,
      'rows', jsonb_build_array(jsonb_build_array('Restores', '2d4 + 2 HP')),
      'flavor', 'Red, faintly sweet. Drink as an action to knit wounds.'
    ),
    jsonb_build_object(
      'id', 'inv-potion-vigor', 'name', 'Potion of Vigor', 'category', 'consumable',
      'containerId', 'person', 'col', 2, 'row', 1, 'w', 1, 'h', 1,
      'rarity', 'uncommon', 'icon', 'fa-wand-sparkles', 'weight', 0.5, 'qty', 1,
      'duration', '10 rounds', 'value', 75,
      'effects', jsonb_build_object(
        'abilities', jsonb_build_object('str', 1), 'speed', 10),
      'rows', jsonb_build_array(
        jsonb_build_array('Bonus', '+1 STR'),
        jsonb_build_array('Bonus', '+10 ft speed')),
      'flavor', 'A bracing draught that floods the limbs with brief strength and speed.'
    ),
    jsonb_build_object(
      'id', 'inv-antitoxin', 'name', 'Antitoxin', 'category', 'consumable',
      'containerId', 'person', 'col', 3, 'row', 1, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-vial', 'weight', 0, 'qty', 2, 'value', 50,
      'rows', jsonb_build_array(jsonb_build_array('Save', 'Adv. vs. poison, 1 hour')),
      'flavor', 'A bitter draught. Neutralizes a single poison.'
    ),
    jsonb_build_object(
      'id', 'inv-torch', 'name', 'Torch', 'category', 'tool',
      'containerId', 'person', 'col', 4, 'row', 1, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-fire', 'weight', 1, 'qty', 3, 'value', 1,
      'rows', jsonb_build_array(jsonb_build_array('Light', '20 ft bright'))
    ),
    jsonb_build_object(
      'id', 'inv-rations', 'name', 'Rations', 'category', 'consumable',
      'containerId', 'person', 'col', 5, 'row', 1, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-drumstick-bite', 'weight', 2, 'qty', 5, 'value', 5,
      'rows', jsonb_build_array(jsonb_build_array('Use', '1 day of food'))
    ),

    -- Row 2: the waterskin is the seed's multi-cell proof (1x2, spans r2-r3).
    jsonb_build_object(
      'id', 'inv-handaxe', 'name', 'Handaxe', 'category', 'weapon',
      'containerId', 'person', 'col', 1, 'row', 2, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-hammer', 'weight', 2, 'value', 5,
      'ability', 'str', 'damageDice', '1d6', 'type', 'Slashing',
      'properties', jsonb_build_array('Light', 'Thrown (20/60)'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d6 slashing'),
        jsonb_build_array('Properties', 'Light, Thrown'))
    ),
    jsonb_build_object(
      'id', 'inv-waterskin', 'name', 'Waterskin', 'category', 'tool',
      'containerId', 'person', 'col', 2, 'row', 2, 'w', 1, 'h', 2,
      'rarity', 'common', 'icon', 'fa-bottle-water', 'weight', 5, 'value', 2,
      'rows', jsonb_build_array(jsonb_build_array('Holds', '4 pints')),
      'flavor', 'A full skin of water, patched at the seam where a thorn found it.'
    ),
    jsonb_build_object(
      'id', 'inv-tinderbox', 'name', 'Tinderbox', 'category', 'tool',
      'containerId', 'person', 'col', 3, 'row', 2, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-fire-flame-simple', 'weight', 1, 'value', 5,
      'rows', jsonb_build_array(jsonb_build_array('Light a torch', '1 action'))
    ),
    jsonb_build_object(
      'id', 'inv-whetstone', 'name', 'Whetstone', 'category', 'tool',
      'containerId', 'person', 'col', 4, 'row', 2, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-cube', 'weight', 1, 'value', 1
    ),
    jsonb_build_object(
      'id', 'inv-whistle', 'name', 'Signal Whistle', 'category', 'tool',
      'containerId', 'person', 'col', 5, 'row', 2, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-bell', 'weight', 0, 'value', 1,
      'rows', jsonb_build_array(jsonb_build_array('Carries', '300 ft'))
    ),

    -- Row 3
    jsonb_build_object(
      'id', 'inv-chalk', 'name', 'Chalk', 'category', 'misc',
      'containerId', 'person', 'col', 1, 'row', 3, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-pen', 'weight', 0, 'qty', 4, 'value', 1
    ),
    jsonb_build_object(
      'id', 'inv-mess-kit', 'name', 'Mess Kit', 'category', 'tool',
      'containerId', 'person', 'col', 3, 'row', 3, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-utensils', 'weight', 1, 'value', 2
    ),
    jsonb_build_object(
      'id', 'inv-rope', 'name', 'Hempen Rope (50 ft)', 'category', 'tool',
      'containerId', 'person', 'col', 4, 'row', 3, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-link', 'weight', 10, 'value', 1,
      'rows', jsonb_build_array(jsonb_build_array('Length', '50 ft'))
    ),
    jsonb_build_object(
      'id', 'inv-grap-hook', 'name', 'Grappling Hook', 'category', 'tool',
      'containerId', 'person', 'col', 5, 'row', 3, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-anchor', 'weight', 4, 'value', 2,
      'rows', jsonb_build_array(jsonb_build_array('Pairs with', 'Rope'))
    ),

    -- Row 4 — the hand crossbow is the second multi-cell item (2x1).
    jsonb_build_object(
      'id', 'inv-healers-kit', 'name', 'Healer''s Kit', 'category', 'tool',
      'containerId', 'person', 'col', 1, 'row', 4, 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-kit-medical', 'weight', 3, 'value', 5,
      'rows', jsonb_build_array(jsonb_build_array('Uses', '10'))
    ),
    jsonb_build_object(
      'id', 'inv-thieves-tools', 'name', 'Thieves'' Tools', 'category', 'tool',
      'containerId', 'person', 'col', 2, 'row', 4, 'w', 1, 'h', 1,
      'rarity', 'uncommon', 'icon', 'fa-screwdriver-wrench', 'weight', 1, 'value', 25,
      'rows', jsonb_build_array(jsonb_build_array('Check', 'DEX'))
    ),
    jsonb_build_object(
      'id', 'inv-hand-crossbow', 'name', 'Hand Crossbow', 'category', 'weapon',
      'containerId', 'person', 'col', 3, 'row', 4, 'w', 2, 'h', 1,
      'rarity', 'common', 'icon', 'fa-crosshairs', 'weight', 3, 'value', 75,
      'ability', 'dex', 'damageDice', '1d6', 'type', 'Piercing',
      'properties', jsonb_build_array('Ammunition (30/120)', 'Light', 'Loading'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d6 piercing'),
        jsonb_build_array('Range', '30 / 120'))
    ),

    -- ═══════════ BACKPACK (page container) — the bulk ═══════════
    -- No col/row: a list has no geometry. Footprints stay, so these pack correctly
    -- if retrieved back onto the grid.
    jsonb_build_object(
      'id', 'inv-chain-mail', 'name', 'Chain Mail', 'category', 'armor',
      'containerId', 'ctr-backpack', 'w', 2, 'h', 2,
      'slot', 'armor', 'rarity', 'common', 'icon', 'fa-shirt', 'weight', 55, 'value', 75,
      'rows', jsonb_build_array(
        jsonb_build_array('Armor Class', '16'),
        jsonb_build_array('Type', 'Heavy'),
        jsonb_build_array('Stealth', 'Disadvantage')),
      'flavor', 'Interlocking rings over quilted fabric. Heavy, loud, dependable.'
    ),
    jsonb_build_object(
      'id', 'inv-longsword', 'name', 'Longsword', 'category', 'weapon',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 2,
      'rarity', 'common', 'icon', 'fa-khanda', 'weight', 3, 'value', 15,
      'ability', 'str', 'damageDice', '1d8', 'type', 'Slashing',
      'properties', jsonb_build_array('Versatile (1d10)'),
      'rows', jsonb_build_array(
        jsonb_build_array('Damage', '1d8 slashing'),
        jsonb_build_array('Properties', 'Versatile')),
      'flavor', 'A standard arming sword — reliable in one hand or two.'
    ),
    jsonb_build_object(
      'id', 'inv-cloak-elvenkind', 'name', 'Cloak of Elvenkind', 'category', 'armor',
      'containerId', 'ctr-backpack', 'w', 2, 'h', 1,
      'slot', 'cloak', 'rarity', 'uncommon', 'icon', 'fa-user-tie', 'weight', 1, 'value', 500,
      'attune', 'Cloak of Elvenkind',
      'rows', jsonb_build_array(
        jsonb_build_array('Perception', 'Disadv. to see you'),
        jsonb_build_array('Stealth', 'Advantage')),
      'flavor', 'Shifting grey-green cloth that blurs the edges of you.'
    ),
    -- Two attunement items in the pack: equipping both alongside the worn Band of
    -- Vigor puts the header at ATTUNED 3 / 3 and tints it red.
    jsonb_build_object(
      'id', 'inv-ring-protection', 'name', 'Ring of Protection', 'category', 'armor',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'slot', 'ring2', 'rarity', 'rare', 'icon', 'fa-ring', 'weight', 0, 'value', 3500,
      'attune', 'Ring of Protection',
      'effects', jsonb_build_object('ac', 1, 'saves', 1),
      'rows', jsonb_build_array(
        jsonb_build_array('AC', '+1'),
        jsonb_build_array('Saves', '+1 all')),
      'flavor', 'A plain silver band that turns aside the worst of a blow.'
    ),
    jsonb_build_object(
      'id', 'inv-amulet-health', 'name', 'Amulet of Health', 'category', 'armor',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'slot', 'neck', 'rarity', 'rare', 'icon', 'fa-gem', 'weight', 1, 'value', 4000,
      'attune', 'Amulet of Health',
      'effects', jsonb_build_object('abilitySet', jsonb_build_object('con', 19)),
      'rows', jsonb_build_array(jsonb_build_array('Sets CON', '19')),
      'flavor', 'A dull green stone on a heavy chain. It beats, faintly, against the sternum.'
    ),
    jsonb_build_object(
      'id', 'inv-gloves-swimming', 'name', 'Gloves of Swimming and Climbing', 'category', 'armor',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'slot', 'gloves', 'rarity', 'uncommon', 'icon', 'fa-mitten', 'weight', 0, 'value', 500,
      'attune', 'Gloves of Swimming and Climbing',
      'rows', jsonb_build_array(jsonb_build_array('Swim / Climb', 'Full speed, adv.')),
      'flavor', 'Supple leather with a tacky grain that will not let go of wet stone.'
    ),
    jsonb_build_object(
      'id', 'inv-bedroll', 'name', 'Bedroll', 'category', 'tool',
      'containerId', 'ctr-backpack', 'w', 2, 'h', 1,
      'rarity', 'common', 'icon', 'fa-bed', 'weight', 7, 'value', 1,
      'flavor', 'Oilcloth and wool, rolled tight.'
    ),
    jsonb_build_object(
      'id', 'inv-lantern', 'name', 'Hooded Lantern', 'category', 'tool',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-lightbulb', 'weight', 2, 'value', 5,
      'rows', jsonb_build_array(jsonb_build_array('Light', '30 ft bright'))
    ),
    jsonb_build_object(
      'id', 'inv-oil-flask', 'name', 'Oil Flask', 'category', 'consumable',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-oil-can', 'weight', 1, 'qty', 3, 'value', 1,
      'rows', jsonb_build_array(jsonb_build_array('Thrown', '5 fire damage'))
    ),
    jsonb_build_object(
      'id', 'inv-potion-hill-giant', 'name', 'Potion of Hill Giant Strength',
      'category', 'consumable',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'uncommon', 'icon', 'fa-flask', 'weight', 0.5, 'qty', 1,
      'duration', '1 hour', 'value', 250,
      'effects', jsonb_build_object('abilitySet', jsonb_build_object('str', 21)),
      'rows', jsonb_build_array(
        jsonb_build_array('Sets STR', '21'),
        jsonb_build_array('Duration', '1 hour')),
      'flavor', 'Cloudy liquid with a bit of giant fingernail at the bottom.'
    ),
    jsonb_build_object(
      'id', 'inv-sewing-kit', 'name', 'Sewing Kit', 'category', 'tool',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-hands-bound', 'weight', 0, 'value', 1
    ),
    jsonb_build_object(
      'id', 'inv-soap', 'name', 'Soap', 'category', 'misc',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-soap', 'weight', 0, 'qty', 2, 'value', 1
    ),
    -- A locked item: carried, weighed, visibly present, and refusing to be used.
    jsonb_build_object(
      'id', 'inv-sealed-tome', 'name', 'Sealed Tome', 'category', 'quest',
      'containerId', 'ctr-backpack', 'w', 1, 'h', 1,
      'rarity', 'rare', 'icon', 'fa-book-skull', 'weight', 4, 'value', 0,
      'locked', true,
      'rows', jsonb_build_array(jsonb_build_array('Status', 'ACCESS REVOKED')),
      'flavor', 'The pages resist being read; the ink drinks lamplight rather than reflecting it.'
    ),

    -- ═══════════ BAG OF HOLDING (page, weightless) ═══════════
    -- Deliberately absurd weights: 165 lb of contents that add ZERO to Burden.
    jsonb_build_object(
      'id', 'inv-iron-chain', 'name', 'Iron Chain (200 ft)', 'category', 'tool',
      'containerId', 'ctr-boh', 'w', 2, 'h', 2,
      'rarity', 'common', 'icon', 'fa-link', 'weight', 100, 'value', 40,
      'rows', jsonb_build_array(jsonb_build_array('AC 19', '10 HP')),
      'flavor', 'Weightless in the bag; ruinous the moment it leaves.'
    ),
    jsonb_build_object(
      'id', 'inv-portable-ram', 'name', 'Portable Ram', 'category', 'tool',
      'containerId', 'ctr-boh', 'w', 2, 'h', 1,
      'rarity', 'common', 'icon', 'fa-hammer', 'weight', 35, 'value', 4,
      'rows', jsonb_build_array(jsonb_build_array('Force doors', '+4'))
    ),
    jsonb_build_object(
      'id', 'inv-strongbox', 'name', 'Iron Strongbox', 'category', 'misc',
      'containerId', 'ctr-boh', 'w', 2, 'h', 1,
      'rarity', 'common', 'icon', 'fa-box-archive', 'weight', 30, 'value', 20,
      'rows', jsonb_build_array(jsonb_build_array('Lock', 'DC 15'))
    ),
    jsonb_build_object(
      'id', 'inv-alchemists-supplies', 'name', 'Alchemist''s Supplies', 'category', 'tool',
      'containerId', 'ctr-boh', 'w', 2, 'h', 1,
      'rarity', 'uncommon', 'icon', 'fa-flask-vial', 'weight', 8, 'value', 50,
      'rows', jsonb_build_array(jsonb_build_array('Check', 'INT'))
    ),

    -- ═══════════ QUIVER (inline, ammo only, 16 / 20) ═══════════
    -- Never browsed as a page. These stacks are what the weapon card's ammo picker
    -- lists, which is why the quiver claims no tab.
    jsonb_build_object(
      'id', 'inv-arrows', 'name', 'Arrows', 'category', 'ammo',
      'containerId', 'ctr-quiver', 'w', 1, 'h', 1,
      'rarity', 'common', 'icon', 'fa-location-arrow', 'weight', 0.05, 'qty', 12, 'value', 1,
      'rows', jsonb_build_array(jsonb_build_array('Ammunition', 'Bow'))
    ),
    jsonb_build_object(
      'id', 'inv-arrows-silvered', 'name', 'Silvered Arrows', 'category', 'ammo',
      'containerId', 'ctr-quiver', 'w', 1, 'h', 1,
      'rarity', 'uncommon', 'icon', 'fa-location-arrow', 'weight', 0.05, 'qty', 4, 'value', 25,
      -- Ammunition contributes a FLAT damage bonus via the same `effects.damage`
      -- a magic weapon uses. Dice-valued and conditional ammunition waits for the
      -- features engine's roll contributions (refactor doc §17).
      'effects', jsonb_build_object('damage', 1),
      'rows', jsonb_build_array(jsonb_build_array('Ammunition', 'Bow · silvered')),
      'flavor', 'Silver-washed heads for the things that shrug off plain steel.'
    )

  ),

  -- ═══════════ EQUIPPED CONTAINERS ═══════════
  -- Keyed by `container.kind` — one per kind, which is what enforces the caps
  -- without a slot enum. An equipped container is NOT in `inventory`; like every
  -- equipped item it has left the grid.
  --
  -- NO SACK is seeded, on purpose: the SACK tab then renders LOCKED, which is the
  -- empty-slot state the fixed four-tab bar exists to show.
  equipped = equipped || jsonb_build_object(
    'containers', jsonb_build_object(
      'backpack', jsonb_build_object(
        'id', 'ctr-backpack', 'name', 'Backpack', 'category', 'tool',
        'rarity', 'common', 'icon', 'fa-bag-shopping', 'weight', 5, 'value', 2,
        'w', 2, 'h', 2,
        'container', jsonb_build_object(
          'kind', 'backpack', 'mode', 'page', 'weightless', false),
        'flavor', 'Oiled canvas over a bent-ash frame. Everything not needed in the next ten seconds lives in here.'
      ),
      'bagOfHolding', jsonb_build_object(
        'id', 'ctr-boh', 'name', 'Bag of Holding', 'category', 'tool',
        'rarity', 'rare', 'icon', 'fa-database', 'weight', 15, 'value', 4000,
        'w', 1, 'h', 2,
        'container', jsonb_build_object(
          'kind', 'bagOfHolding', 'mode', 'page', 'weightless', true),
        'rows', jsonb_build_array(
          jsonb_build_array('Contents', 'Weightless'),
          jsonb_build_array('Bag itself', '15 lbs.')),
        'flavor', 'The mouth of the bag is only the access port; the storage is somewhere the Codex declines to name.'
      ),
      'quiver', jsonb_build_object(
        'id', 'ctr-quiver', 'name', 'Quiver', 'category', 'tool',
        'rarity', 'common', 'icon', 'fa-arrow-up-long', 'weight', 1, 'value', 1,
        'w', 2, 'h', 1,
        'container', jsonb_build_object(
          'kind', 'quiver', 'mode', 'inline', 'weightless', false,
          'allowedCategories', jsonb_build_array('ammo'),
          'capacity', 20),
        'rows', jsonb_build_array(jsonb_build_array('Holds', '20 arrows')),
        'flavor', 'Stiffened leather, cut for a hip draw.'
      )
    )
  )
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- ── Sanity checks ─────────────────────────────────────────────────────────────
-- 1. Item counts per container. Expect person 17, ctr-backpack 13, ctr-boh 4,
--    ctr-quiver 2.
select i->>'containerId' as container, count(*) as items
from characters c, jsonb_array_elements(c.inventory) i
where c.owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com')
group by 1 order by 1;

-- 2. On-person cells used. Expect 19 of 20 (one free cell at col 5, row 4).
select sum(coalesce((i->>'w')::int, 1) * coalesce((i->>'h')::int, 1)) as cells_used
from characters c, jsonb_array_elements(c.inventory) i
where c.owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com')
  and i->>'containerId' = 'person';

-- 3. No on-person item may overflow the 5x4 grid. Expect ZERO rows.
select i->>'name' as offender, i->>'col' as col, i->>'row' as row
from characters c, jsonb_array_elements(c.inventory) i
where c.owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com')
  and i->>'containerId' = 'person'
  and ((i->>'col')::int + coalesce((i->>'w')::int, 1) - 1 > 5
    or (i->>'row')::int + coalesce((i->>'h')::int, 1) - 1 > 4);

-- 4. Carry weight the Burden manifest should show: on-person + backpack + quiver
--    + the containers' own weights, with bag-of-holding CONTENTS excluded.
select
  round(sum(case when i->>'containerId' = 'ctr-boh' then 0
                 else coalesce((i->>'weight')::numeric, 0) * coalesce((i->>'qty')::numeric, 1)
            end), 2) as carried_contents_lb,
  21 as containers_own_weight_lb   -- backpack 5 + bag of holding 15 + quiver 1
from characters c, jsonb_array_elements(c.inventory) i
where c.owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
