-- ============================================================================
-- 0014 — DRAFT SLOT ON THE FEATURE CATALOG
--
-- The Feature Editor's draft ladder is:
--
--     localStorage  ──autosave──>  feature_catalog.draft  ──publish──>  .data
--
-- `data` stays the PUBLISHED content — the only thing a grant may snapshot onto
-- a character. `draft` is the DM's in-progress edit. Keeping them apart is what
-- makes "nothing a player sees moves until Publish" true rather than
-- aspirational: a template can be rewritten mid-campaign without touching the
-- version the Grant picker offers.
--
-- WHY A COLUMN IS SAFE HERE AND NOT ON shard_tree_catalog: feature_catalog has
-- no player policy at all (migration 0005) — a non-DM select matches nothing and
-- returns zero rows, so every column is already DM-only. shard_tree_catalog does
-- have a player policy (0008), and RLS is row-level, so a draft column there
-- would hand players the DM's unpublished work. Shard drafts therefore live in
-- shard_tree_secrets.data.draft instead, which is DM-only for the same reason
-- concealed node text already lives there.
--
-- `published` is NOT a column: it rides inside `data`, matching ShardTree.
-- Nothing in SQL reads it (no player policy needs it) — the Grant picker does.
-- ============================================================================

alter table feature_catalog
  add column if not exists draft jsonb;

comment on column feature_catalog.draft is
  'In-progress edit. Publish promotes this into data and clears it. Null = no unpublished work.';

-- A row that has only ever been drafted has data = '{}'. The editor reads
-- draft ?? data; the Grant picker reads data and skips anything unpublished.

-- Backfill: every row that predates `published` WAS grantable, and the Grant
-- picker now hides anything without the flag. Without this, adding the field
-- silently retires the existing library. Guarded, so re-running the file cannot
-- republish something the DM has since pulled.
update feature_catalog
   set data = data || '{"published": true}'::jsonb
 where data->>'published' is null;

-- Backfill: `order` is the DM's sort position WITHIN a folder, and the editor
-- reorders by writing the midpoint between two neighbours — one row write per
-- drag instead of renumbering the whole folder. That only works if every row
-- already has a number to sit between, so seed the existing alphabetical order.
-- Guarded, so re-running the file cannot flatten an ordering the DM has since
-- arranged by hand.
with ranked as (
  select id,
         (row_number() over (
            partition by data->>'folder'
            order by data->>'name'
         ) - 1)::int as ord
    from feature_catalog
   where data->>'order' is null
)
update feature_catalog f
   set data = f.data || jsonb_build_object('order', r.ord)
  from ranked r
 where f.id = r.id;
