-- ============================================================================
-- 0016 — THE CLASS CATALOG
--
-- The fifth authoring library. Until now `identity.class` was a bare string
-- ('Warlock') typed into the caster card, and everything a class actually
-- decides — hit die, save proficiencies, the eligible skill list, armour and
-- weapon training, the features it grants and when — was hand-seeded per
-- character. A class row is that decision, authored once.
--
-- SHAPE: `data` is a ClassDef (src/lib/database.types.ts). Two things are
-- deliberately NOT in it:
--
--   * no spell-slot table. Slots are derived from `caster` (full/half/third)
--     and character level by lib/classes.ts, and pact slots by lib/spells.ts.
--     Storing the SRD progression would be a second answer to a settled
--     question, and the two copies would drift.
--   * no per-level progression grid. Levels are gate conditions on the feature
--     references (`when: "level >= 3"`), read by the same expression engine
--     that already evaluates GraphEffect.when.
--
-- Features are REFERENCED by feature_catalog id, not snapshotted. A class
-- carries 40+ of them and the DM re-authors them constantly; a snapshot would
-- go stale the moment Second Wind was edited. The per-character SNAPSHOT still
-- happens — at assign time, which is the boundary every other grant uses.
--
-- DM-ONLY: THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — a non-DM select
-- matches no policy and returns ZERO ROWS. That absence is also what makes the
-- `draft` column safe here, exactly as 0014 argued for feature_catalog: RLS is
-- row-level, so a draft column on a table players CAN select would hand them
-- the DM's unpublished work. Players never read this table at all.
-- ============================================================================

create table if not exists class_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  draft      jsonb,
  updated_at timestamptz not null default now()
);

comment on column class_catalog.draft is
  'In-progress edit. Publish promotes this into data and clears it. Null = no unpublished work.';

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists class_catalog_set_updated_at on class_catalog;
create trigger class_catalog_set_updated_at
  before update on class_catalog
  for each row execute function tg_set_updated_at();

alter table class_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_class_catalog on class_catalog;
create policy dm_class_catalog on class_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- No backfill: the table is new and starts empty. `published` rides inside
-- `data` (matching feature_catalog and ShardTree) rather than being a column —
-- nothing in SQL reads it, the Assign Class picker does.

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from class_catalog;   -- must return 0 rows, never an error.
