-- G.U.I.D.E. Codex — shop prices in gp/sp/cp (QoL: "add a way to have items
-- cost different currencies in shops"). Apply via Supabase SQL editor.
--
-- `shop_buy` (0009) already does correct auto-conversion — it flattens the
-- whole purse to copper, subtracts, and re-splits into fewest denominations.
-- What was missing was the AUTHORING side: every stock line's `price` was
-- always gp (`* 100` hardcoded). ShopStockLine now carries an optional
-- `unit` ('gp'|'sp'|'cp', absent = 'gp' — every pre-existing row keeps
-- working with no data migration). This just teaches shop_buy to read it.
--
-- The cp-per-unit table here MUST match src/lib/coins.ts's `priceCp` exactly
-- — that file's header comment already flags this contract; this is the
-- server half of it.
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
  v_unit     text;
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

  v_unit := coalesce(v_line ->> 'unit', 'gp');
  v_price_cp := coalesce((v_line ->> 'price')::int, 0)::bigint
    * (case v_unit when 'sp' then 10 when 'cp' then 1 else 100 end);

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

-- create or replace preserves the existing grants/ownership, but re-assert
-- explicitly anyway — cheap, and it's what 0009 did on first create.
revoke execute on function shop_buy(text, text) from public;
revoke execute on function shop_buy(text, text) from anon;
grant execute on function shop_buy(text, text) to authenticated;

-- VERIFY:
--   Set a stock line's unit to 'sp' via the shopkeeper editor (price 5),
--   open the shop for a character holding 0gp/8sp/0cp, buy it:
--   select sheet->'coins' from characters where id = '<char id>';
--   -- {"gold": 0, "silver": 3, "copper": 0}
