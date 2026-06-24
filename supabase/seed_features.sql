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
-- CARD MODEL: `light_description` is the short text shown on the card (the card
-- scales to it) and at the top of the detail panel; `deep_description` is the
-- fuller detail shown only in the panel (click the card to open it). Both support
-- lightweight markdown: **bold** and *italics*. `kind` tints the card-header
-- backdrop so the player can read a feature's origin at a glance —
--   'levelup'    (cyan)  = gained on level-up / class & feats
--   'equipment'  (gold)  = granted by a magic item while attuned/worn
--   'corruption' (violet)= a curse / mutation / corruption effect
-- Absent kind = neutral beige.
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run. Re-running RESETS
-- sheet.features to exactly this list.

update characters set
  sheet = sheet || jsonb_build_object(
    'features', jsonb_build_array(
      jsonb_build_object(
        'id', 'feat-second-wind', 'name', 'Second Wind', 'category', 'class',
        'kind', 'levelup',
        'source', 'Fighter 1', 'icon', 'fa-heart-pulse', 'level', 1,
        'usage', '1/short rest',
        'uses', jsonb_build_object('current', 1, 'max', 1),
        'recharge', 'short',
        'roll', '1d10 + 7', 'rollLabel', 'Healing', 'rollTone', 'heal',
        'rows', jsonb_build_array(
          jsonb_build_array('Action', 'Bonus Action'),
          jsonb_build_array('Healing', '1d10 + 7'),
          jsonb_build_array('Recharge', 'Short or Long Rest')),
        'light_description', 'Spend a **bonus action** to regain **1d10 + your fighter level** HP.',
        'deep_description', 'You have a limited well of stamina that you can draw on to protect yourself from harm. Once you use this feature, you must finish a *short or long rest* before you can use it again.'
      ),
      jsonb_build_object(
        'id', 'feat-action-surge', 'name', 'Action Surge', 'category', 'class',
        'kind', 'levelup',
        'source', 'Fighter 2', 'icon', 'fa-bolt', 'level', 2,
        'usage', '1/short rest',
        'uses', jsonb_build_object('current', 1, 'max', 1),
        'recharge', 'short',
        'rows', jsonb_build_array(
          jsonb_build_array('Uses', '1'),
          jsonb_build_array('Recharge', 'Short or Long Rest')),
        'light_description', 'Take **one additional action** on your turn.',
        'deep_description', 'You can push yourself beyond your normal limits for a moment — the extra action is on top of your regular action and a possible bonus action. Once you use this feature, you must finish a *short or long rest*. At **17th level** you can use it twice before a rest, but only once on the same turn.'
      ),
      jsonb_build_object(
        'id', 'feat-extra-attack', 'name', 'Extra Attack', 'category', 'class',
        'kind', 'levelup',
        'source', 'Fighter 5', 'icon', 'fa-burst', 'level', 5,
        'usage', 'Passive',
        'rows', jsonb_build_array(
          jsonb_build_array('Attacks', '2')),
        'light_description', 'Attack **twice** whenever you take the Attack action.',
        'deep_description', 'Beginning at 5th level you can attack twice instead of once. The number of attacks increases to **three** at 11th level and **four** at 20th level.'
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
--     'kind', 'levelup',
--     'source', 'Feat', 'icon', 'fa-hand-fist', 'usage', 'Passive',
--     'light_description', 'You have **advantage** on attack rolls against a creature you are grappling.',
--     'deep_description', 'You can use your action to try to *pin* a creature grappled by you. To do so, make another grapple check. If you succeed, you and the creature are both restrained until the grapple ends.'
--   ),
--   jsonb_build_object(
--     'id', 'sense-darkvision', 'name', 'Darkvision', 'category', 'sense',
--     'kind', 'levelup',
--     'source', 'Race', 'icon', 'fa-eye', 'usage', 'Passive',
--     'rows', jsonb_build_array(jsonb_build_array('Range', '60 ft')),
--     'light_description', 'You can see in **dim light** within 60 feet of you as if it were bright light, and in **darkness** as if it were dim light.',
--     'deep_description', 'You can''t discern color in darkness, only *shades of gray*.'
--   ),
--   -- an ability granted by a magic item (gold header):
--   jsonb_build_object(
--     'id', 'gear-cloak-elvenkind', 'name', 'Cloak of Elvenkind', 'category', 'other',
--     'kind', 'equipment',
--     'source', 'Attuned Item', 'icon', 'fa-user-tie', 'usage', 'While worn',
--     'light_description', 'While you wear this cloak with its hood up, Wisdom (Perception) checks to *see* you have **disadvantage**.',
--     'deep_description', 'You have **advantage** on Dexterity (Stealth) checks made to hide, as the cloak''s color shifts to camouflage you.'
--   ),
--   -- a corruption / curse effect (violet header):
--   jsonb_build_object(
--     'id', 'corr-shard-whispers', 'name', 'Shard Whispers', 'category', 'other',
--     'kind', 'corruption',
--     'source', 'Corruption', 'icon', 'fa-skull', 'usage', 'Passive',
--     'light_description', 'The shard *whispers* when you sleep. (DM-authored — example only.)',
--     'deep_description', 'Author the mechanical effect here once the curse is defined.'
--   )

-- Sanity check.
select jsonb_array_length(sheet->'features') as feature_count,
       sheet->'features' as features
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
