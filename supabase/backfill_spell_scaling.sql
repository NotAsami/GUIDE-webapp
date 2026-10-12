-- Backfill spell `scaling` (2026-10-12). The SRD import left it empty for
-- hand-authoring; these are read off each spell's "At Higher Levels" prose by
-- lib/spells.ts scalingFromText (the same function srd-import.mjs now uses),
-- plus two hand-authored (Magic Missile, Eldritch Blast). Idempotent: only fills
-- rows whose scaling is empty, never overwrites an authored value.

with v(srd_key, scaling) as (values
  ('srd-2024_acid-arrow', '1d4'),
  ('srd-2024_acid-splash', '1d6'),
  ('srd-2024_blight', '1d8'),
  ('srd-2024_burning-hands', '1d6'),
  ('srd-2024_call-lightning', '1d10'),
  ('srd-2024_chill-touch', '1d10'),
  ('srd-2024_chromatic-orb', '1d8'),
  ('srd-2024_circle-of-death', '2d8'),
  ('srd-2024_cloudkill', '1d8'),
  ('srd-2024_cone-of-cold', '1d8'),
  ('srd-2024_conjure-animals', '1d10'),
  ('srd-2024_conjure-elemental', '1d8'),
  ('srd-2024_conjure-fey', '1d12'),
  ('srd-2024_conjure-minor-elementals', '1d8'),
  ('srd-2024_conjure-woodland-beings', '1d8'),
  ('srd-2024_cure-wounds', '2d8'),
  ('srd-2024_delayed-blast-fireball', '1d6'),
  ('srd-2024_disintegrate', '3d6'),
  ('srd-2024_divine-smite', '1d8'),
  ('srd-2024_dragons-breath', '1d6'),
  ('srd-2024_ensnaring-strike', '1d6'),
  ('srd-2024_fire-bolt', '1d10'),
  ('srd-2024_fireball', '1d6'),
  ('srd-2024_flame-blade', '1d6'),
  ('srd-2024_flame-strike', '1d6'),
  ('srd-2024_flaming-sphere', '1d6'),
  ('srd-2024_freezing-sphere', '1d6'),
  ('srd-2024_guiding-bolt', '1d6'),
  ('srd-2024_healing-word', '2d4'),
  ('srd-2024_heat-metal', '1d8'),
  ('srd-2024_hellish-rebuke', '1d10'),
  ('srd-2024_ice-knife', '1d6'),
  ('srd-2024_ice-storm', '1d10'),
  ('srd-2024_inflict-wounds', '1d10'),
  ('srd-2024_insect-plague', '1d10'),
  ('srd-2024_lightning-bolt', '1d6'),
  ('srd-2024_mass-cure-wounds', '1d8'),
  ('srd-2024_mass-healing-word', '1d4'),
  ('srd-2024_mind-spike', '1d8'),
  ('srd-2024_moonbeam', '1d10'),
  ('srd-2024_phantasmal-killer', '1d10'),
  ('srd-2024_poison-spray', '1d12'),
  ('srd-2024_prayer-of-healing', '1d8'),
  ('srd-2024_produce-flame', '1d8'),
  ('srd-2024_ray-of-frost', '1d8'),
  ('srd-2024_ray-of-sickness', '1d8'),
  ('srd-2024_sacred-flame', '1d8'),
  ('srd-2024_searing-smite', '1d6'),
  ('srd-2024_shatter', '1d8'),
  ('srd-2024_shining-smite', '1d6'),
  ('srd-2024_shocking-grasp', '1d8'),
  ('srd-2024_sorcerous-burst', '1d8'),
  ('srd-2024_spirit-guardians', '1d8'),
  ('srd-2024_spiritual-weapon', '1d8'),
  ('srd-2024_starry-wisp', '1d8'),
  ('srd-2024_thunderwave', '1d8'),
  ('srd-2024_vampiric-touch', '1d6'),
  ('srd-2024_vicious-mockery', '1d6'),
  ('srd-2024_vitriolic-sphere', '2d4'),
  ('srd-2024_wall-of-fire', '1d8'),
  ('srd-2024_wall-of-ice', '2d6'),
  ('srd-2024_wall-of-thorns', '1d8'),
  ('srd-2024_magic-missile', '1d4 + 1'),
  ('srd-2024_eldritch-blast', '1d10')
)
update spell_catalog sc
   set data = sc.data || jsonb_build_object('scaling', v.scaling), updated_at = now()
  from v
 where sc.data->>'srd_key' = v.srd_key
   and coalesce(sc.data->>'scaling', '') = '';

-- Granted spells are SNAPSHOTS (spell_id back-references the template), so the
-- copies on characters are filled from the catalog too: by spell_id, or by name
-- for a copy whose template is gone. updated_at is bumped on purpose — the app's
-- compare-and-swap keys on it, and an untouched stamp would let an open client
-- save its stale spellbook straight back over this.
update characters c
   set spellbook = jsonb_set(c.spellbook, '{spells}', (
         select jsonb_agg(
           case when coalesce(s->>'scaling', '') = '' and (s->>'hasDamage')::boolean then
             s || coalesce((
               select jsonb_build_object('scaling', sc.data->>'scaling') from spell_catalog sc
                where (sc.id::text = s->>'spell_id' or (sc.data->>'name' = s->>'name' and sc.data->>'source' = 'srd'))
                  and coalesce(sc.data->>'scaling', '') <> ''
                order by (sc.id::text = s->>'spell_id') desc limit 1), '{}'::jsonb)
           else s end order by e.ord)
         from jsonb_array_elements(c.spellbook->'spells') with ordinality e(s, ord))),
       updated_at = now()
 where jsonb_typeof(c.spellbook->'spells') = 'array'
   and exists (select 1 from jsonb_array_elements(c.spellbook->'spells') s
                where coalesce(s->>'scaling', '') = '' and (s->>'hasDamage')::boolean);
