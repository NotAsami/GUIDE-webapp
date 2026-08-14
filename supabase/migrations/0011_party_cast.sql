-- G.U.I.D.E. Codex — party-cast spells (heal/effect an ally from the player Spellbook).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- `characters`' only player policy is `own_character` (owner = auth.uid()) —
-- a player can't SELECT or UPDATE anyone else's row directly (0001_init.sql).
-- Casting a heal/effect on a party member is a deliberate, narrow exception to
-- that wall, so it goes through two SECURITY DEFINER functions (same pattern
-- as shop_buy/shop_open, 0009) instead of a new broad RLS policy:
--   - list_party_roster() exposes only id/name/race/class/level/hp — never the
--     full row (no inventory, no secrets) — to any caller who owns a character.
--   - cast_party_effect() is the only path that can write another PC's HP or
--     activeEffects. Deliberately dumb (handoff request): no range check, no
--     concentration tracking, no save adjudication — it just applies the
--     numbers the client already rolled/authored.

create or replace function list_party_roster()
returns table(id uuid, name text, race text, class text, level int, hp_current int, hp_max int)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name,
    c.identity ->> 'race', c.identity ->> 'class',
    (c.identity ->> 'level')::int,
    (c.sheet -> 'hp' ->> 'current')::int, (c.sheet -> 'hp' ->> 'max')::int
  from characters c
  where c.owner <> auth.uid()
    and exists (select 1 from characters me where me.owner = auth.uid())
$$;

revoke execute on function list_party_roster() from public;
revoke execute on function list_party_roster() from anon;
grant execute on function list_party_roster() to authenticated;

create or replace function cast_party_effect(p_target uuid, p_heal int, p_effect jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_char   characters%rowtype;
  v_target characters%rowtype;
  v_hp_cur int;
  v_hp_max int;
  v_effect jsonb;
begin
  select * into v_char from characters where owner = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_character');
  end if;

  select * into v_target from characters where id = p_target for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'target_not_found');
  end if;

  if p_heal is not null and p_heal > 0 then
    v_hp_cur := coalesce((v_target.sheet -> 'hp' ->> 'current')::int, 0);
    v_hp_max := coalesce((v_target.sheet -> 'hp' ->> 'max')::int, 0);
    v_hp_cur := least(v_hp_max, v_hp_cur + p_heal);
    update characters set sheet = jsonb_set(sheet, '{hp,current}', to_jsonb(v_hp_cur)) where id = p_target;
  end if;

  if p_effect is not null then
    -- ActiveEffect.effects is required (never optional — Equipment's
    -- summarizeEffects() reads straight off it) but spell-granted effects are
    -- flavor-only (ItemEffects doc: "descriptive effects... deliberately NOT
    -- modelled here"), so force it to {} here rather than trust the client
    -- to remember it every time.
    v_effect := p_effect
      || jsonb_build_object('id', gen_random_uuid()::text)
      || jsonb_build_object('source', v_char.name)
      || jsonb_build_object('at', (extract(epoch from now()) * 1000)::bigint)
      || jsonb_build_object('effects', coalesce(p_effect -> 'effects', '{}'::jsonb));
    update characters
      set resources = jsonb_set(
        coalesce(resources, '{}'::jsonb),
        '{activeEffects}',
        coalesce(resources -> 'activeEffects', '[]'::jsonb) || jsonb_build_array(v_effect)
      )
      where id = p_target;
  end if;

  select * into v_target from characters where id = p_target;
  return jsonb_build_object(
    'ok', true,
    'target_name', v_target.name,
    'hp_current', (v_target.sheet -> 'hp' ->> 'current')::int,
    'hp_max', (v_target.sheet -> 'hp' ->> 'max')::int
  );
end;
$$;

revoke execute on function cast_party_effect(uuid, int, jsonb) from public;
revoke execute on function cast_party_effect(uuid, int, jsonb) from anon;
grant execute on function cast_party_effect(uuid, int, jsonb) to authenticated;

-- VERIFY (as a bound player, not the DM):
--   select * from list_party_roster();      -- other PCs' id/name/race/class/level/hp, never your own row
--   select cast_party_effect('00000000-0000-0000-0000-000000000000'::uuid, 5, null);
--     -> {"ok": false, "reason": "target_not_found"}
