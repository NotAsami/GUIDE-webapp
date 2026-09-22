-- ── 0024: NPCs, who knows whom, and what each player has learned ─────────────
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- WHAT IS NOT HERE, ON PURPOSE. The NPC web draws three kinds of tie and only
-- one of them is stored in this migration:
--   PC → NPC      characters.lore.relations — the player's own Lore screen
--                 already owns these; the web READS them, never copies them.
--   quest → NPC   quests.given_by, and quests.related tags that name a
--                 recorded NPC — derived, so a quest edit moves the web.
--   NPC ↔ NPC     npc_links, below. The only tie nobody else knew about.
-- Everything is matched by NAME (trimmed, case-insensitive), because every one
-- of those sources has always referenced an NPC by free text. There is no
-- location or faction table: an NPC's sector on the web is its `location`
-- string, the same free text quests.location is.
--
-- WHAT A PLAYER SEES. Their own relations and every quest giver they could
-- already read; beyond that, only what the DM REVEALS, per character:
--   npcs.known_to       who has learned this NPC's record (role, place, blurb,
--                       portrait) — without it they know a name at most.
--   npc_links.known_to  who has learned this tie. The console reveals both
--                       ends with it: a tie between two strangers is a line
--                       between nothing, and the web drops it.
-- Same shape and same policy as handouts.recipients (0023).
--
-- gm_notes LIVES IN npc_secrets, NOT ON THE ROW — the 0002/0003 split, for the
-- reason those give: npcs has a player read policy, so anything on the row is
-- anything a player can select. The first draft of this file kept it on the row
-- "until a player view exists"; the player view arrived before it was applied.

create table if not exists npcs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default '',
  role        text not null default '',
  location    text not null default '',
  portrait    text not null default '',   -- a pasted URL, like identity.portrait
  blurb       text not null default '',   -- what the party knows (prose)
  known_to    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One record per name: the web matches everything else to a record by name, so
-- two "The Lady" rows would make every tie to her ambiguous.
create unique index if not exists npcs_name_key on npcs (lower(btrim(name)));

create table if not exists npc_secrets (
  npc_id      uuid primary key references npcs (id) on delete cascade,
  gm_notes    text not null default '',
  updated_at  timestamptz not null default now()
);

-- Undirected: a tie between Voss and The Lady is one row, whichever way it was
-- drawn. The pair index on (least, greatest) makes the second drawing an error
-- instead of a duplicate line.
create table if not exists npc_links (
  id          uuid primary key default gen_random_uuid(),
  a           uuid not null references npcs (id) on delete cascade,
  b           uuid not null references npcs (id) on delete cascade,
  kind        text not null default 'Ally',
  attitude    text check (attitude in ('friendly', 'neutral', 'wary', 'hostile')),
  label       text not null default '',
  known_to    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint npc_links_not_self check (a <> b)
);
create unique index if not exists npc_links_pair on npc_links (least(a, b), greatest(a, b));

drop trigger if exists trg_npcs_updated on npcs;
create trigger trg_npcs_updated
  before update on npcs
  for each row execute function tg_set_updated_at();
drop trigger if exists trg_npc_secrets_updated on npc_secrets;
create trigger trg_npc_secrets_updated
  before update on npc_secrets
  for each row execute function tg_set_updated_at();

alter table npcs enable row level security;
alter table npc_secrets enable row level security;
alter table npc_links enable row level security;

drop policy if exists dm_npcs on npcs;
create policy dm_npcs on npcs
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- DM-only, and only DM-only: the reason this table exists.
drop policy if exists dm_npc_secrets on npc_secrets;
create policy dm_npc_secrets on npc_secrets
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

drop policy if exists dm_npc_links on npc_links;
create policy dm_npc_links on npc_links
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- SELECT only, and only what was revealed to one of your characters.
drop policy if exists player_read_npcs on npcs;
create policy player_read_npcs on npcs
  for select
  using (exists (select 1 from characters c where c.owner = auth.uid() and c.id = any (npcs.known_to)));

drop policy if exists player_read_npc_links on npc_links;
create policy player_read_npc_links on npc_links
  for select
  using (exists (select 1 from characters c where c.owner = auth.uid() and c.id = any (npc_links.known_to)));

-- No realtime publication: the console re-reads its own writes, and a reveal
-- reaching a player on their next visit to the web is soon enough.

-- VERIFY (as a NON-DM account):
--   select * from npc_secrets;              -- always 0 rows
--   select * from npcs; select * from npc_links;   -- only rows revealed to you
--   select count(*) from pg_policies where tablename in ('npcs','npc_links','npc_secrets');  -- 5
