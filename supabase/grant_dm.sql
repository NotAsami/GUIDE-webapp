-- Grant DM (Operator Console) access — Phase 2.
--
-- The Operator Console at /dm is gated on membership in `dm_users`, and the
-- `dm_all` RLS policy (0001_init.sql) keys cross-character read/write off the
-- same table. Until a row exists here, the DM screen looks broken in ways that
-- aren't bugs: the gate redirects you off /dm, and the "read all characters"
-- query returns only your own owned row (the own_character policy).
--
-- HOW TO RUN: the player must have logged in once (so an auth.users row exists),
-- then paste this into the Supabase SQL editor and Run. Re-running is a no-op.
--
-- Substitute the DM's email below.

insert into dm_users (user_id)
select id from auth.users where email = 'samo.tv.sibik@gmail.com'
on conflict (user_id) do nothing;

-- Verify:
-- select u.email from dm_users d join auth.users u on u.id = d.user_id;
