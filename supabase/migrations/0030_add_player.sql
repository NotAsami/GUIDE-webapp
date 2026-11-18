-- G.U.I.D.E. Codex — the DM adds a player from the Operator Console.
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- The DM could already INSERT a character (the `dm_all` policy, 0001_init), but
-- had no way to name WHO owns it: a character's `owner` is an auth user id, and
-- auth.users is not readable from the client. So this one function looks the
-- account up by email and creates its character, and nothing else. SECURITY
-- DEFINER for the lookup only; the DM check below is what gates it.
--
-- The player must have signed in once (a magic link creates the account). Until
-- then there is no user to own the row, and the answer says so.
--
-- ONE CHARACTER PER ACCOUNT: the app loads a player's character with
-- `owner = me` and expects at most one, so a second is refused here.
--
-- The new character is a blank level-1 sheet. Race, class and background come
-- from the console's existing assign tools; assigning a class fills in HP,
-- because the sheet starts with none.

create or replace function add_player(p_email text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_name  text := btrim(coalesce(p_name, ''));
  v_taken text;
  v_id    uuid;
begin
  if not exists (select 1 from dm_users where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_dm');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_name');
  end if;

  select id into v_owner from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select name into v_taken from characters where owner = v_owner limit 1;
  if v_taken is not null then
    return jsonb_build_object('ok', false, 'reason', 'has_character', 'name', v_taken);
  end if;

  insert into characters (owner, name, identity, sheet)
  values (
    v_owner,
    v_name,
    jsonb_build_object('level', 1),
    jsonb_build_object(
      'abilities', jsonb_build_object('str', 10, 'dex', 10, 'con', 10, 'int', 10, 'wis', 10, 'cha', 10),
      'hp', jsonb_build_object('current', 0, 'max', 0, 'temp', 0),
      'proficiencyBonus', 2,
      'speed', 30,
      'coins', jsonb_build_object('gold', 0, 'silver', 0, 'copper', 0)
    )
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function add_player(text, text) from public, anon;
grant execute on function add_player(text, text) to authenticated;
