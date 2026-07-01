-- G.U.I.D.E. Codex — campaign-level tables (Phase 2, Operator Console slice 4).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- Sessions and quests are CAMPAIGN-WIDE, not per-character (handoff §2). They are
-- DM-authored here; the player Journal that reads them is a later slice.
--
-- gmNotes SPLIT: a quest's DM-only notes live in their own `quest_secrets` table,
-- NOT a column on `quests` — exactly like `character_secrets` (migration 0002).
-- Reason: the day the player-Journal slice grants players SELECT on `quests`, a
-- `gm_notes` column would ship to every player and nothing would flag it. Keeping
-- it in a no-player-policy table makes `quests` permanently safe to expose.
--
-- RLS for now: all three tables are DM-only (membership in `dm_users`). Player
-- read access — and the visibility/published model it implies — is deferred to
-- the player Journal slice, so there is intentionally NO player policy yet.

-- ---- sessions (recap log; entirely player-facing, no secret table needed) ----
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  num        int  not null default 1,
  title      text not null default '',
  date       text not null default '',
  recap      text not null default '',
  events     jsonb not null default '[]'::jsonb,   -- string[]
  updated_at timestamptz not null default now()
);

-- ---- quests (player-facing fields only) ----
create table if not exists quests (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  type        text not null default 'side'   check (type   in ('main','side')),
  status      text not null default 'active' check (status in ('active','completed','failed')),
  location    text not null default '',
  given_by    text not null default '',
  description text not null default '',
  objectives  jsonb not null default '[]'::jsonb,   -- { text, done }[]
  related     jsonb not null default '[]'::jsonb,   -- string[]
  created_at  timestamptz not null default now(),   -- stable list order (edits don't reshuffle)
  updated_at  timestamptz not null default now()
);

-- ---- quest_secrets (DM-only gmNotes; no player policy, by design) ----
create table if not exists quest_secrets (
  quest_id   uuid primary key references quests (id) on delete cascade,
  gm_notes   text not null default '',
  updated_at timestamptz not null default now()
);

-- updated_at triggers (reuse tg_set_updated_at from 0001_init.sql)
drop trigger if exists sessions_set_updated_at on sessions;
create trigger sessions_set_updated_at before update on sessions
  for each row execute function tg_set_updated_at();
drop trigger if exists quests_set_updated_at on quests;
create trigger quests_set_updated_at before update on quests
  for each row execute function tg_set_updated_at();
drop trigger if exists quest_secrets_set_updated_at on quest_secrets;
create trigger quest_secrets_set_updated_at before update on quest_secrets
  for each row execute function tg_set_updated_at();

alter table sessions      enable row level security;
alter table quests        enable row level security;
alter table quest_secrets enable row level security;

-- DM-only read/write on all three. No player policy yet (see header).
drop policy if exists dm_sessions on sessions;
create policy dm_sessions on sessions for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

drop policy if exists dm_quests on quests;
create policy dm_quests on quests for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

drop policy if exists dm_quest_secrets on quest_secrets;
create policy dm_quest_secrets on quest_secrets for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY (as a NON-DM second account): each of
--   select * from sessions;   select * from quests;   select * from quest_secrets;
-- must return 0 rows, never an error.
