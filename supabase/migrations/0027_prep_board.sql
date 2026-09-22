-- ── 0027: the session prep board ────────────────────────────────────────────
-- Apply via Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
--
-- A board is a list of things the DM means to do on a night, in the order they
-- mean to do them. Firing a card calls the mechanism that already exists — a
-- shop opens, a loot table rolls, a handout is pushed, an NPC is revealed, a
-- quest becomes visible — so a card holds a REFERENCE and never a copy:
-- `ref` names the row in its own table, and `title` is only what to print if
-- that row is later deleted or renamed.
--
-- WHY THE SESSION ROW IS NOT WRITTEN HERE. Players read every row of
-- `sessions` (0007), and the newest is the recap on their Codex. A planned
-- session would be tonight's headline before it happened, so the board writes
-- nothing to `sessions` until the DM wraps: `session_plans.session_id` stays
-- null until then, which is also what marks a plan as played out.
--
-- DM-ONLY, both tables: no player policy at all. The board is the DM's notes
-- about what has not happened yet; every card's EFFECT is a write to a table
-- players already read on its own terms. No realtime either — the console is
-- the only reader and the only writer.

create table if not exists session_plans (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default '',
  -- Set when the DM wraps: the plan's night became this log entry.
  session_id  uuid references sessions (id) on delete set null,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists plan_cards (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references session_plans (id) on delete cascade,
  kind        text not null check (kind in ('shop', 'loot', 'handout', 'npc', 'quest', 'note')),
  -- The row this card fires, in its own table. Null for a note, which is the
  -- one card whose whole content lives here (there is no encounter table: the
  -- battlemap is Foundry's, so a fight is a note the DM wrote).
  ref         text,
  title       text not null default '',
  note        text not null default '',
  -- Characters this card is aimed at; empty means the whole party.
  target      uuid[] not null default '{}',
  -- Hand-ordered: a run sheet's order is the DM's judgement, not a sort key we
  -- can derive. Fractional so a card can be dropped between two others without
  -- renumbering the rest.
  sort        double precision not null default 0,
  fired_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists plan_cards_plan on plan_cards (plan_id, sort);

drop trigger if exists trg_session_plans_updated on session_plans;
create trigger trg_session_plans_updated
  before update on session_plans
  for each row execute function tg_set_updated_at();

alter table session_plans enable row level security;
alter table plan_cards enable row level security;

drop policy if exists dm_session_plans on session_plans;
create policy dm_session_plans on session_plans
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

drop policy if exists dm_plan_cards on plan_cards;
create policy dm_plan_cards on plan_cards
  for all
  using      (exists (select 1 from dm_users where user_id = auth.uid()))
  with check (exists (select 1 from dm_users where user_id = auth.uid()));

-- VERIFY (as a NON-DM account): both return 0 rows, always.
--   select * from session_plans;  select * from plan_cards;
