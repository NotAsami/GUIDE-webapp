-- ── 0028: the Journal's bounty board — personal quests, and what a session moved ──
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run). Idempotent.
--
-- PERSONAL QUESTS. A quest can belong to one character. It shows on that
-- player's board and their Character story card, and NOBODY else's: the player
-- policy is where that is decided, so another player's client never receives
-- the row (the same shape as 0026's `visible` gate). Null = the whole party, so
-- every quest that exists today is unchanged. Deleting the character hands the
-- quest back to the party rather than deleting it.
--
-- SESSION LINKS. What a session moved: `[{ "kind": "quest"|"handout", "ref": uuid }]`,
-- written by the prep board's wrap from the cards that were fired. References
-- only — no titles, no text — so a player resolves each against the rows RLS
-- already lets them read, and a handout pushed only to someone else, or another
-- player's personal quest, simply does not resolve. Stored on the session side
-- only; "the sessions that moved this quest" is derived from it, never copied.

alter table quests add column if not exists character_id uuid references characters (id) on delete set null;
create index if not exists quests_character on quests (character_id) where character_id is not null;

drop policy if exists player_read_quests on quests;
create policy player_read_quests on quests
  for select
  using (
    visible
    and exists (select 1 from characters where owner = auth.uid())
    and (character_id is null or character_id in (select id from characters where owner = auth.uid()))
  );

alter table sessions add column if not exists links jsonb not null default '[]'::jsonb;

-- VERIFY (as a NON-DM account — the DM reads every row whatever this says):
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<a player''s auth uid>')::text, true);
--   select title, character_id from quests;   -- party quests + only THIS player's personal ones
--   rollback;
