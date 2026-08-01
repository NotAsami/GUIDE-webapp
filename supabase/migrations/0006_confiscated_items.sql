-- G.U.I.D.E. Codex — confiscated items (Inventory Refactor, slice 1).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- Confiscation and locking are two DIFFERENT mechanics, deliberately:
--
--   LOCKED       a per-item flag on the item itself (`locked: true`, lives in
--                `characters.inventory`). The item keeps its cell, still counts
--                toward carry weight, shows a lock icon, and cannot be used. It is
--                in your pack and simply refusing you. NOT this table.
--
--   CONFISCATED  the item LEAVES the character row entirely and lands here. The
--                player sees nothing: no row, no weight, no count, no trace. The
--                guards took your sword and the Codex declines to discuss it.
--
-- THE SECURITY IS THE ABSENCE OF A PLAYER POLICY — same pattern as character_secrets
-- (0002) and item_catalog (0004). A non-DM select matches no policy and returns ZERO
-- ROWS, so invisibility is enforced by Postgres, not by a client-side filter that a
-- player's browser could be talked out of.
--
-- `from` is the item's placement object copied verbatim at the moment it was taken:
--   { "containerId": "person", "col": 3, "row": 2 }   -- was on the grid
--   { "containerId": "backpack" }                     -- was in a container (no geometry)
-- Restore reads it back as-is. When that placement is no longer valid (the cell is
-- occupied, the container is gone) the app falls through to the normal routing chain
-- — see the Inventory Refactor spec §7.

create table if not exists confiscated_items (
  id           text primary key default gen_random_uuid()::text,
  character_id uuid not null references characters(id) on delete cascade,
  item         jsonb not null,
  "from"       jsonb not null default '{}'::jsonb,
  note         text  not null default '',
  taken_at     timestamptz not null default now()
);

-- The DM's list for one character, newest first.
create index if not exists confiscated_items_character_idx
  on confiscated_items (character_id, taken_at desc);

alter table confiscated_items enable row level security;

-- DM read/write across every character. No player policy, by design.
drop policy if exists dm_confiscated on confiscated_items;
create policy dm_confiscated on confiscated_items
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from confiscated_items;   -- must return 0 rows, never an error.
-- As the DM the same query returns everything ever taken.
