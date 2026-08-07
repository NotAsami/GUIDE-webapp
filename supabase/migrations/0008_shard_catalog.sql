-- G.U.I.D.E. Codex — the shard tree catalog (Phase 5, Shard Interface).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- A shard tree is authored content, same reference pattern as item/feature
-- catalog: `characters.shards` (0001_init.sql) holds only a slot id + a
-- player's progress (earned/attuned) — never a copy of the tree.
--
-- UNLIKE item_catalog / feature_catalog, this table DOES carry a player
-- policy: the Shard screen and the Shard Upgrade Tree modal have to render a
-- published tree for a bound player. What must NOT reach the player —
-- `dm` notes on the shard/every node, and the real name/effect/mods of a
-- `concealed` node — lives in `shard_tree_secrets` instead. A concealed node
-- therefore ships to `shard_tree_catalog` as bare geometry only:
--   { id, tier, angle, cost, prereqs, branch, concealed: true }
-- so the "???" hexagon draws in the right place with the right edges, and
-- the payload has nothing in it to spoil. THE SECURITY ON THE SECRETS TABLE
-- IS THE ABSENCE OF A PLAYER POLICY, same wall as quest_secrets (0003) /
-- character_secrets (0002) — a non-DM select matches no policy and returns
-- ZERO ROWS, not an error.

create table if not exists shard_tree_catalog (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists shard_tree_secrets (
  shard_id   text primary key references shard_tree_catalog (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists shard_tree_catalog_set_updated_at on shard_tree_catalog;
create trigger shard_tree_catalog_set_updated_at
  before update on shard_tree_catalog
  for each row execute function tg_set_updated_at();

drop trigger if exists shard_tree_secrets_set_updated_at on shard_tree_secrets;
create trigger shard_tree_secrets_set_updated_at
  before update on shard_tree_secrets
  for each row execute function tg_set_updated_at();

alter table shard_tree_catalog enable row level security;
alter table shard_tree_secrets enable row level security;

-- DM read/write across the whole library (drafts included).
drop policy if exists dm_shard_tree_catalog on shard_tree_catalog;
create policy dm_shard_tree_catalog on shard_tree_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- Bound players read PUBLISHED trees only. Scope is bound players, not
-- `authenticated` — an account with no character row is a stranger and sees
-- nothing here either (same shape as 0007's quest/session read policies).
drop policy if exists player_read_published_shards on shard_tree_catalog;
create policy player_read_published_shards on shard_tree_catalog
  for select
  using (
    (data ->> 'published') = 'true'
    and exists (select 1 from characters where owner = auth.uid())
  );

-- DM-only, no player policy — ever.
drop policy if exists dm_shard_tree_secrets on shard_tree_secrets;
create policy dm_shard_tree_secrets on shard_tree_secrets
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account with a bound character):
--   select id from shard_tree_catalog;           -- published rows only
--   select * from shard_tree_catalog
--     where (data->>'published') <> 'true';      -- 0 rows
--   select * from shard_tree_secrets;             -- 0 rows, never an error
-- As a STRANGER (no characters row, not in dm_users):
--   select * from shard_tree_catalog;             -- 0 rows
