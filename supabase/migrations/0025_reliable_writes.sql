-- Apply before deploying the matching client. Purchases now deliver the item
-- in the same transaction as payment. Old clients fail closed (no payment).
-- Monotonic timestamps make compare-and-swap reliable even within one transaction.
create or replace function tg_set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end $$;

create table if not exists shop_purchase_receipts (
  owner uuid not null references auth.users on delete cascade,
  request_id uuid not null,
  shop_id text not null,
  item_id text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, request_id)
);
alter table shop_purchase_receipts enable row level security;
-- Only the function accesses receipts. Clients cannot invent or erase them.
revoke all on shop_purchase_receipts from anon, authenticated;

create or replace function shop_purchase(
  p_shop_id text, p_item_id text, p_request_id uuid,
  p_character_id uuid, p_character_updated_at timestamptz,
  p_shop_updated_at timestamptz, p_destination jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shop shop_catalog%rowtype;
  v_char characters%rowtype;
  v_receipt shop_purchase_receipts%rowtype;
  v_result jsonb;
  v_item jsonb;
  v_inventory jsonb;
  v_existing jsonb;
  v_idx integer;
  v_container text;
begin
  if auth.uid() is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_character');
  end if;
  -- Serialise duplicate requests before checking the receipt. Different purchases
  -- still use row locks below. A lost reply can be retried after a shop closes.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_request_id::text, 0));
  select * into v_receipt from shop_purchase_receipts
    where owner = auth.uid() and request_id = p_request_id;
  if found then
    if v_receipt.shop_id <> p_shop_id or v_receipt.item_id <> p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
    return v_receipt.result;
  end if;

  -- Same lock order as shop_buy: shop first, then its customer's character.
  select * into v_shop from shop_catalog where id = p_shop_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select * into v_char from characters where id = p_character_id and owner = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_character'); end if;
  -- The existing shop_buy selects by owner; refuse ambiguous ownership rather
  -- than debit one character and deliver to another.
  if (select count(*) from characters where owner = auth.uid()) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_character');
  end if;
  if v_char.updated_at is distinct from p_character_updated_at
    or v_shop.updated_at is distinct from p_shop_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  -- Placement is computed by the existing client geometry against this exact
  -- character version. Only location is accepted; item facts come from stock.
  v_container := p_destination ->> 'containerId';
  if v_container is null or (v_container <> 'person' and not exists (
    select 1 from jsonb_each(coalesce(v_char.equipped -> 'containers', '{}'::jsonb)) e
    where e.value ->> 'id' = v_container
  )) then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if (p_destination ? 'col') <> (p_destination ? 'row') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_destination ? 'col' and (
    coalesce(p_destination ->> 'col', '') !~ '^[1-5]$'
    or coalesce(p_destination ->> 'row', '') !~ '^[1-4]$'
    or v_container <> 'person'
  ) then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  v_result := shop_buy(p_shop_id, p_item_id);
  if not (v_result ->> 'ok')::boolean then return v_result; end if;
  v_item := (v_result -> 'item') || jsonb_build_object(
    'id', 'inst-' || gen_random_uuid()::text, 'item_id', p_item_id,
    'containerId', v_container, 'isNew', true
  );
  -- Never inherit grid coordinates or quantity from a catalog template.
  v_item := v_item - 'col' - 'row' - 'qty';
  if p_destination ? 'col' then
    v_item := v_item || jsonb_build_object('col', (p_destination ->> 'col')::int, 'row', (p_destination ->> 'row')::int);
  end if;
  v_inventory := coalesce(v_char.inventory, '[]'::jsonb);
  if v_item ->> 'category' in ('ammo', 'consumable', 'misc') then
    v_item := v_item || '{"qty":1}'::jsonb;
    -- Same stack identity as placeNew: container/name/category and not locked.
    select value, (ordinality - 1)::int into v_existing, v_idx
      from jsonb_array_elements(v_inventory) with ordinality
      where value ->> 'containerId' = v_container
        and value ->> 'name' = v_item ->> 'name'
        and value ->> 'category' = v_item ->> 'category'
        and not coalesce((value ->> 'locked')::boolean, false)
      order by ordinality limit 1;
  end if;
  if v_existing is not null then
    v_inventory := jsonb_set(v_inventory, array[v_idx::text], v_existing || jsonb_build_object(
      'qty', coalesce((v_existing ->> 'qty')::int, 1) + 1, 'isNew', true));
  else
    v_inventory := v_inventory || jsonb_build_array(v_item);
  end if;
  update characters set inventory = v_inventory where id = v_char.id;
  insert into shop_purchase_receipts(owner, request_id, shop_id, item_id, result)
    values (auth.uid(), p_request_id, p_shop_id, p_item_id, v_result);
  return v_result;
  -- Any exception rolls back ALL writes, including payment and stock changes.
end $$;

revoke execute on function shop_buy(text, text) from public, anon, authenticated;
revoke execute on function shop_purchase(text, text, uuid, uuid, timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function shop_purchase(text, text, uuid, uuid, timestamptz, timestamptz, jsonb) to authenticated;
