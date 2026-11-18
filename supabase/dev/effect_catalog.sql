-- Effect catalog seed + data migration (Phase 2, Effects tab). Paste into the
-- Supabase SQL editor and Run AFTER 0013_effect_catalog.sql.
--
-- Two jobs, in order:
--   1. Seed the library with effect DEFINITIONS derived from every inline
--      `data.effects` bundle already live on an item_catalog row today, plus
--      three of the mockup's reference seeds (Bless / Poisoned / Haste) so all
--      three authoring cases — mods-only, flags-only, prose-only — exist from
--      day one.
--   2. Convert those same four item_catalog rows from inline `effects` to
--      `effectRefs` pointing at the new definitions. `data.effects` is LEFT
--      AS-IS on every one of them — it is now the compiled cache the item form
--      recomputes on every save, and the value it already holds is correct.
--
-- Idempotent: re-running resets each effect's data to exactly this (upsert by
-- id) and re-applies the same effectRefs update. Does NOT touch already-granted
-- copies in anyone's inventory (snapshots) or any item_catalog row not listed
-- below — see the plan's "deliberately not implemented" notes for why the
-- DM-authored rows outside this list are left on their legacy inline `effects`.

insert into effect_catalog (id, data) values

  ('fx-warding-band', jsonb_build_object(
    'name', 'Warding Band', 'icon', 'fa-ring', 'kind', 'buff',
    'tags', jsonb_build_array('magic_item', 'ward'),
    'mods', jsonb_build_array(
      jsonb_build_object('stat', 'AC', 'amt', 1),
      jsonb_build_object('stat', 'Saves', 'amt', 1)),
    'flags', jsonb_build_array(),
    'desc', 'A plain band, cool against the skin, that turns aside the worst of a blow and steadies the nerve against everything else.')),

  ('fx-giant-strength', jsonb_build_object(
    'name', 'Giant''s Strength', 'icon', 'fa-hand-fist', 'kind', 'buff',
    'tags', jsonb_build_array('potion', 'item'),
    'mods', jsonb_build_array(
      jsonb_build_object('stat', 'STR', 'amt', 21, 'set', true)),
    'flags', jsonb_build_array(),
    'desc', 'Thews swell with borrowed weight. Strength is SET to the draught''s fixed value rather than raised — a weak arm and a strong one end at the same number.')),

  ('fx-silvered', jsonb_build_object(
    'name', 'Silvered Edge', 'icon', 'fa-location-arrow', 'kind', 'buff',
    'tags', jsonb_build_array('weapon', 'ammo'),
    'mods', jsonb_build_array(
      jsonb_build_object('stat', 'Damage', 'amt', 1)),
    'flags', jsonb_build_array(),
    'desc', 'Silver-washed heads for the things that shrug off plain steel.')),

  ('fx-testing-gem', jsonb_build_object(
    'name', 'Testing Gem Effect', 'icon', 'fa-gem', 'kind', 'buff',
    'tags', jsonb_build_array('test'),
    'mods', jsonb_build_array(
      jsonb_build_object('stat', 'DEX', 'amt', 1)),
    'flags', jsonb_build_array(),
    'desc', 'A placeholder effect converted from a DM scratch item''s inline modifier.')),

  ('fx-bless', jsonb_build_object(
    'name', 'Bless', 'icon', 'fa-hands-praying', 'kind', 'buff',
    'tags', jsonb_build_array('spell', 'divine'),
    'mods', jsonb_build_array(), 'flags', jsonb_build_array(),
    'desc', 'A quiet favour settles over the blessed. Add 1d4 to every attack roll and every saving throw made while it holds — rolled by the player, at the moment of the roll.')),

  ('fx-poisoned', jsonb_build_object(
    'name', 'Poisoned', 'icon', 'fa-skull', 'kind', 'condition',
    'tags', jsonb_build_array('poison', 'standard'),
    'mods', jsonb_build_array(),
    'flags', jsonb_build_array(
      jsonb_build_object('mode', 'disadvantage', 'target', 'attack rolls'),
      jsonb_build_object('mode', 'disadvantage', 'target', 'ability checks')),
    'desc', 'The standard condition. Nausea and a swimming head — nothing lands the way it was aimed.')),

  ('fx-haste', jsonb_build_object(
    'name', 'Haste', 'icon', 'fa-bolt', 'kind', 'buff',
    'tags', jsonb_build_array('spell', 'transmutation', 'movement'),
    'mods', jsonb_build_array(
      jsonb_build_object('stat', 'AC', 'amt', 2)),
    'flags', jsonb_build_array(
      jsonb_build_object('mode', 'advantage', 'target', 'DEX saves')),
    'desc', 'The world thickens and slows around the hastened. Each turn they may take one additional limited action — attack once, dash, disengage, hide, or use an object — and nothing more than that. When it ends the body collects on the borrowed speed: the target can neither move nor act until after their next turn.'))

on conflict (id) do update set data = excluded.data;

-- ── Convert the four item rows from inline `effects` to `effectRefs`. Leaves
--    `data.effects` untouched — it already holds the correct compiled value. ──

update item_catalog
   set data = data || jsonb_build_object('effectRefs', jsonb_build_array(
         jsonb_build_object('effectId', 'fx-warding-band', 'dur', 'Permanent while equipped', 'amount', 1)))
 where id = 'cat-ring-protection';

update item_catalog
   set data = data || jsonb_build_object('effectRefs', jsonb_build_array(
         jsonb_build_object('effectId', 'fx-giant-strength', 'dur', 'Hours', 'amount', 1)))
 where id = 'cat-potion-hill-giant';

update item_catalog
   set data = data || jsonb_build_object('effectRefs', jsonb_build_array(
         jsonb_build_object('effectId', 'fx-silvered', 'dur', 'Permanent while equipped', 'amount', 1)))
 where id = 'cat-arrows-silvered';

update item_catalog
   set data = data || jsonb_build_object('effectRefs', jsonb_build_array(
         jsonb_build_object('effectId', 'fx-testing-gem', 'dur', 'Permanent while equipped', 'amount', 1)))
 where id = 'f982289e-734e-4a3c-9ecd-16724b27432e';

-- Sanity check: how many effects are now in the library, and which items reference one.
select count(*) as effect_catalog_rows from effect_catalog;
select id, data ->> 'name' as name, data -> 'effectRefs' as effect_refs, data -> 'effects' as compiled_effects
  from item_catalog where data ? 'effectRefs';
