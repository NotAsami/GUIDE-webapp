-- ============================================================================
-- 0019 — THE LOOT CATALOG
--
-- A named, reusable roll table: "knight corpse", "chest", "bookshelf". Each row
-- is one thing that MIGHT be there, with its own quantity range and its own
-- chance:
--
--     Chainmail Boots     x1      30%
--     Amulet of Strength  x1       2%
--     Arrows              x1-10   50%
--     Torch               x1      40%
--     silver              2-20    80%
--
-- ROWS ROLL INDEPENDENTLY, they are not a weighted pick-one. The percentages
-- above sum to 202%, which is not a bug — each row gets its own coin flip, and
-- a corpse can carry boots AND arrows AND nothing else. A weighted table would
-- have to normalise, and "30% chance of boots" would stop meaning 30%.
--
-- The RANGE is stored as min/max rather than a dice expression. The spec asks
-- for "x1-10", and a range is what the editor should ask a DM for; 1d10 and
-- 1-10 are not the same distribution, and the honest one here is uniform.
--
-- DM-ONLY: THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — a non-DM select
-- matches no policy and returns ZERO ROWS. That absence is what makes the
-- `draft` column safe (0014's rule: a draft column on a table players can read
-- hands them unpublished work).
--
-- Players never read this table, and that is not only a permission — it is the
-- design. What reaches a player is ITEMS ON THEIR OWN ROW, written by the DM
-- pressing Grant, indistinguishable from a hand-granted item. A player who
-- could read the table could read the 2% amulet they did not get.
-- ============================================================================

create table if not exists loot_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  draft      jsonb,
  updated_at timestamptz not null default now()
);

comment on table loot_catalog is
  'Named loot tables. Rows roll independently; see lib/loot.ts rollLoot, which is the only implementation of the roll.';
comment on column loot_catalog.draft is
  'In-progress edit. Publish promotes this into data and clears it. Null = no unpublished work.';

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists loot_catalog_set_updated_at on loot_catalog;
create trigger loot_catalog_set_updated_at
  before update on loot_catalog
  for each row execute function tg_set_updated_at();

alter table loot_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_loot_catalog on loot_catalog;
create policy dm_loot_catalog on loot_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from loot_catalog;   -- must return 0 rows, never an error.
