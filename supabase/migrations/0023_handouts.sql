-- ── 0023: handouts — a document or image the DM hands to a player ─────────
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- A HANDOUT IS A RECORD, NOT A MOMENT. The voice channel (lib/voice.ts) is for
-- moments — an offline player misses a toast and that is fine. A letter the
-- party found is the opposite: it has to be there next session, so it is a row.
--
-- TWO STATES, ONE VISIBILITY RULE.
--   recipients  every character who HOLDS it — their Journal files it. Only
--               ever grows from the console's Push / File (a letter shown to
--               Ros last week is still Ros's after it is pushed to someone else).
--   on_screen   the characters it is open in front of RIGHT NOW. Push sets it,
--               Recall empties it.
-- The check below makes on_screen a subset of recipients, so "can this player
-- read the row" is one question — are they a recipient — and "is it on their
-- screen" is a client-side read of a row they already have. No second policy,
-- no join table to police.
--
-- DRAFTS ARE SAFE BY CONSTRUCTION: a handout with no recipients matches no
-- player policy, the same wall 0014 relies on for drafts elsewhere.

create table if not exists handouts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  -- Player-facing prose. Rendered through <Prose>, authored with proseField.
  body        text not null default '',
  -- A pasted public URL, the way identity.portrait works. Uploads are their own
  -- later slice (docs/notes.md "BETTER IMAGE UPLOADS").
  image_url   text not null default '',
  -- One quest, optional. `set null` so deleting a quest does not take the
  -- handouts filed under it out of anyone's Journal.
  quest_id    uuid references quests (id) on delete set null,
  recipients  uuid[] not null default '{}',
  on_screen   uuid[] not null default '{}',
  -- Bumped on every Push. A player who dismissed the last push keys that
  -- dismissal on this, so the next push opens it again.
  pushed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint handouts_on_screen_held check (on_screen <@ recipients)
);

drop trigger if exists trg_handouts_updated on handouts;
create trigger trg_handouts_updated
  before update on handouts
  for each row execute function tg_set_updated_at();

alter table handouts enable row level security;

drop policy if exists dm_handouts on handouts;
create policy dm_handouts on handouts
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- SELECT only. A player never writes a handout: dismissing the dock and the
-- NEW dot are per-browser conveniences (localStorage), not state.
drop policy if exists player_read_handouts on handouts;
create policy player_read_handouts on handouts
  for select
  using (
    exists (
      select 1 from characters c
      where c.owner = auth.uid() and c.id = any (handouts.recipients)
    )
  );

-- The dock opens the moment the DM pushes, which is the feature. Realtime
-- respects RLS, so a draft or someone else's handout pushes nothing.
alter publication supabase_realtime add table handouts;

-- VERIFY (as a NON-DM account):
--   select id, title from handouts;           -- only rows where you are a recipient
--   select count(*) from pg_policies
--    where tablename = 'handouts';            -- must be exactly 2
