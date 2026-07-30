-- G.U.I.D.E. Codex — the item catalog (Phase 2, Operator Console slice 5).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- The DM authors items ONCE here, then Grant Item snapshots a chosen template
-- into a player's `characters.inventory` with a fresh instance id + an `item_id`
-- back-reference to this row (see docs handoff §5.1 "one items table, Grant Item
-- reads from the catalog"). We snapshot (not reference-hydrate) so the verified
-- player Inventory/Equipment screens keep receiving self-describing items and are
-- left completely untouched; the `item_id` on each granted copy keeps a future
-- live-hydration refactor a clean, migration-free data-layer change.
--
-- DM-ONLY, exactly like character_secrets (0002): with snapshots a player never
-- needs to read the catalog, so keeping it DM-only means un-granted loot can't
-- leak to a player client and spoil what's coming. THE SECURITY IS THE ABSENCE OF
-- A PLAYER POLICY — a non-DM select matches no policy and returns ZERO ROWS.
--
-- `data` is a full item definition (the app's InventoryItem shape: name, category,
-- slot, rarity, icon, w/h footprint, weight, flavor, structured `effects`, display
-- `rows`, plus weapon/consumable fields) MINUS per-instance state (id/qty/col/row),
-- which Grant Item stamps on at grant time.

create table if not exists item_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists item_catalog_set_updated_at on item_catalog;
create trigger item_catalog_set_updated_at
  before update on item_catalog
  for each row execute function tg_set_updated_at();

alter table item_catalog enable row level security;

-- DM read/write across the whole catalog. No player policy by design.
drop policy if exists dm_catalog on item_catalog;
create policy dm_catalog on item_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY THE GUARD (run as a NON-DM account — your second test login):
--   select * from item_catalog;   -- must return 0 rows, never an error.
-- As the DM the same query returns every authored template.
