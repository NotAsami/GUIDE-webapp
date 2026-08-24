-- G.U.I.D.E. Codex — one-off DATA fix, applied to the live character 2026-08-24.
-- Apply via the Supabase SQL editor. Idempotent: re-running changes nothing.
--
-- Not a migration — it touches `characters.sheet`, not the schema — but it is
-- here rather than nowhere because nothing else in the repo records it, and a
-- fresh seed would not reproduce it.
--
-- TWO THINGS, both fallout from the same bug.
--
-- 1. BRUTAL STRIKE HAD NO PREREQUISITE THE ENGINE COULD SEE. Its rule reads
--    "If you use Reckless Attack, you can forgo any Advantage…", but that lived
--    only in `prerequisite` prose, so the feature offered and armed itself on
--    swings that were never reckless. Gating every one of its effects on
--    `recklessAttack` is what makes the prose true: `when` gates EXISTENCE, so
--    while the stance is not held the feature surfaces nowhere at all.
--
-- 2. A STUCK ARM. `armedMatches` compared a mod's `sub` against `req.sub` only,
--    so "Remove Advantage" (`roll:attack.str`) never matched a Strength melee
--    swing (`sub: 'melee'`, `ability: 'str'`). It could not apply, so it could
--    not be consumed, so it never left the queue — and `armableFor` skips a
--    feature that has anything queued, which is why Brutal Strike had gone
--    quiet. The code fix is in graph.ts; this clears the debris it left.

update characters c
   set sheet = jsonb_set(
         c.sheet, '{features}',
         (select jsonb_agg(
                   case when f->>'name' = 'Brutal Strike'
                     then jsonb_set(f, '{graph}',
                            (select jsonb_agg(e || jsonb_build_object('when', 'recklessAttack'))
                               from jsonb_array_elements(f->'graph') e))
                     else f end)
            from jsonb_array_elements(c.sheet->'features') f)),
       resources = jsonb_set(c.resources, '{graph,armed}', '[]'::jsonb)
 where c.sheet->'features' @> '[{"name": "Brutal Strike"}]';

-- Check: every Brutal Strike effect gated, nothing left armed.
select c.name,
       (select jsonb_agg(jsonb_build_object('label', e->>'label', 'when', e->>'when'))
          from jsonb_array_elements(c.sheet->'features') f,
               jsonb_array_elements(f->'graph') e
         where f->>'name' = 'Brutal Strike') as brutal_effects,
       c.resources->'graph'->'armed' as armed
  from characters c
 where c.sheet->'features' @> '[{"name": "Brutal Strike"}]';
