-- ── 0020: the open loot roll — what the party is looking at right now ──────
--
-- WHY THIS IS ITS OWN TABLE, and not `is_open`/`open_for` columns on
-- loot_catalog the way shop_catalog carries them:
--
--   shop_catalog has NO `draft` column, so it can afford a player SELECT
--   policy. loot_catalog HAS one, and 0019 states in as many words that the
--   draft column is safe precisely because the table has no player policy
--   (0014's rule). Adding one to let the party read an open roll would expose
--   every unpublished draft in the library, plus every table's contents and
--   drop chances — the whole point of a loot table being a secret.
--
-- So the roll is COPIED out of the library into this table when the DM opens
-- it, and this table is the only loot thing a player can ever read.
--
-- SNAPSHOTTED, for the same reason ShopStockLine.item is: item_catalog is
-- DM-only (0004), so a player cannot resolve an item_id into a name or an
-- icon. Every rolled line therefore carries its own copy of the item data,
-- and the container chrome carries its own copy of the icon/kind/name/
-- location/desc. Deleting the template later does not blank a live roll.
--
-- READ-ONLY FOR PLAYERS, by design and not by omission. The DM assigns each
-- line; the party watches it resolve. There is no player UPDATE policy and no
-- claim RPC, which is what removes the contention problem entirely — one
-- writer, so two players cannot both take the last torch.

create table if not exists loot_open (
  id         uuid primary key default gen_random_uuid(),
  -- Provenance only. `on delete set null` so deleting the template does not
  -- take a live roll down with it — the snapshot below is self-sufficient.
  -- TEXT, not uuid: catalog ids are text across this schema (loot_catalog and
  -- shop_catalog both). characters.id below really is a uuid.
  table_id   text references loot_catalog (id) on delete set null,
  -- { icon, kind, name, location, desc } — the container as the player meets it.
  container  jsonb not null default '{}'::jsonb,
  -- [{ key, item_id, item, qty, assigned_to, assigned_name }]
  --   key          stable per line, so assigning survives a re-render
  --   item         CatalogItemData snapshot (see above)
  --   assigned_to  characters.id, or null while unclaimed
  --   assigned_name  denormalised: a player cannot read another character's
  --                  row, so the name has to travel with the line for the
  --                  "→ ROS" chip to render at all.
  lines      jsonb not null default '[]'::jsonb,
  is_open    boolean not null default false,
  -- null = the whole party, same convention as shop_catalog.open_for.
  open_for   uuid references characters (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_loot_open_updated on loot_open;
create trigger trg_loot_open_updated
  before update on loot_open
  for each row execute function tg_set_updated_at();

alter table loot_open enable row level security;

-- DM read/write. Rolling, assigning, pushing and closing are all plain writes
-- from the console — no SECURITY DEFINER function is needed anywhere here,
-- because the DM is the only writer and they already hold this policy.
drop policy if exists dm_loot_open on loot_open;
create policy dm_loot_open on loot_open
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- Bound players see an OPEN roll only, and only when it is open for them.
-- A closed roll is invisible at the Postgres level, the same wall shop_catalog
-- (0009) and confiscated_items (0006) use. SELECT only — deliberately no
-- player UPDATE policy, see the header.
drop policy if exists player_read_open_loot on loot_open;
create policy player_read_open_loot on loot_open
  for select
  using (
    is_open
    and exists (
      select 1 from characters c
      where c.owner = auth.uid()
        and (loot_open.open_for is null or loot_open.open_for = c.id)
    )
  );

-- The player screen watches the distribution resolve as the DM assigns, which
-- is the whole feel of it — without this the party would have to reload to see
-- who got what. Realtime respects RLS, so a closed roll still pushes nothing.
alter publication supabase_realtime add table loot_open;

-- Only one roll open at a time is an APP-LEVEL rule, enforced the same way
-- shop_open does it (0009 closes every other shop when one opens) rather than
-- by a constraint — the party looting two containers at once is a scene the DM
-- might legitimately want, and a unique index would make it impossible rather
-- than merely unusual.

-- VERIFY (run as a NON-DM account — your second test login):
--   select * from loot_open;                  -- 0 rows while nothing is open
--   -- DM opens a roll, then re-run:          -- exactly the open row, and only
--   --                                           if open_for is null or you
--   select count(*) from pg_policies
--    where tablename = 'loot_open';           -- must be exactly 2
