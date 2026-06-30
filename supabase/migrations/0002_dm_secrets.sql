-- G.U.I.D.E. Codex — DM-only per-character secrets (Phase 2, Operator Console).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- WHY A SEPARATE TABLE: the `own_character` RLS policy (0001_init.sql) grants a
-- player full-ROW read of their own `characters` row. So any DM-only field stored
-- there — `digitization`, `lore.trueLore` — would be readable by the player and
-- spoil the dramatic-irony layer (handoff §4). Postgres has no clean column-level
-- RLS, so these fields live in their own table that players cannot read AT ALL.
--
-- THE SECURITY IS THE ABSENCE OF A PLAYER POLICY. With RLS enabled and only the
-- `dm_secrets` policy present, a non-DM `select` matches no policy and returns
-- ZERO ROWS (not an error). Do NOT add an own_character-style policy here.

create table if not exists character_secrets (
  character_id uuid primary key references characters (id) on delete cascade,
  digitization int  not null default 0 check (digitization between 0 and 100),
  true_lore    text not null default '',
  updated_at   timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists character_secrets_set_updated_at on character_secrets;
create trigger character_secrets_set_updated_at
  before update on character_secrets
  for each row execute function tg_set_updated_at();

alter table character_secrets enable row level security;

-- DM read/write across every character's secret. No player policy by design.
drop policy if exists dm_secrets on character_secrets;
create policy dm_secrets on character_secrets
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from character_secrets;   -- must return 0 rows, never an error.
-- As the DM the same query returns one row per character you have touched.
