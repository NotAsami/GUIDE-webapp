-- G.U.I.D.E. Codex — shard tree catalog seed (migration 0008).
-- Apply via Supabase SQL editor AFTER 0008_shard_catalog.sql.
--
-- Five trees: `guide` (the permanent slot-1 shard, capacity 0 — no lattice to
-- spend on), `vigor` (published, the character's currently-slotted shard),
-- `echo` (published, unbound — a spare tree to assign), `cinder` (DRAFT,
-- published:false, and deliberately still carries an orphan node — real audit
-- fodder for the Lattice Editor's "Unreachable"/"Orphan" checks) and `null_`
-- (an empty/unresolved placeholder, published:false).
--
-- `mods` are only set where lib/effects.ts's effectiveSheet() actually applies
-- them (abilities, maxHp, ac, speed, initiative, darkvision, saves, skills).
-- Nodes whose effect is event-triggered, conditional, or a weapon-damage bonus
-- (attack/damage effects apply per-weapon, not tree-wide — see weapons.ts)
-- stay prose-only, same as the item-effects design rule: never fake a number
-- for something that isn't one.

insert into shard_tree_catalog (id, data) values

  ('guide', jsonb_build_object(
    'id', 'guide', 'name', 'G.U.I.D.E. Shard', 'rarity', 'Legendary',
    'module', 'Global Unification Initiative for Directed Entities', 'icon', 'fa-eye',
    'capacity', 0, 'published', true,
    'flavor', 'Global Unification Initiative for Directed Entities. Issued, not found — it was never yours to attune.',
    'attuneRule', 'Permanent · slot 1 · cannot be ejected',
    'baseMods', '{}'::jsonb,
    'baseFeatures', jsonb_build_array(
      jsonb_build_object('name', 'Quest Tracking', 'category', 'other', 'usage', 'passive', 'light_description', 'Active objectives surface automatically as they update.'),
      jsonb_build_object('name', 'Automated Combat Assistance', 'category', 'other', 'usage', 'passive', 'light_description', 'Suggests targets, ranges and advantage/disadvantage during combat.'),
      jsonb_build_object('name', 'Real-Time Map Sync', 'category', 'other', 'usage', 'passive', 'light_description', 'Explored terrain and party positions stay in sync across the table.')
    ),
    'baseDetails', jsonb_build_array(
      jsonb_build_object('l', 'Status', 'v', 'Permanent'),
      jsonb_build_object('l', 'Origin', 'v', 'Issued')
    ),
    'branches', jsonb_build_object('core', 'Core'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'core', 'name', 'G.U.I.D.E. Core', 'tier', 0, 'branch', 'core', 'angle', 0, 'cost', 0, 'icon', 'fa-eye', 'prereqs', '[]'::jsonb, 'effect', 'The base link. There is no lattice to spend on — this shard does not calibrate.')
    )
  )),

  ('vigor', jsonb_build_object(
    'id', 'vigor', 'name', 'Shard of Vigor', 'rarity', 'Uncommon',
    'module', 'Physical Enhancement', 'icon', 'fa-gem',
    'capacity', 8, 'published', true,
    'flavor', 'A knot of dull amber glass, warm to the touch. It sits against the sternum and the body starts telling small lies about how tired it is.',
    'attuneRule', 'Requires attunement · occupies 1 of 2 shard slots',
    'baseMods', jsonb_build_object('abilities', jsonb_build_object('str', 2, 'con', 1), 'maxHp', 5),
    'baseFeatures', '[]'::jsonb,
    'baseDetails', jsonb_build_array(jsonb_build_object('l', 'Digitization', 'v', '+1% / tier')),
    'branches', jsonb_build_object('core', 'Core', 'might', 'Might', 'vitality', 'Vitality', 'grit', 'Grit', 'apex', 'Apex'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'core', 'name', 'Shard Core', 'tier', 0, 'branch', 'core', 'angle', 0, 'cost', 0, 'icon', 'fa-gem', 'prereqs', '[]'::jsonb, 'effect', 'Base attunement. +2 STR, +5 max HP.'),
      jsonb_build_object('id', 'might_1', 'name', 'Hardened Sinew', 'tier', 1, 'branch', 'might', 'angle', -90, 'cost', 1, 'icon', 'fa-hand-fist', 'prereqs', jsonb_build_array('core'), 'effect', '+1 STR.', 'mods', jsonb_build_object('abilities', jsonb_build_object('str', 1))),
      jsonb_build_object('id', 'vit_1', 'name', 'Deep Reserves', 'tier', 1, 'branch', 'vitality', 'angle', 90, 'cost', 1, 'icon', 'fa-droplet', 'prereqs', jsonb_build_array('core'), 'effect', '+5 max HP.', 'mods', jsonb_build_object('maxHp', 5)),
      jsonb_build_object('id', 'grit_1', 'name', 'True Grit', 'tier', 1, 'branch', 'grit', 'angle', 180, 'cost', 1, 'icon', 'fa-anchor', 'prereqs', jsonb_build_array('core'), 'effect', '+2 max HP and advantage on death saving throws.', 'mods', jsonb_build_object('maxHp', 2)),
      jsonb_build_object('id', 'might_2', 'name', 'Powerful Build', 'tier', 2, 'branch', 'might', 'angle', -120, 'cost', 1, 'icon', 'fa-dumbbell', 'prereqs', jsonb_build_array('might_1'), 'effect', 'Lifting and carrying capacity doubled; advantage on STR (Athletics) checks.'),
      jsonb_build_object('id', 'might_2b', 'name', 'Reckless Power', 'tier', 2, 'branch', 'might', 'angle', -60, 'cost', 1, 'icon', 'fa-explosion', 'prereqs', jsonb_build_array('might_1'), 'effect', 'Once per turn you may take a -2 penalty to AC until your next turn to deal +1d6 damage on a melee hit.'),
      jsonb_build_object('id', 'vit_2', 'name', 'Iron Constitution', 'tier', 2, 'branch', 'vitality', 'angle', 120, 'cost', 1, 'icon', 'fa-shield-heart', 'prereqs', jsonb_build_array('vit_1'), 'effect', '+5 max HP; advantage on saving throws against being poisoned.', 'mods', jsonb_build_object('maxHp', 5)),
      jsonb_build_object('id', 'vit_2b', 'name', 'Toughened Hide', 'tier', 2, 'branch', 'vitality', 'angle', 60, 'cost', 1, 'icon', 'fa-shield', 'prereqs', jsonb_build_array('vit_1'), 'effect', 'While you wear no heavy armor, your AC increases by 1.'),
      jsonb_build_object('id', 'grit_2', 'name', 'Adrenal Surge', 'tier', 2, 'branch', 'grit', 'angle', 180, 'cost', 1, 'icon', 'fa-bolt', 'prereqs', jsonb_build_array('grit_1'), 'effect', 'When you drop below half your max HP, gain temporary HP equal to your level (once per rest).'),
      jsonb_build_object('id', 'might_3', 'name', 'Crushing Strikes', 'tier', 3, 'branch', 'might', 'angle', -45, 'cost', 2, 'icon', 'fa-hammer', 'prereqs', jsonb_build_array('might_2b'), 'effect', '+1 melee weapon damage.'),
      jsonb_build_object('id', 'might_3b', 'name', 'Brutal Momentum', 'tier', 3, 'branch', 'might', 'angle', -135, 'cost', 2, 'icon', 'fa-angles-up', 'prereqs', jsonb_build_array('might_2'), 'effect', 'Reducing a creature to 0 HP grants +10 ft of movement and advantage on your next attack this turn.'),
      jsonb_build_object('id', 'vit_3', 'name', 'Second Wind', 'tier', 3, 'branch', 'vitality', 'angle', 45, 'cost', 2, 'icon', 'fa-heart-pulse', 'prereqs', jsonb_build_array('vit_2b'), 'effect', 'Regain 1 HP at the start of each of your turns while below half your maximum HP.'),
      jsonb_build_object('id', 'vit_3b', 'name', 'Regeneration', 'tier', 3, 'branch', 'vitality', 'angle', 135, 'cost', 2, 'icon', 'fa-arrows-rotate', 'prereqs', jsonb_build_array('vit_2'), 'effect', 'At the end of a short rest, regain HP equal to your Constitution modifier (minimum 1).'),
      jsonb_build_object('id', 'grit_3', 'name', 'Unflinching', 'tier', 3, 'branch', 'grit', 'angle', 180, 'cost', 2, 'icon', 'fa-mountain', 'prereqs', jsonb_build_array('grit_2'), 'effect', 'Advantage on saving throws against being frightened; you cannot be moved against your will.'),
      jsonb_build_object('id', 'apex', 'name', 'Unbreakable', 'tier', 4, 'branch', 'apex', 'angle', 0, 'cost', 3, 'icon', 'fa-star', 'prereqs', jsonb_build_array('might_3', 'vit_3'), 'effect', '+2 STR, +10 max HP, and you cannot be knocked prone.', 'mods', jsonb_build_object('abilities', jsonb_build_object('str', 2), 'maxHp', 10)),
      -- CONCEALED — geometry only. Real name/effect/dm live in shard_tree_secrets.
      jsonb_build_object('id', 'toll', 'tier', 4, 'branch', 'apex', 'angle', 180, 'cost', 0, 'prereqs', jsonb_build_array('grit_3'), 'concealed', true)
    )
  )),

  ('echo', jsonb_build_object(
    'id', 'echo', 'name', 'Shard of Echo', 'rarity', 'Rare',
    'module', 'Cognitive Relay', 'icon', 'fa-tower-broadcast',
    'capacity', 6, 'published', true,
    'flavor', 'It hums at a frequency just under hearing. Everyone in the room finishes their sentences a half-beat faster.',
    'attuneRule', 'Requires attunement · occupies 1 of 2 shard slots',
    'baseMods', jsonb_build_object('abilities', jsonb_build_object('int', 2), 'skills', jsonb_build_object('perception', 1)),
    'baseFeatures', '[]'::jsonb,
    'baseDetails', jsonb_build_array(jsonb_build_object('l', 'Range', 'v', '30 ft')),
    'branches', jsonb_build_object('core', 'Core', 'signal', 'Signal', 'recall', 'Recall', 'apex', 'Apex'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'core', 'name', 'Relay Core', 'tier', 0, 'branch', 'core', 'angle', 0, 'cost', 0, 'icon', 'fa-tower-broadcast', 'prereqs', '[]'::jsonb, 'effect', 'Base attunement. You may reroll one Intelligence check per rest.'),
      jsonb_build_object('id', 'sig_1', 'name', 'Carrier Wave', 'tier', 1, 'branch', 'signal', 'angle', -70, 'cost', 1, 'icon', 'fa-signal', 'prereqs', jsonb_build_array('core'), 'effect', 'You can speak telepathically to one creature you can see within 30 ft.'),
      jsonb_build_object('id', 'rec_1', 'name', 'Perfect Recall', 'tier', 1, 'branch', 'recall', 'angle', 70, 'cost', 1, 'icon', 'fa-brain', 'prereqs', jsonb_build_array('core'), 'effect', 'You remember anything you have seen or heard in the past month.'),
      jsonb_build_object('id', 'sig_2', 'name', 'Interference', 'tier', 2, 'branch', 'signal', 'angle', -100, 'cost', 2, 'icon', 'fa-wave-square', 'prereqs', jsonb_build_array('sig_1'), 'effect', 'As a reaction, impose disadvantage on one enemy spell attack within 60 ft.'),
      jsonb_build_object('id', 'rec_2', 'name', 'Borrowed Skill', 'tier', 2, 'branch', 'recall', 'angle', 100, 'cost', 2, 'icon', 'fa-book-open', 'prereqs', jsonb_build_array('rec_1'), 'effect', 'Gain proficiency in one skill an ally within 30 ft has, for one hour.'),
      jsonb_build_object('id', 'apex', 'name', 'Full Duplex', 'tier', 3, 'branch', 'apex', 'angle', 0, 'cost', 3, 'icon', 'fa-star', 'prereqs', jsonb_build_array('sig_2', 'rec_2'), 'effect', 'The party shares one pooled reaction per round while within 60 ft of you.')
    )
  )),

  -- DRAFT — published:false, never visible to a player. Deliberately keeps
  -- the orphan node (ash_1 has no prereqs and isn't tier 0) as real audit
  -- fodder for the Lattice Editor: opening this tree should surface an
  -- "Orphan node" error and block Publish until the DM links it.
  ('cinder', jsonb_build_object(
    'id', 'cinder', 'name', 'Shard of Cinder', 'rarity', 'Very Rare',
    'module', 'Thermal Output', 'icon', 'fa-fire',
    'capacity', 7, 'published', false,
    'flavor', 'Draft. Runs hot in the pocket.',
    'attuneRule', 'Requires attunement · occupies 1 of 2 shard slots',
    'baseMods', '{}'::jsonb,
    'baseFeatures', '[]'::jsonb,
    'baseDetails', jsonb_build_array(jsonb_build_object('l', 'Fire Resistance', 'v', 'Yes')),
    'branches', jsonb_build_object('core', 'Core', 'ember', 'Ember', 'ash', 'Ash', 'apex', 'Apex'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'core', 'name', 'Ember Core', 'tier', 0, 'branch', 'core', 'angle', 0, 'cost', 0, 'icon', 'fa-fire', 'prereqs', '[]'::jsonb, 'effect', 'Base attunement. Your unarmed strikes deal +1 fire damage.'),
      jsonb_build_object('id', 'em_1', 'name', 'Kindle', 'tier', 1, 'branch', 'ember', 'angle', -60, 'cost', 1, 'icon', 'fa-fire-flame-simple', 'prereqs', jsonb_build_array('core'), 'effect', 'Ignite a flammable object you touch as a bonus action.'),
      jsonb_build_object('id', 'ash_1', 'name', 'Ashen Step', 'tier', 1, 'branch', 'ash', 'angle', 120, 'cost', 1, 'icon', 'fa-shoe-prints', 'prereqs', '[]'::jsonb, 'effect', 'Leave no tracks; advantage on Stealth in smoke or dust.')
    )
  )),

  ('null_', jsonb_build_object(
    'id', 'null_', 'name', 'Shard of the Lady', 'rarity', 'Legendary',
    'module', '—— UNRESOLVED ——', 'icon', 'fa-question',
    'capacity', 0, 'published', false,
    'flavor', '', 'attuneRule', '—',
    'baseMods', '{}'::jsonb, 'baseFeatures', '[]'::jsonb, 'baseDetails', '[]'::jsonb,
    'branches', jsonb_build_object('core', 'Core'),
    'nodes', jsonb_build_array(
      jsonb_build_object('id', 'core', 'name', '???', 'tier', 0, 'branch', 'core', 'angle', 0, 'cost', 0, 'icon', 'fa-question', 'prereqs', '[]'::jsonb, 'effect', 'Node data returns empty. The tree exists. It has not been written by anyone at this table.')
    )
  ))

on conflict (id) do update set data = excluded.data;

-- DM-only. Every `dm` note from the editor, plus the concealed node's real
-- name/effect (`toll`) — the whole reason shard_tree_secrets exists.
insert into shard_tree_secrets (shard_id, data) values

  ('vigor', jsonb_build_object(
    'dm', 'Grants on slot, before any node is spent. The +1 CON is what keeps Brom alive through act two.',
    'nodes', jsonb_build_object(
      'might_2b', jsonb_build_object('name', 'Reckless Power', 'effect', 'Once per turn you may take a -2 penalty to AC until your next turn to deal +1d6 damage on a melee hit.', 'dm', 'Watch the AC swing at low levels — this is the node that gets someone killed in tier 1.'),
      'apex', jsonb_build_object('name', 'Unbreakable', 'effect', '+2 STR, +10 max HP, and you cannot be knocked prone.', 'dm', 'Capstone. Do not let this land before session 9.'),
      'toll', jsonb_build_object('name', 'The Toll', 'effect', 'Your body no longer tires. It also no longer entirely reports to you.', 'dm', 'CONCEALED. Auto-grants on Grit completion — the player never chose it. Digitization +8%.')
    )
  )),

  ('echo', jsonb_build_object(
    'nodes', jsonb_build_object(
      'rec_1', jsonb_build_object('name', 'Perfect Recall', 'effect', 'You remember anything you have seen or heard in the past month.', 'dm', 'She will not notice what it quietly declines to return.')
    )
  )),

  ('cinder', jsonb_build_object(
    'nodes', jsonb_build_object(
      'ash_1', jsonb_build_object('name', 'Ashen Step', 'effect', 'Leave no tracks; advantage on Stealth in smoke or dust.', 'dm', 'ORPHAN — never linked to the core. Fix before publish.')
    )
  )),

  ('null_', jsonb_build_object(
    'dm', 'Do not fill this in.',
    'nodes', jsonb_build_object(
      'core', jsonb_build_object('name', '???', 'effect', 'Node data returns empty. The tree exists. It has not been written by anyone at this table.', 'dm', 'Leave it. It grows on its own between sessions.')
    )
  ))

on conflict (shard_id) do update set data = excluded.data;

-- Sanity check.
select id, data->>'published' as published, jsonb_array_length(data->'nodes') as nodes
  from shard_tree_catalog order by id;
