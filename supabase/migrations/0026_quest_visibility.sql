-- ── 0026: a quest can be written before the party may see it ────────────────
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- 0007 let a bound player read EVERY quest, so writing next week's quest handed
-- it to them the moment it was inserted — the one thing on the prep board that
-- could not be staged. `visible` is that gate, and nothing else about a quest
-- changes: status stays active/completed/failed, because "not yet theirs" is
-- not a state of the quest, it is a question of who may look at it.
--
-- DEFAULT TRUE, so every quest that exists today stays exactly as visible as it
-- is now; only a quest the DM hides (or the prep board creates) starts hidden.
-- The DM policy already covers reading and writing hidden ones.
--
-- Nothing else needs to change: the player's Journal, the story lattice and the
-- completion percent all read `quests` through this policy, so a hidden quest
-- is absent from every one of them — it cannot be counted, listed or linked to
-- by a screen that never receives the row.

alter table quests add column if not exists visible boolean not null default true;

drop policy if exists player_read_quests on quests;
create policy player_read_quests on quests
  for select
  using (visible and exists (select 1 from characters where owner = auth.uid()));

-- VERIFY (as a NON-DM account):
--   select count(*) from quests;                       -- every visible quest
--   -- DM hides one, then re-run: the count drops by one.
