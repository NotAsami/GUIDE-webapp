-- G.U.I.D.E. Codex — the feature catalog (Phase 2, Operator Console).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- The DM authors features (item perks, roleplay boons, later feats) ONCE here.
-- Consumption is SNAPSHOT-based, exactly like item_catalog (0004):
--   · the item form embeds feature copies onto an item's `data.features` — they
--     ride into a player's inventory with the item and surface as the player's
--     Gear Features group while the item is equipped;
--   · Grant Feature (Actions tab) copies one straight onto `sheet.features`
--     (roleplay grants);
--   · the Level-Up overlay (later phase) will grant feats the same way.
-- Every copy carries a `feature_id` back-ref for a future live-hydration pass.
--
-- DM-ONLY, same wall as 0002/0004: THE SECURITY IS THE ABSENCE OF A PLAYER
-- POLICY — a non-DM select matches no policy and returns ZERO ROWS. Snapshots
-- mean a player client never needs to read this table, so un-granted features
-- can't leak and spoil what's coming.

create table if not exists feature_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists feature_catalog_set_updated_at on feature_catalog;
create trigger feature_catalog_set_updated_at
  before update on feature_catalog
  for each row execute function tg_set_updated_at();

alter table feature_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_feature_catalog on feature_catalog;
create policy dm_feature_catalog on feature_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from feature_catalog;   -- must return 0 rows, never an error.
