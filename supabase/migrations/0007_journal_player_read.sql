-- G.U.I.D.E. Codex — player read access for the Journal screen.
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- Migration 0003 created `sessions`, `quests` and `quest_secrets` DM-only and said
-- so in its header: "Player read access — and the visibility/published model it
-- implies — is deferred to the player Journal slice". This is that slice.
--
-- READ ONLY, DELIBERATELY. The Journal renders quests and sessions; it never
-- writes. Objective done-flags are DM-authored in the Operator Console, because
-- `quests` is CAMPAIGN-WIDE — a player toggling `objectives` would be writing a
-- shared row on behalf of the whole party, last-write-wins, with no realtime to
-- tell anyone it happened. If players should ever tick their own objectives, do
-- it through a security-definer RPC that patches one objective index, not a
-- blanket update grant.
--
-- `quest_secrets` GETS NO POLICY, NOW OR EVER. That table exists precisely so
-- that `quests` is safe to expose: every column on `quests` is player-facing by
-- construction, and `gm_notes` lives somewhere a player's select cannot reach.
--
-- SCOPE IS BOUND PLAYERS, NOT `authenticated`. A logged-in account with no
-- character row is a stranger — it sees the "no character bound" screen and it
-- must see no campaign either. Same shape as the rest of the schema's guards.
--
-- No visibility/published model: every quest the DM creates is visible to
-- players immediately. The DM controls visibility by not creating it yet. A
-- draft flag would need a matching field in the console's quest form.

drop policy if exists player_read_quests on quests;
create policy player_read_quests on quests
  for select
  using (exists (select 1 from characters where owner = auth.uid()));

drop policy if exists player_read_sessions on sessions;
create policy player_read_sessions on sessions
  for select
  using (exists (select 1 from characters where owner = auth.uid()));

-- The existing `dm_quests` / `dm_sessions` policies stay as they are: `for all`
-- already covers the DM's read, and policies are permissive (OR'd together).

-- VERIFY:
--   As the PLAYER account (has a characters row):
--     select count(*) from quests;          -- the DM's quests
--     select count(*) from sessions;        -- the DM's sessions
--     select * from quest_secrets;          -- 0 rows, never an error
--     update quests set title = 'x';        -- 0 rows updated (no player policy)
--   As the STRANGER account (no characters row, not in dm_users):
--     select * from quests;                 -- 0 rows
