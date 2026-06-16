-- Stat Panel data patch — adds the new `sheet` fields to an ALREADY-seeded
-- character row (the original seed.sql uses `on conflict do nothing`, so re-running
-- it won't touch an existing row). Paste into the Supabase SQL editor and Run.
--
-- Seeds only class-MECHANICAL proficiencies (these follow from class=Fighter per
-- SRD — the same category as "level 7 → proficiency +3", not invented lore).
-- The authored choices (skills, fighting style, subclass, background, extra
-- languages) are intentionally left empty; the Stat Panel renders honest empty
-- states until the player/DM authors them. See docs §5.

update characters
set sheet = sheet || jsonb_build_object(
  'saveProficiencies', jsonb_build_array('str', 'con'),
  'proficiencies', jsonb_build_object(
    'armor',          jsonb_build_array('Light Armor', 'Medium Armor', 'Heavy Armor', 'Shields'),
    'weapons',        jsonb_build_array('Simple', 'Martial'),
    'tools',          '[]'::jsonb,
    'languages',      jsonb_build_array('Common'),
    'fightingStyles', '[]'::jsonb
  ),
  'skillProficiencies', coalesce(sheet->'skillProficiencies', '[]'::jsonb),
  'skillExpertise',     coalesce(sheet->'skillExpertise', '[]'::jsonb)
)
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');

-- Sanity check: should show the new proficiency fields.
select sheet->'saveProficiencies' as saves, sheet->'proficiencies' as profs
from characters
where owner = (select id from auth.users where email = 'samo.tv.sibik@gmail.com');
