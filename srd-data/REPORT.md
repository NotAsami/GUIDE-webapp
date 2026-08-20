# SRD 5.2 import — stage 1 report

Document: `srd-2024` · generated 2026-08-20T21:51:32.235Z


## Rows

| endpoint | fetched | kept (srd-2024) |
|---|--:|--:|
| backgrounds | 4 | 4 |
| species | 9 | 9 |
| armor | 13 | 13 |
| spells | 339 | 339 |
| feats | 17 | 17 |
| items | 203 | 203 |
| weapons | 75 | 38 |
| magicitems | 757 | 757 |
| classes | 24 | 24 |

## Written

- `items.json` — 941 rows
- `spells.json` — 339 rows
- `races.json` — 9 rows
- `features.json` — 259 rows
- `classes.json` — 24 rows
- `backgrounds.json` — 4 rows

## Rejected by the client-side document check

- weapons:srd-2014 — 37 rows

## Auto-generated effects

156 items matched the whitelist. Everything else kept its prose and got nothing.

- **ammunition-attack-damage** — 3 items, bonuses +1 +2 +3
  <br>e.g. Ammunition (+1), Ammunition (+3), Ammunition (+2)
- **weapon-attack-damage** — 114 items, bonuses +1 +2 +3
  <br>e.g. Battleaxe (+1), Battleaxe (+2), Battleaxe (+3)
- **armor-ac** — 36 items, bonuses +1 +2 +3
  <br>e.g. Breastplate (+1), Breastplate (+2), Breastplate (+3)
- **shield-ac** — 3 items, bonuses +1 +2 +3
  <br>e.g. Shield (+1), Shield (+2), Shield (+3)

## Attribution

SRD 5.2 is CC-BY-4.0. `srd-data/LICENSE.txt` carries the required notice and sits beside
the data. Every row also carries `source: srd` and its `srd_key`, so a single row stays
traceable to the notice after it is loaded, exported, or copied onto a sheet.

## Defaults applied

- skipped-category:mount — 8
- skipped-category:land-vehicle — 5
- skipped-category:waterborne-vehicle — 6
- skipped-subclass-marker — 11
- skipped-core_traits_table — 12
- skipped-proficiency_bonus — 12
- skipped-class_table_data — 30
- skipped-spell-list-header — 8
- skipped-spell_slots — 55
- skipped-spellcasting — 8
- skipped-placeholder-prose — 1

## Warnings

- class Monk: column "Unarmoed Movement" is neither a number nor NdM (+10 ft.) — left out, this one needs a human
- class Warlock: column "Slot Level" is neither a number nor NdM (1st) — left out, this one needs a human
