-- ============================================================================
-- 0017 — THE RACE CATALOG
--
-- The twin of class_catalog (0016), and deliberately so: a race is the same
-- KIND of object as a class — a named template that grants features, declares
-- variables, contributes rules, and is stamped onto a character by an assign
-- step that snapshots what it grants. Same table shape, same draft ladder, same
-- DM-only wall, so one editor serves both.
--
-- WHAT A RACE DOES *NOT* CARRY, and why:
--
--   * no ability score fields. A racial +2 DEX is a `boost` rule in the race's
--     own graph, compiled by lib/modEditor.ts sheetEffects and layered by
--     effectiveSheet exactly like a worn item's — so it comes back off when the
--     race changes. A field here would be a one-way write nobody could audit.
--   * no speed / darkvision fields, for the same reason: both are boosts.
--   * no hit die, saving throws or spell slots. Those are the class's answer.
--
-- SUBRACES are rows in THIS table with `data.parent` naming their parent race,
-- rather than a nested structure — a subrace grants features, rules and
-- proficiencies exactly as a race does, so it wants the whole editor, not a
-- cut-down copy of it nested inside one.
--
-- DM-ONLY: THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — a non-DM select
-- matches no policy and returns ZERO ROWS. That absence is also what makes the
-- `draft` column safe here, exactly as 0014 argued for feature_catalog: RLS is
-- row-level, so a draft column on a table players CAN select would hand them
-- the DM's unpublished work. Players never read this table at all; what reaches
-- them is the snapshot Assign Race writes onto their own character row.
-- ============================================================================

create table if not exists race_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  draft      jsonb,
  updated_at timestamptz not null default now()
);

comment on column race_catalog.draft is
  'In-progress edit. Publish promotes this into data and clears it. Null = no unpublished work.';

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists race_catalog_set_updated_at on race_catalog;
create trigger race_catalog_set_updated_at
  before update on race_catalog
  for each row execute function tg_set_updated_at();

alter table race_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_race_catalog on race_catalog;
create policy dm_race_catalog on race_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from race_catalog;   -- must return 0 rows, never an error.
