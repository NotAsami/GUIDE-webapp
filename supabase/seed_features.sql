-- Features dossier fixtures for the Features screen (sheet.features[]).
--
-- These are the SRD Fighter class features a level-7 Fighter DEFINITIVELY has
-- (Second Wind L1, Action Surge L2, Extra Attack L5) — derived from class+level,
-- the same "not invented lore" basis the main seed uses for proficiencies/saves.
-- The archetype is null (§5: unconfirmed), so no subclass features are seeded.
--
-- Feats, racial traits and senses ARE per-character choices we can't assume for
-- a standard Human Fighter, so they're left as a commented TEMPLATE below — the
-- DM uncomments/edits them once canon is confirmed (e.g. if this PC took the
-- Grappler feat, or is actually a race with Darkvision).
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run. Re-running RESETS
-- sheet.features to exactly this list.

update characters set
  sheet = sheet || jsonb_build_object(
    'features', jsonb_build_array(
      jsonb_build_object(
        'id', 'feat-second-wind', 'name', 'Second Wind', 'category', 'class',
        'source', 'Fighter 1', 'icon', 'fa-heart-pulse', 'level', 1,
        'usage', '1/short rest',
        'uses', jsonb_build_object('current', 1, 'max', 1),
        'recharge', 'short',
        'roll', '1d10 + 7', 'rollLabel', 'Healing', 'rollTone', 'heal',
        'summary', 'Bonus action to regain 1d10 + fighter level HP.',
        'rows', jsonb_build_array(
          jsonb_build_array('Action', 'Bonus Action'),
          jsonb_build_array('Healing', '1d10 + 7'),
          jsonb_build_array('Recharge', 'Short or Long Rest')),
        'description', 'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.'
          || E'\n\n' ||
          'Once you use this feature, you must finish a short or long rest before you can use it again.'
      ),
      jsonb_build_object(
        'id', 'feat-action-surge', 'name', 'Action Surge', 'category', 'class',
        'source', 'Fighter 2', 'icon', 'fa-bolt', 'level', 2,
        'usage', '1/short rest',
        'uses', jsonb_build_object('current', 1, 'max', 1),
        'recharge', 'short',
        'summary', 'Take one additional action on your turn.',
        'rows', jsonb_build_array(
          jsonb_build_array('Uses', '1'),
          jsonb_build_array('Recharge', 'Short or Long Rest')),
        'description', 'You can push yourself beyond your normal limits for a moment. On your turn, you can take one additional action on top of your regular action and a possible bonus action.'
          || E'\n\n' ||
          'Once you use this feature, you must finish a short or long rest before you can use it again.'
      ),
      jsonb_build_object(
        'id', 'feat-extra-attack', 'name', 'Extra Attack', 'category', 'class',
        'source', 'Fighter 5', 'icon', 'fa-burst', 'level', 5,
        'usage', 'Passive',
        'summary', 'Attack twice when you take the Attack action.',
        'rows', jsonb_build_array(
          jsonb_build_array('Attacks', '2')),
        'description', 'Beginning at 5th level, you can attack twice, instead of once, whenever you take the Attack action on your turn.'
      )
    )
  )
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- TEMPLATE — feats / racial traits / senses (uncomment + edit once confirmed).
-- Append these objects into the jsonb_build_array above. Categories drive the
-- dossier grouping: 'feat' | 'racial' | 'background' | 'sense' | 'other'.
--
--   jsonb_build_object(
--     'id', 'feat-grappler', 'name', 'Grappler', 'category', 'feat',
--     'source', 'Feat', 'icon', 'fa-hand-fist', 'usage', 'Passive',
--     'summary', 'Advantage on attacks vs. a creature you are grappling.',
--     'description', 'You have advantage on attack rolls against a creature you are grappling. You can use your action to try to pin a creature grappled by you.'
--   ),
--   jsonb_build_object(
--     'id', 'sense-darkvision', 'name', 'Darkvision', 'category', 'sense',
--     'source', 'Race', 'icon', 'fa-eye', 'usage', 'Passive',
--     'summary', 'See in dim light and darkness up to 60 ft.',
--     'rows', jsonb_build_array(jsonb_build_array('Range', '60 ft')),
--     'description', 'You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light. You can''t discern color in darkness, only shades of gray.'
--   )

-- Sanity check.
select jsonb_array_length(sheet->'features') as feature_count,
       sheet->'features' as features
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
