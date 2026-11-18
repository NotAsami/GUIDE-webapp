-- Make yourself the DM (Operator Console access). Step 3 of a new install,
-- after the migrations and supabase/seed.sql.
--
-- The Operator Console at /dm is gated on membership in `dm_users`, and the
-- `dm_all` RLS policy (0001_init.sql) keys cross-character read/write off the
-- same table. Until a row exists here, the DM screen looks broken in ways that
-- aren't bugs: the gate redirects you off /dm, and the "read all characters"
-- query returns only your own owned row (the own_character policy).
--
-- HOW TO RUN: sign in to the app once with your email (so an auth.users row
-- exists), replace YOUR_EMAIL@example.com below with that email, then paste
-- this into the Supabase SQL editor and Run. Re-running is a no-op.
--
-- Players are added from the Operator Console afterwards (Party Roster → Add
-- player), not here.

insert into dm_users (user_id)
select id from auth.users where email = 'YOUR_EMAIL@example.com'
on conflict (user_id) do nothing;

-- Verify:
-- select u.email from dm_users d join auth.users u on u.id = d.user_id;
