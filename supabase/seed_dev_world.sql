-- DEV ONLY. An invented cast so the NPC web, dossiers, places, quests and
-- handouts have something to draw. NOT campaign lore — never run on a real DB.
-- Re-runnable: it deletes its own rows (matched by name/title) first, and it
-- only ADDS rows; nothing that existed before is edited.
-- Remove it: run just the DELETE block.
-- No record for "The Mayor": Ros IS the mayor of Castella (his backstory), so an
-- NPC by that name would contradict canon. 'The Mayor' stays in the delete list
-- only to clean up databases seeded by the first version of this file.

begin;

delete from handouts where title in ('Warrant of Arrest', 'A Page from Sera''s Ledger', 'The Lady''s Letter');
delete from quests where title in ('The Fence''s Ledger', 'A Clerk''s Alibi', 'Witch of the Thicket', 'The Harbour Dues');
delete from npcs where name in (
  'Magistrate Voss', 'The Lady', 'The Mayor', 'Maren of the Waterfront', 'Brother Aldric',
  'Sera Quill', 'Captain Holt', 'Old Tamsin', 'The Grey Hand');   -- cascades links + secrets

-- Ros and Cornelius, by name so the file survives a reseed.
create temp table pc on commit drop as
  select (select id from characters where name = 'Ros Chrisstone') ros,
         (select id from characters where name = 'Cornelius the III.') cor;

insert into npcs (name, role, location, blurb, known_to)
select n.name, n.role, n.location, n.blurb,
       case n.who when 'ros' then array[pc.ros] when 'both' then array[pc.ros, pc.cor] else '{}'::uuid[] end
from pc, (values
  ('Magistrate Voss', 'Magistrate of Brettany', 'Brettany',
   'Signed the warrant with **Ros''s** name on it. Says she wants the truth, and keeps the file sealed.', 'both'),
  ('The Lady', 'Keeper of the Davelguay archive', 'Davelguay',
   'Never gives a name. Pays in favours, and remembers every one owed.', 'ros'),
  ('Maren of the Waterfront', 'Dockhand', 'Castella',
   'Knows every hull in the harbour, and most of what gets carried in them.', 'ros'),
  ('Brother Aldric', 'Archivist', 'Davelguay',
   'The Lady''s clerk. He was on duty the night the tome went missing.', 'ros'),
  ('Sera Quill', 'Fence', 'Castella',
   'Buys what shouldn''t be sold. Her ledger has a Davelguay seal in it.', 'ros'),
  ('Captain Holt', 'Captain of the Brettany watch', 'Brettany',
   'Holds the cell keys, and a quiet doubt about the warrant.', 'both'),
  ('Old Tamsin', 'Hedge-witch', 'Davelguay',
   'Lives where the Thicket Path gives out. Trades riddles for directions.', 'both'),
  ('The Grey Hand', 'Unknown', '',
   'A name that turns up in other people''s ledgers.', 'none')
) as n(name, role, location, blurb, who);

insert into npc_secrets (npc_id, gm_notes)
select id, 'Behind the theft. Pays Sera through Aldric.' from npcs where name = 'The Grey Hand';

insert into npc_links (a, b, kind, attitude, label, known_to)
select a.id, b.id, l.kind, l.att, l.label, case when l.shown then array[pc.ros] else '{}'::uuid[] end
from pc, (values
  ('Magistrate Voss', 'Captain Holt', 'Ally', 'friendly', 'Holt answers to Voss', true),
  ('The Lady', 'Brother Aldric', 'Mentor', 'friendly', 'Her clerk', true),
  ('Brother Aldric', 'Sera Quill', 'Enigma', 'wary', 'Seen together the night of the theft', true),
  ('Sera Quill', 'Maren of the Waterfront', 'Ally', 'neutral', 'Maren moves Sera''s crates', true),
  ('Old Tamsin', 'The Lady', 'Rival', 'wary', 'The Thicket and the archive don''t mix', true),
  ('The Grey Hand', 'Sera Quill', 'Enigma', 'hostile', 'Pays for what Sera sells', false),
  ('The Grey Hand', 'Magistrate Voss', 'Enigma', 'neutral', 'Knows what the sealed file says', false)
) as l(an, bn, kind, att, label, shown)
join npcs a on a.name = l.an
join npcs b on b.name = l.bn;

insert into quests (title, type, status, location, given_by, description, objectives, related) values
  ('The Fence''s Ledger', 'side', 'active', 'Castella', 'Maren of the Waterfront',
   'Maren says Sera Quill has been buying archive paper. Get a look at her ledger.',
   '[{"text":"Find Sera Quill''s stall","done":true},{"text":"Copy a page of the ledger","done":true},{"text":"Learn who the Davelguay seal belongs to","done":false}]',
   '[{"name":"Sera Quill"},{"name":"Maren of the Waterfront"},{"name":"Castella"}]'),
  ('A Clerk''s Alibi', 'main', 'active', 'Davelguay', 'The Lady',
   'Brother Aldric swears he never left the archive. The Lady would like that checked.',
   '[{"text":"Question Brother Aldric","done":true},{"text":"Find a witness for the night of the theft","done":false}]',
   '[{"name":"Brother Aldric"},{"name":"The Lady"},{"name":"Davelguay"}]'),
  ('Witch of the Thicket', 'side', 'completed', 'Davelguay', 'Old Tamsin',
   'Answer Old Tamsin''s three riddles to learn the way through the Thicket.',
   '[{"text":"Answer the first riddle","done":true},{"text":"Answer the second riddle","done":true},{"text":"Answer the third riddle","done":true}]',
   '[{"name":"Old Tamsin"},{"name":"Davelguay"}]');

-- A PERSONAL quest (0028): Ros's board and Character card only; Cornelius's
-- client never receives the row.
insert into quests (title, type, status, location, given_by, description, objectives, related, character_id)
select 'The Harbour Dues', 'side', 'active', 'Castella', 'Maren of the Waterfront',
   'Castella''s harbour dues have come in short three months running. As mayor, find out where they go.',
   '[{"text":"Ask Maren which hulls skip the dues","done":true},{"text":"Check the harbour book against the treasury","done":false}]',
   '[{"name":"Maren of the Waterfront"},{"name":"Castella"}]', pc.ros
from pc;

insert into handouts (title, body, quest_id, recipients)
select h.title, h.body, (select id from quests where title = h.quest),
       case h.who when 'ros' then array[pc.ros] else array[pc.ros, pc.cor] end
from pc, (values
  ('Warrant of Arrest',
   'By order of the **Magistrate of Brettany**: the bearer Ros Chrisstone is to be held for questioning in the matter of the Crown''s missing seal.

*Signed and sealed, Voss.*', 'Clear Your Name', 'ros'),
  ('A Page from Sera''s Ledger',
   '3 reams archive paper, Davelguay stock. **Paid in full.**

Buyer: *the grey hand*. No name given.', 'The Fence''s Ledger', 'both'),
  ('The Lady''s Letter',
   'Aldric is loyal, and loyalty lies to protect what it loves. Find out what he is protecting.

*Burn this.*', 'A Clerk''s Alibi', 'ros')
) as h(title, body, quest, who);

-- What sessions IV and V moved (0028), as the prep board's wrap would have
-- written them. The one EDIT this file makes to rows it did not create; it
-- overwrites links wholesale, so re-running is safe.
update sessions set links = coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'ref', l.id) order by l.ord)
  from (select 'quest' kind, id, 1 ord from quests where title = 'Clear Your Name'
        union all select 'handout', id, 2 from handouts where title = 'Warrant of Arrest') l), '[]')
where num = 4;
update sessions set links = coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'ref', l.id) order by l.ord)
  from (select 'quest' kind, id, 1 ord from quests where title = 'Clear Your Name'
        union all select 'quest', id, 2 from quests where title = 'A Clerk''s Alibi'
        union all select 'handout', id, 3 from handouts where title = 'The Lady''s Letter') l), '[]')
where num = 5;

commit;
