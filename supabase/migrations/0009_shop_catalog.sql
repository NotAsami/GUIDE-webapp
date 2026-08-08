-- G.U.I.D.E. Codex — the shop catalog (shop feature, part 1).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- docs/notes.md §SHOP FEATURE: a shopkeeper is DM-authored content (same
-- reference pattern as item/feature/shard catalog) that the DM fires live at
-- one PC or the whole party. Stock lives ON the template — buying decrements
-- `data.stock[i].qty` permanently; the DM restocks by editing it. There is no
-- separate "opening" table, so re-firing the same shop resumes wherever the
-- last one left off.
--
-- `is_open` / `open_for` are real columns, not buried in `data` — RLS keys off
-- them, and Postgres can't index into JSONB inside a policy as cheaply as a
-- plain column. `open_for` null means "the whole party"; set means one PC.
--
-- Concurrency (notes.md: "server side check of item purchase, first one wins,
-- other gets out of stock popup") is the WHOLE reason `shop_buy` below exists
-- as an RPC instead of a plain client UPDATE: two players clicking BUY on the
-- last potion race for the same `for update` row lock, and only one wins it.

create table if not exists shop_catalog (
  id         text primary key default gen_random_uuid()::text,
  data       jsonb   not null default '{}'::jsonb,
  is_open    boolean not null default false,
  open_for   uuid    references characters (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Reuse the updated_at trigger function defined in 0001_init.sql.
drop trigger if exists shop_catalog_set_updated_at on shop_catalog;
create trigger shop_catalog_set_updated_at
  before update on shop_catalog
  for each row execute function tg_set_updated_at();

alter table shop_catalog enable row level security;

-- DM read/write across the whole library (open or not, stock and all).
drop policy if exists dm_shop_catalog on shop_catalog;
create policy dm_shop_catalog on shop_catalog
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- Bound players see an OPEN shop only, and only when it's open for them —
-- `open_for is null` is "whole party". A closed shop is invisible at the
-- Postgres level, same wall as confiscated_items (0006). No player UPDATE
-- policy at all: the only path that can mutate stock or coin is shop_buy().
drop policy if exists player_read_open_shops on shop_catalog;
create policy player_read_open_shops on shop_catalog
  for select
  using (
    is_open
    and exists (
      select 1 from characters c
      where c.owner = auth.uid()
        and (shop_catalog.open_for is null or shop_catalog.open_for = c.id)
    )
  );

alter publication supabase_realtime add table shop_catalog;

-- ── shop_buy — the server-side purchase check ──────────────────────────────
-- SECURITY DEFINER so the row lock below can see (and touch) the shop and the
-- caller's own character row regardless of RLS; every guard RLS would
-- normally give for free on a SELECT is therefore re-checked by hand here.
-- `for update` on the shop row is the actual concurrency fix: the second of
-- two simultaneous buyers blocks on the lock, re-reads post-decrement stock,
-- and gets a clean 'sold_out' instead of a race.
--
-- ponytail: the inventory WRITE (placing the item on the character's grid)
-- happens client-side after this returns, not inside this transaction — a
-- client crash between the two leaves the player charged with nothing granted.
-- Fine for a private table; the DM can eyeball the ledger and re-grant. A
-- durable fix would move the inventory placement into this function too, but
-- routeItem()'s footprint/container logic is TypeScript, not SQL.
create or replace function shop_buy(p_shop_id text, p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      shop_catalog%rowtype;
  v_char     characters%rowtype;
  v_stock    jsonb;
  v_line     jsonb;
  v_idx      int;
  v_mode     text;
  v_qty      int;
  v_gold     int;
  v_silver   int;
  v_copper   int;
  v_total_cp bigint;
  v_price_cp bigint;
  v_rem_cp   bigint;
  v_new_coins jsonb;
begin
  select * into v_row from shop_catalog where id = p_shop_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  select * into v_char from characters where owner = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_character');
  end if;

  if not v_row.is_open or (v_row.open_for is not null and v_row.open_for <> v_char.id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  v_stock := coalesce(v_row.data -> 'stock', '[]'::jsonb);
  v_idx := null;
  for i in 0 .. jsonb_array_length(v_stock) - 1 loop
    if v_stock -> i ->> 'item_id' = p_item_id then
      v_idx := i;
      v_line := v_stock -> i;
      exit;
    end if;
  end loop;
  if v_idx is null then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  -- notes.md: "they can't sell relics" — re-checked here, not just in the
  -- console's picker, because the picker's guard is client-side only.
  if (v_line -> 'item' ->> 'category') = 'quest' then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  v_mode := v_line ->> 'mode';
  v_qty := coalesce((v_line ->> 'qty')::int, 0);
  if v_mode = 'limited' and v_qty <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'sold_out');
  end if;

  v_gold := coalesce((v_char.sheet -> 'coins' ->> 'gold')::int, 0);
  v_silver := coalesce((v_char.sheet -> 'coins' ->> 'silver')::int, 0);
  v_copper := coalesce((v_char.sheet -> 'coins' ->> 'copper')::int, 0);
  v_total_cp := v_gold::bigint * 100 + v_silver::bigint * 10 + v_copper::bigint;
  v_price_cp := coalesce((v_line ->> 'price')::int, 0)::bigint * 100;

  if v_total_cp < v_price_cp then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'short_cp', v_price_cp - v_total_cp);
  end if;

  -- Spend, then re-split into the fewest denominations — standard make-change,
  -- and the only way the purse doesn't slowly fill up with loose copper.
  v_rem_cp := v_total_cp - v_price_cp;
  v_new_coins := jsonb_build_object(
    'gold', v_rem_cp / 100,
    'silver', (v_rem_cp % 100) / 10,
    'copper', v_rem_cp % 10
  );

  update characters set sheet = jsonb_set(sheet, '{coins}', v_new_coins) where id = v_char.id;

  if v_mode = 'limited' then
    v_stock := jsonb_set(v_stock, array[v_idx::text, 'qty'], to_jsonb(v_qty - 1));
    update shop_catalog set data = jsonb_set(v_row.data, '{stock}', v_stock) where id = p_shop_id;
  end if;

  return jsonb_build_object('ok', true, 'item', v_line -> 'item', 'item_id', p_item_id, 'coins', v_new_coins);
end;
$$;

-- Postgres (and Supabase's own default privileges) grant EXECUTE to PUBLIC
-- and to `anon` directly on function creation — revoke both explicitly.
-- Harmless either way (anon has no auth.uid(), so every check inside fails
-- safely), but there's no reason to leave the surface open.
revoke execute on function shop_buy(text, text) from public;
revoke execute on function shop_buy(text, text) from anon;
grant execute on function shop_buy(text, text) to authenticated;

-- ── shop_open — atomic "close everything else, open this one" ─────────────
-- "At most one shop open" has to be a single transaction, not two separate
-- client UPDATEs: two DMs (or one DM double-clicking) firing different shops
-- at the same moment can otherwise interleave close-A/close-B/open-A/open-B
-- and leave BOTH open, which is exactly the state useOpenShop's `data[0]`
-- can't tell apart from a bug. Wrapping both statements in one plpgsql
-- function makes them commit together, and Postgres's normal row-lock
-- ordering (backed by its deadlock detector) means a genuinely concurrent
-- second call either serializes cleanly after the first or fails outright —
-- it can never partially apply.
create or replace function shop_open(p_id text, p_character_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from dm_users where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  update shop_catalog set is_open = false, open_for = null where id <> p_id;
  update shop_catalog set is_open = true, open_for = p_character_id where id = p_id;
end;
$$;

revoke execute on function shop_open(text, uuid) from public;
revoke execute on function shop_open(text, uuid) from anon;
grant execute on function shop_open(text, uuid) to authenticated;

-- VERIFY THE GUARD (run as a NON-DM account with a bound character):
--   select id from shop_catalog;                  -- 0 rows while every shop is closed
--   select shop_buy('nonexistent', 'nonexistent'); -- {"ok": false, "reason": "gone"}
-- After the DM opens a shop for someone ELSE'S character:
--   select id from shop_catalog;                  -- still 0 rows
