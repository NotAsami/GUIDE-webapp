-- ============================================================================
-- 0018 — PUBLIC VITALS, and the party roster that projects them
--
-- The party HUD needs a handful of numbers about every OTHER player: HP, AC,
-- death saves, and which conditions they are under. `characters` has exactly
-- one player policy — own_character, owner = auth.uid() (0001_init.sql) — so
-- the only path to another PC's data is `list_party_roster()`, the narrow
-- SECURITY DEFINER exception added in 0011.
--
-- WHY A COLUMN AND NOT MORE SQL. Two of those numbers are DERIVED, not stored:
--
--     effective AC     = sheet.ac       + every worn item and slotted shard
--     effective max HP = sheet.hp.max   + shard bonuses
--
-- The function can only project columns, so computing them here would mean a
-- second implementation of lib/effects.ts effectiveSheet living in Postgres —
-- and the two would disagree the first time either changed. Instead the OWNER
-- computes them (they can read their own row, and their client already runs
-- effectiveSheet on every render) and writes the result to `public_vitals`.
-- Both write paths — lib/character.ts (the player's own sheet) and lib/dm.ts
-- updateCharacter (the DM granting gear or a level) — fold that into the SAME
-- patch as the change itself, so the cache cannot drift from what it
-- summarises.
--
-- This also fixes a live inconsistency: the roster has always returned the RAW
-- `sheet.hp.max`, so a character wearing a +maxHP shard already read differently
-- in the party list than in their own topbar.
--
-- WHAT THIS EXPOSES, deliberately: HP, temp HP, effective AC, death-save
-- counts, and condition NAMES. Nothing about what a condition does, and nothing
-- else on the row — no inventory, no gold, no lore, no secrets, no spell list.
-- The hole stays the size of the thing going through it.
--
-- WHO MAY CALL IT is unchanged from 0011: any authenticated user who owns a
-- character, and it still never returns their own row.
-- ============================================================================

alter table characters
  add column if not exists public_vitals jsonb;

comment on column characters.public_vitals is
  'Compiled cache of the slice other players may see (lib/vitals.ts publicVitals). Written by the owner on every sheet change; read only through list_party_roster(). Never authored by hand.';

-- Backfill from the raw sheet so the HUD has something before each client has
-- written once. These are the AUTHORED values, not the effective ones — a
-- character wearing a +1 AC ring reads 1 low until their client next writes,
-- which is the first HP change, rest, or item move they make. Deliberately not
-- clever: the correct values need the effect engine, which is the whole reason
-- this column exists.
update characters
   set public_vitals = jsonb_build_object(
         'hp',        coalesce((sheet -> 'hp' ->> 'current')::int, 0),
         'hpMax',     coalesce((sheet -> 'hp' ->> 'max')::int, 0),
         'temp',      coalesce((sheet -> 'hp' ->> 'temp')::int, 0),
         'ac',        coalesce((sheet ->> 'ac')::int, 0),
         'deathOk',   coalesce((resources -> 'deathSaves' ->> 'successes')::int, 0),
         'deathFail', coalesce((resources -> 'deathSaves' ->> 'failures')::int, 0),
         'effects',   '[]'::jsonb)
 where public_vitals is null;

-- Same function, one more projected column. Recreated rather than altered
-- because the return type changes.
drop function if exists list_party_roster();

create or replace function list_party_roster()
returns table(
  id uuid, name text, race text, class text, level int,
  hp_current int, hp_max int, public_vitals jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name,
    c.identity ->> 'race', c.identity ->> 'class',
    (c.identity ->> 'level')::int,
    (c.sheet -> 'hp' ->> 'current')::int, (c.sheet -> 'hp' ->> 'max')::int,
    c.public_vitals
  from characters c
  where c.owner <> auth.uid()
    and exists (select 1 from characters me where me.owner = auth.uid())
$$;

revoke execute on function list_party_roster() from public;
revoke execute on function list_party_roster() from anon;
grant execute on function list_party_roster() to authenticated;

-- VERIFY (as a bound player, not the DM):
--   select * from list_party_roster();
--     -> other PCs only, never your own row, and only these eight columns.
--   select public_vitals from characters;
--     -> your row only. The column is not a new way to read anyone else's.
