-- DEV FIXTURE — NOT CANON. Seeds the Journal (`quests` + `sessions`) with the
-- placeholder flavour from guide-hud/project/G.U.I.D.E. Journal.html (Magistrate
-- Voss, Brettany, the stolen tome) purely so the screen has real rows to render
-- against while verifying the port. Per CLAUDE.md, none of this is campaign
-- canon until the DM re-authors it for real in the Operator Console — delete
-- these rows once that happens.
--
-- HOW TO RUN: paste into the Supabase SQL editor and Run. Re-running RESETS to
-- exactly this list (existing rows with these titles are replaced).

delete from quests where title in
  ('Clear Your Name', 'The Stolen Tome', 'Whispers in Castella', 'The Thicket Path',
   'Arrival in Brettany', 'The Mayor''s Welcome');
delete from sessions where num in (1, 2, 3, 4);

insert into quests (title, type, status, location, given_by, description, objectives, related) values
(
  'Clear Your Name', 'main', 'active', 'Brettany', 'Magistrate Voss',
  E'The party stands accused. A Crown courier was found dead on the Brettany road, and the magistrate''s writ names you among the suspects — wrong place, wrong hour, and no one yet willing to speak for you.\n\nUntil your name is cleared, the city gates keep watch on you and the garrison''s patience runs thin. Find who set the blame at your feet, or find the proof that lifts it.\n\nMagistrate Voss has granted you the freedom of the lower wards to make your case — but only until the next assize is called.',
  jsonb_build_array(
    jsonb_build_object('text', 'Speak with Magistrate Voss in the Brettany court', 'done', true),
    jsonb_build_object('text', 'Find a witness who can place you off the road', 'done', false),
    jsonb_build_object('text', 'Recover the courier''s missing satchel', 'done', false)
  ),
  jsonb_build_array('Magistrate Voss', 'Brettany', 'The Crown')
),
(
  'The Stolen Tome', 'main', 'active', 'Davelguay', 'The Lady',
  E'A tome of significant value has gone missing from the Davelguay archive. The Lady wants it back, quietly.',
  jsonb_build_array(
    jsonb_build_object('text', 'Recover the stolen tome', 'done', true),
    jsonb_build_object('text', 'Learn who took it and why', 'done', false)
  ),
  jsonb_build_array('The Lady', 'Davelguay')
),
(
  'Whispers in Castella', 'side', 'active', 'Castella', '',
  'Rumors move faster than truth in Castella''s markets. Something is stirring beneath the noise.',
  '[]'::jsonb, jsonb_build_array('Castella')
),
(
  'The Thicket Path', 'side', 'active', 'Davelguay', '',
  'An overgrown trail near Davelguay has claimed more than one traveler this season.',
  '[]'::jsonb, jsonb_build_array('Davelguay')
),
(
  'Arrival in Brettany', 'main', 'completed', 'Brettany', '',
  'The party first set foot in Brettany, seeking work and shelter.',
  '[]'::jsonb, jsonb_build_array('Brettany')
),
(
  'The Mayor''s Welcome', 'side', 'completed', 'Castella', 'The Mayor',
  'A formal welcome from Castella''s mayor, and a modest reward for services rendered.',
  '[]'::jsonb, jsonb_build_array('Castella', 'The Mayor')
);

insert into sessions (num, title, date, recap, events) values
(1, 'The Mayor''s Welcome', '3rd of Hammerfall · 1247 PR',
  'The party arrived in Castella and were received by the Mayor.',
  jsonb_build_array('Arrived in Castella', 'Met the Mayor')),
(2, 'Into the Thicket', '11th of Hammerfall · 1247 PR',
  E'The party pushed into the thicket path outside Davelguay.\n\nWhat happened next was not recorded.',
  jsonb_build_array('Entered the Thicket Path', 'Lost the trail')),
(3, 'The Stolen Tome', '16th of Hammerfall · 1247 PR',
  'A lead on the missing tome brought the party to Davelguay''s back alleys.',
  jsonb_build_array('Recovered the stolen tome', 'Confronted a suspect')),
(4, 'Clear Your Name', '21st of Hammerfall · 1247 PR',
  'A Crown courier turned up dead on the Brettany road, and suspicion fell on the party.',
  jsonb_build_array('Accused before Magistrate Voss', 'Granted freedom of the lower wards'));
