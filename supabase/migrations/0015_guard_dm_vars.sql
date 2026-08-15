-- ============================================================================
-- 0015 — GUARD THE DM-ONLY VARIABLE BUCKET
--
-- Feature variables split by WHO MAY WRITE THEM:
--
--     resources.graph.vars     player-writable
--     resources.graph.dmVars   DM-only
--
-- That split cannot be expressed in RLS. Postgres row-level security is exactly
-- that — row-level: `own_character` (migration 0001) grants a player write on
-- their entire row, and there is no policy shape that permits writing
-- resources.graph.vars.karmicReserve while refusing resources.graph.dmVars.mercy.
-- So the permission becomes a LOCATION, guarded here.
--
-- WHY NOW: slice 5a ships the first client that writes resources.graph. Until
-- this exists, dmVars is writable by any player client — and worse, see the
-- jsonb_set note below.
--
-- REVERTS, NEVER RAISES. A player's legitimate write to `resources` (spending a
-- charge, ticking exhaustion) must not fail because their client round-tripped a
-- stale copy of dmVars alongside it. The DM's value simply wins.
-- ============================================================================

create or replace function guard_dm_vars() returns trigger
language plpgsql security definer as $$
begin
  if new.resources #> '{graph,dmVars}' is distinct from old.resources #> '{graph,dmVars}'
     and not exists (select 1 from dm_users where user_id = auth.uid())
  then
    new.resources = case
      -- Nothing to protect yet: strip whatever the client tried to introduce.
      when old.resources #> '{graph,dmVars}' is null
        then new.resources #- '{graph,dmVars}'
      -- jsonb_set creates only the LAST path element. Given a target with no
      -- `graph` key at all, setting '{graph,dmVars}' silently no-ops and returns
      -- the target unchanged — which would let a client that writes `resources`
      -- WITHOUT a graph key wipe dmVars outright. That is the exact hole this
      -- trigger exists to close, so `graph` is coalesced into an object before
      -- the leaf is set.
      else jsonb_set(
             jsonb_set(coalesce(new.resources, '{}'::jsonb), '{graph}',
                       coalesce(new.resources -> 'graph', '{}'::jsonb), true),
             '{graph,dmVars}', old.resources #> '{graph,dmVars}', true)
    end;
  end if;
  return new;
end $$;

comment on function guard_dm_vars() is
  'Reverts any non-DM change to resources.graph.dmVars. Writability is a location, not a flag — RLS is row-level and cannot guard a JSON path.';

drop trigger if exists characters_guard_dm_vars on characters;
create trigger characters_guard_dm_vars
  before update on characters
  for each row execute function guard_dm_vars();
