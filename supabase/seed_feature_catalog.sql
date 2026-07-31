-- Feature catalog seed (Operator Console, feature library). Paste into the
-- Supabase SQL editor and Run.
--
-- A few SRD-derived starter templates so the library isn't empty on day one:
-- two item-grantable perks (the kind the item form embeds) and one roleplay
-- boon. No invented lore — names/mechanics are straight SRD magic-item perks.
-- `data` is a Feature MINUS its instance id (stamped at grant/embed time).
--
-- Idempotent: re-running RESETS each template's data (upsert by id). It does
-- NOT touch copies already embedded on items or granted to characters.

insert into feature_catalog (id, data) values

  ('catf-elven-stealth', jsonb_build_object(
    'name', 'Elven Concealment', 'category', 'other', 'kind', 'equipment',
    'source', 'Cloak of Elvenkind', 'icon', 'fa-user-ninja',
    'usage', 'While hood is up',
    'light_description', '**Advantage** on Stealth checks; perception checks to see you have **disadvantage**.',
    'deep_description', 'While you wear this cloak with its hood up, Wisdom (Perception) checks made to see you have disadvantage, and you have advantage on Dexterity (Stealth) checks made to hide, as the cloak''s color shifts to camouflage you.'
  )),

  ('catf-water-breathing', jsonb_build_object(
    'name', 'Water Breathing', 'category', 'other', 'kind', 'equipment',
    'source', 'Cap of Water Breathing', 'icon', 'fa-droplet',
    'usage', 'While worn',
    'light_description', 'You can **breathe underwater** while this is worn.',
    'deep_description', 'While wearing this item, you can breathe underwater indefinitely — a bubble of air forms and renews itself around your head.'
  )),

  ('catf-inspiring-presence', jsonb_build_object(
    'name', 'Inspiring Presence', 'category', 'background', 'kind', 'levelup',
    'source', 'Roleplay boon', 'icon', 'fa-comments',
    'usage', '1/long rest',
    'uses', jsonb_build_object('current', 1, 'max', 1),
    'recharge', 'long',
    'light_description', 'Once per long rest, grant an ally within earshot **advantage** on their next ability check.',
    'deep_description', 'Earned in play — a word from you steadies a companion''s hand. The DM adjudicates the moment; this card is the reminder that you can spend it.'
  ))

on conflict (id) do update set data = excluded.data;

-- Sanity check.
select count(*) as feature_templates from feature_catalog;
