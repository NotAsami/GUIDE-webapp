-- G.U.I.D.E. Codex — the effect catalog (Phase 2, Operator Console).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- The DM authors effect DEFINITIONS once here — name, icon, kind, tags, numeric
-- Modifiers, non-numeric Flags, and a prose Description. Duration is deliberately
-- NOT part of a definition: a definition says what it does, whoever applies it
-- (an item's `data.effectRefs`, later a spell or the console's Apply Effect card)
-- says how long.
--
-- Consumption is COMPILE-ON-SAVE, not read-through: the item catalog form looks
-- up each referenced effect's `mods`, folds them into the item's own
-- `data.effects` (the existing ItemEffects field the equip/grant engine already
-- reads — lib/effects.ts, weapons.ts, consume.ts), and persists that compiled
-- result alongside the references. A player client never needs to read this
-- table — same wall as item_catalog (0004) and feature_catalog (0005).
--
-- DM-ONLY: THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — a non-DM select
-- matches no policy and returns ZERO ROWS.

create table if not exists effect_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists effect_catalog_set_updated_at on effect_catalog;
create trigger effect_catalog_set_updated_at
  before update on effect_catalog
  for each row execute function tg_set_updated_at();

alter table effect_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_effect_catalog on effect_catalog;
create policy dm_effect_catalog on effect_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from effect_catalog;   -- must return 0 rows, never an error.
