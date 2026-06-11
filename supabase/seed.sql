-- Seed one canonical character (handoff §5 canon values).
--
-- HOW TO RUN: log in to your Supabase project with a magic link once (so that
-- an auth.users row exists for your email), then paste this whole file into
-- the SQL editor and Run. The owner is resolved from your email; substitute
-- PLAYER_EMAIL below if different.
--
-- Canon (see docs/GUIDE_Codex_Build_Handoff.md §5):
--   level 7, HP 52 / 52, hit dice 7d10, proficiency bonus +3.
--   Ability scores default to the Character mockup set; change if you've
--   picked the Stat-Panel set instead.

with player as (
  select id from auth.users where email = 'samo.tv.sibik@gmail.com' limit 1
)
insert into characters (owner, name, identity, sheet, resources, inventory, equipped, shards, spellbook, lore, progress)
select
  (select id from player),
  'Ros Chrisstone',
  jsonb_build_object(
    'race',        'Human',
    'class',       'Fighter',
    'archetype',   null,   -- §5: invented lore. Set when you confirm canon.
    'background',  null,
    'level',       7,
    'reputation',  35
  ),
  jsonb_build_object(
    'abilities', jsonb_build_object(
      'str', 18, 'dex', 14, 'con', 16,
      'int', 10, 'wis', 13, 'cha', 12
    ),
    'hp',               jsonb_build_object('current', 52, 'max', 52, 'temp', 0),
    'hitDice',          jsonb_build_object('current', 7,  'max', 7,  'die', 'd10'),
    'ac',               16,
    'initiative',       2,
    'speed',            30,
    'proficiencyBonus', 3,
    'coins',            jsonb_build_object('gold', 1247, 'silver', 0, 'copper', 0)
  ),
  jsonb_build_object(
    'attunement',   jsonb_build_object('available', 0, 'spent', 0, 'capacity', 3),
    'deathSaves',   jsonb_build_object('successes', 0, 'failures', 0),
    'exhaustion',   0
  ),
  '[]'::jsonb,
  jsonb_build_object(
    'helmet', null, 'armor', null, 'cloak', null, 'boots', null,
    'accessory', null, 'quickAccess', null, 'guideShard', null,
    'weapons', '[]'::jsonb
  ),
  jsonb_build_object(
    'slot1', jsonb_build_object('shardId', 'guide', 'locked', true,  'attuned', '[]'::jsonb),
    'slot2', jsonb_build_object('shardId', 'vigor', 'locked', false, 'attuned', '[]'::jsonb),
    'slot3', jsonb_build_object('shardId', null,    'locked', false, 'attuned', '[]'::jsonb)
  ),
  jsonb_build_object(
    'spellcasting', false
  ),
  '{}'::jsonb,
  jsonb_build_object(
    'stories', jsonb_build_array(
      jsonb_build_object(
        'id',        'character-story',
        'title',     'Character Story',
        'label',     'Personal Arc',
        'emblem',    'character',
        'telemetry', 'Connection 003.001.42',
        'percent',   45,
        'chapter',   'The Soldier''s Burden'
      ),
      jsonb_build_object(
        'id',        'main-story',
        'title',     'Main Story',
        'label',     'Campaign Plot',
        'emblem',    'main',
        'telemetry', 'Connection 002.007.11',
        'percent',   23,
        'chapter',   'Ashes of Brettany'
      ),
      jsonb_build_object(
        'id',        'region-progress',
        'title',     'Region Progress',
        'label',     'Brettany Mapped',
        'emblem',    'region',
        'telemetry', 'Connection 004.012.51',
        'percent',   67,
        'tooltip',   'Region explored: 67% (34 of 51 locations discovered)'
      )
    )
  )
where exists (select 1 from player)
on conflict do nothing;

-- Sanity check: should return one row after insert.
select id, owner, name, sheet->'hp' as hp from characters where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- Grant the DM role to an account. Run after the DM has logged in once.
-- insert into dm_users (user_id)
-- select id from auth.users where email = 'YOUR_DM_EMAIL@example.com'
-- on conflict do nothing;
