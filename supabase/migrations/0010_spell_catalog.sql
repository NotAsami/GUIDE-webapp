-- G.U.I.D.E. Codex — the spell catalog (Spellbook slice, Operator Console).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- The DM authors spells ONCE here. Consumption is SNAPSHOT-based, exactly
-- like item_catalog (0004) and feature_catalog (0005): Grant Spell copies a
-- template onto `characters.spellbook.spells`. Every copy carries a
-- `spell_id` back-ref for a future live-hydration pass.
--
-- DM-ONLY, same wall as 0002/0004/0005: THE SECURITY IS THE ABSENCE OF A
-- PLAYER POLICY — a non-DM select matches no policy and returns ZERO ROWS.
-- Snapshots mean a player client never needs to read this table, so
-- un-granted spells can't leak and spoil what's coming.

create table if not exists spell_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists spell_catalog_set_updated_at on spell_catalog;
create trigger spell_catalog_set_updated_at
  before update on spell_catalog
  for each row execute function tg_set_updated_at();

alter table spell_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_spell_catalog on spell_catalog;
create policy dm_spell_catalog on spell_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from spell_catalog;   -- must return 0 rows, never an error.
