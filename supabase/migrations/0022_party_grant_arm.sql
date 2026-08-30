-- G.U.I.D.E. Codex — grant an armed modifier to a party member (the `grant` op).
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- Bardic Inspiration is "that creature gains one of your Bardic Inspiration
-- dice": a bonus that lives on SOMEONE ELSE's sheet and rides a roll the granter
-- never sees. `characters`' only player policy is `own_character` (0001_init),
-- so this is the same deliberate, narrow exception cast_party_effect already is
-- (0011) — a SECURITY DEFINER function rather than a new broad RLS policy.
--
-- WHAT THE SERVER OWNS, and why the payload is rebuilt field by field rather
-- than stored as sent: this is the one write path where a client hands the
-- server a JSON object destined for ANOTHER user's row. Taking `p_mod` whole
-- would let any authenticated player put arbitrary keys — including `spent`, or
-- a colliding `id` — into a row they cannot otherwise touch. So the columns
-- below are a whitelist: anything not named here is dropped, and `id`, `at` and
-- `sourceName` are stamped here, never accepted.

create or replace function grant_party_arm(p_target uuid, p_mod jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_char   characters%rowtype;
  v_target characters%rowtype;
  v_mod    jsonb;
  v_armed  jsonb;
begin
  select * into v_char from characters where owner = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_character');
  end if;

  if p_mod is null or coalesce(p_mod ->> 'kind', '') = '' or coalesce(p_mod ->> 'label', '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_mod');
  end if;

  -- Never yourself: the op exists to reach another sheet, and the client's own
  -- armed queue is writable directly. A self-grant here would bypass nothing,
  -- but it would be a second path to a thing that already has one.
  if p_target = v_char.id then
    return jsonb_build_object('ok', false, 'reason', 'self_target');
  end if;

  select * into v_target from characters where id = p_target for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'target_not_found');
  end if;

  -- THE WHITELIST. jsonb_strip_nulls drops the optional keys the client did not
  -- send, so an absent `sub` stays absent rather than becoming null — armedMatches
  -- reads `!m.sub` as "any", and a literal null would be a different question.
  v_mod := jsonb_strip_nulls(jsonb_build_object(
    'kind',       p_mod ->> 'kind',
    'sub',        p_mod ->> 'sub',
    'subject',    p_mod ->> 'subject',
    'op',         p_mod ->> 'op',
    'label',      p_mod ->> 'label',
    'value',      p_mod ->> 'value',
    'dmgType',    p_mod ->> 'dmgType',
    'ask',        p_mod ->> 'ask',
    'text',       p_mod ->> 'text'
  )) || jsonb_build_object(
    'id',         gen_random_uuid()::text,
    -- The GRANTER's character is the source, so the recipient's roll panel names
    -- a person rather than a gid they own nothing of.
    'source',     'party:' || v_char.id::text,
    'sourceName', coalesce(v_char.name, 'A party member'),
    'at',         (extract(epoch from now()) * 1000)::bigint
  );

  v_armed := coalesce(v_target.resources -> 'graph' -> 'armed', '[]'::jsonb);
  -- A queue is a list of promises, and an unspent one never expires on its own.
  -- Sixty-four is far past any real table and well short of a row worth worrying
  -- about; refusing is better than silently truncating someone else's sheet.
  if jsonb_array_length(v_armed) >= 64 then
    return jsonb_build_object('ok', false, 'reason', 'queue_full');
  end if;

  update characters
    set resources = jsonb_set(
      jsonb_set(
        coalesce(resources, '{}'::jsonb),
        '{graph}',
        coalesce(resources -> 'graph', '{}'::jsonb),
        true
      ),
      '{graph,armed}',
      v_armed || jsonb_build_array(v_mod),
      true
    )
    where id = p_target;

  return jsonb_build_object(
    'ok', true,
    'target_name', v_target.name,
    'label', v_mod ->> 'label',
    'value', v_mod ->> 'value'
  );
end;
$$;

revoke execute on function grant_party_arm(uuid, jsonb) from public;
revoke execute on function grant_party_arm(uuid, jsonb) from anon;
grant execute on function grant_party_arm(uuid, jsonb) to authenticated;

-- VERIFY (as a bound player, not the DM):
--   select grant_party_arm('00000000-0000-0000-0000-000000000000'::uuid,
--     '{"kind":"d20","op":"add","label":"Bardic Inspiration","value":"1d8"}'::jsonb);
--     -> {"ok": false, "reason": "target_not_found"}
--   -- and against a real party member's id, then on THEIR sheet:
--   --   select resources -> 'graph' -> 'armed' from characters where id = <them>;
--   -- the mod carries a server-stamped id/source/sourceName/at and nothing else.
