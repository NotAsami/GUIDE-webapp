-- G.U.I.D.E. Codex — initial schema
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
-- See docs/GUIDE_Codex_Build_Handoff.md §2 for the architectural rationale.

create extension if not exists pgcrypto;

create table if not exists characters (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users on delete cascade,
  name        text not null,
  identity    jsonb not null default '{}'::jsonb,
  sheet       jsonb not null default '{}'::jsonb,
  resources   jsonb not null default '{}'::jsonb,
  inventory   jsonb not null default '[]'::jsonb,
  equipped    jsonb not null default '{}'::jsonb,
  shards      jsonb not null default '{}'::jsonb,
  spellbook   jsonb not null default '{}'::jsonb,
  lore        jsonb not null default '{}'::jsonb,
  progress    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists characters_owner_idx on characters (owner);

create or replace function tg_set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists characters_set_updated_at on characters;
create trigger characters_set_updated_at
  before update on characters
  for each row execute function tg_set_updated_at();

create table if not exists dm_users (
  user_id uuid primary key references auth.users on delete cascade
);

alter table characters enable row level security;
alter table dm_users  enable row level security;

drop policy if exists own_character on characters;
create policy own_character on characters
  for all
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists dm_all on characters;
create policy dm_all on characters
  for all
  using (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

drop policy if exists dm_users_self_read on dm_users;
create policy dm_users_self_read on dm_users
  for select using (user_id = auth.uid());

alter publication supabase_realtime add table characters;
