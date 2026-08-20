-- ============================================================================
-- 0021 — THE BACKGROUND CATALOG
--
-- The third of the same shape (class 0016, race 0017), and for the same reason:
-- a background is a named template that grants features, proficiencies and
-- rules, and is stamped onto a character by an assign step. Same table, same
-- draft ladder, same DM-only wall, so the editor is the race editor's sibling
-- rather than a new kind of screen.
--
-- WHY IT IS NOT A ROW IN race_catalog WITH A `kind` COLUMN, which was the
-- cheaper option considered: half the race fields are meaningless on a
-- background (`parent`/`subraceLabel` for subraces, the language machinery),
-- and the Races tab would list things that are not races. Two concepts sharing
-- a table because their fields overlap is how both end up carrying dead
-- columns nobody can safely remove later.
--
-- WHAT A BACKGROUND CARRIES, mapping the SRD 5.2 shape onto machinery that
-- already exists rather than inventing any:
--   * ability score increases  -> `boost` rules in `data.graph`, exactly as a
--     racial +2 DEX is. Layered by effectiveSheet, so they come back off when
--     the background changes. A written field would be an unauditable one-way
--     write — the same argument 0017 makes for races.
--   * skill / tool proficiencies -> `data.proficiencies`, the same Proficiencies
--     shape the sheet itself stores.
--   * the granted feat          -> `data.features`, a FeatureGrantRef into
--     feature_catalog. SRD backgrounds each grant exactly one (Magic Initiate,
--     Alert, Savage Attacker), but the list is plural because nothing about the
--     shape needs to assume that.
--   * starting equipment        -> `data.equipment`, the SAME EquipChoice /
--     EquipOption / EquipEntry structure a class's starting kit uses. SRD
--     backgrounds are all "Choose A or B", which is precisely one EquipChoice
--     with two options — so the pending-kit flow that already resolves class
--     equipment resolves this too, with no new player-side UI.
--
-- DM-ONLY: THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — a non-DM select
-- matches no policy and returns ZERO ROWS. That absence is also what makes the
-- `draft` column safe, exactly as 0014 argued: RLS is row-level, so a draft
-- column on a table players CAN select hands them unpublished work.
-- ============================================================================

create table if not exists background_catalog (
  -- Text, like every other catalog id in this schema (see 0020's note).
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  draft      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table background_catalog is
  'DM background library. Twin of race_catalog (0017). Ability increases are boost rules in data.graph, equipment is the class kit''s EquipChoice shape. DM-only: no player policy, which is what makes the draft column safe.';

comment on column background_catalog.draft is
  'In-progress edit. Safe as a column ONLY because this table has no player policy (0014''s rule).';

drop trigger if exists trg_background_catalog_updated on background_catalog;
create trigger trg_background_catalog_updated
  before update on background_catalog
  for each row execute function tg_set_updated_at();

alter table background_catalog enable row level security;

-- DM read/write across the whole library. No player policy by design.
drop policy if exists dm_background_catalog on background_catalog;
create policy dm_background_catalog on background_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from background_catalog;   -- must return 0 rows, never an error.
--   select count(*) from pg_policies
--    where tablename = 'background_catalog';   -- must be exactly 1.
