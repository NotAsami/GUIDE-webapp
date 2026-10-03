<div align="center">
<img src="public/guide-codex-logo.svg" alt="G.U.I.D.E. Codex" width="800" />

https://github.com/user-attachments/assets/838e64f6-3285-4832-9f0a-acb5d8684348

</div>

---

The GUIDE is a web-app that can help online D&D **players** and **dungeon masters** be more immersed in their campaign.
It's a in-world D&D character codex with a fantasy-cyberpunk terminal UI, built for 3–4 player campaigns, though more players should not be an issue. The codex features everything you would need for a D&D campaign and more. 
Current features include:
- **Campaign progression home:** It features 3 widgets that can display current area, main quest line and other progression, authored by the DM.
- **Equipment overview screen:** See what items and gear you have equipped, and roll attacks with your main and off-hand weapon.
- **Stat-panel:** Have a look at all your stats at a glance, stuff from proficiency bonus display, to Hit-die counter and exhaustion tracker.
- **Inventory management:** Players are limited to a 4x5 grid of quick access inventory. They have access to backpacks, sacks and bag of holding. Weight is the only limitation, if a players acquires an item while their on-person inventory is full, the item is automatically routed to a backpack or bag of holding.
- **Journal:** DMs can write journal entries such as quests and session recaps using a markdown parser to create quests / session recaps for the players to read in their journal. The quest support external linking to related stuff for World Anvil or other hosted worlds. Quests have objectives that can be marked completed or unfinished. Quests too can be active, completed or failed.
- **Lore:**
- **Rolls:** Central screen for all your rolls, from skill checks to saves, you can roll everything here. This screen also includes a roll history printout
- **Spellbook:**
- **Shards (campaign specific):**
- **DM-View:** The DMs can create items, set conditions, create features, spells, items or other things. The feature engine is still a work in progress, but it will be a major addition to creating features that affect rolls, other features or do special effects. The DMs can manage the journal of players, push notifications to the clients, grant items, potions and other things
- **Loot table engine:** DMs will be able to define their own loot tables or use the pre-defined ones.
  - **Shop generator:** DMs will be able to create shopkeepers with their loot tables that will dynamically generate a shop screen for the players where they will be autonomously able to spend their gold and purchase items.
  - **Loot generator:** DMs will be able to use their loot tables to create loot chests / add loot to their game, for example, you would create a chest loot table which would have chances to have some items, then you would grant roll this table to generate loot and automatically grant that loot to the players that opened the chest.
- **Feature engine:** The DMs will be able to create features that end other status effects, grant advantage on certain saves, skill checks or other rolls, features that will grant bonus damage to attacks and many other things.
  - **Roll context panel:** Created as a part of the **Feature engine**, players will be able to see exactly what is affecting their rolls. For example: A roll could be affected by a feature called Condemning Strike, which could add +1d4 to the attacks damage. So the roll would display as:
 
```
Greatsword:
Stab an enemy with your sword:
Attack: 1d20 [17] + 5 (Bonus) = 22
Damage: 1d12 [8] + 2 = 10
  Condemning Strike:
  If this attack hits a creature affected by a Curse, add +1d4 damage to the weapons damage roll
  Damage: 1d4 [3] = 3
Total Attack: 22
Total Damage: 13
```
## Future Additions:
- Mobile port
- Campaign Switcher

## Stack

- **Frontend** — Vite + React + React Router + TypeScript
- **Backend** — Supabase (Postgres + Auth + Realtime), no custom server
- **Auth** — Supabase magic-link (passwordless)
- **Hosting** — static host (Vercel/Netlify) + Supabase cloud

## Quick start

```bash
git clone <repo-url>
cd GUIDE-webapp
nvm use                      # Node version pinned in .nvmrc
npm ci
cp .env.example .env.local   # then fill in your Supabase URL + anon key
npm run dev                  # http://localhost:5173
```

You'll need a Supabase project of your own. Create one at [supabase.com](https://supabase.com),
add `http://localhost:5173/auth/callback` to the Auth redirect URLs, enable Email
(magic link) auth, then apply the SQL in `supabase/` (migrations first, then the
seed) via the Supabase SQL editor.

## Scripts

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Vite dev server on http://localhost:5173          |
| `npm run preview`   | Serve the production build locally                |
| `npm test`          | Unit, React lifecycle, and isolated PostgreSQL tests |
| `npm run build`     | Typecheck and create the production bundle          |
| `npm run check`     | Run tests and the production build                  |

## Persistence updates

Apply `supabase/migrations/0025_reliable_writes.sql` **before deploying this client**, then reload existing clients. It makes purchase delivery atomic, stores receipts for safe retries, and advances update timestamps monotonically for conflict checks. The old debit-only purchase RPC becomes inaccessible to clients, so older clients fail without charging.

Tests use an isolated in-memory PostgreSQL runtime; they never access your Supabase project. CI runs the same test suite and production build. See [persistence notes](docs/persistence.md) for the conflict and recovery behavior.

## Image uploads

Apply [0029_image_uploads.sql](supabase/migrations/0029_image_uploads.sql) after the earlier migrations, before using uploads. It creates the private `guide-images` bucket and its access policies. No manual bucket setup is needed.

DMs can choose or drop a JPG, PNG, or WebP in Character → Lore, the NPC editor, or Handouts. Portraits have zoom and position controls; handouts retain their full image. Click **Upload**, then save the record (or deliver the handout). Existing image URLs still work.

Sources are limited to 20 MB / 40 megapixels, resized to at most 1600 px for portraits or 4096 px for handouts, and re-encoded without source metadata. Uploaded objects are capped at 8 MB. Players can read only their own portrait, revealed NPC images, and received handout images. Signed links last five minutes; a link already issued remains usable until expiry after access is revoked. External URLs retain their original hosting permissions.

Replacing or removing an image changes the record reference; it does not delete stored files. Cancelled uploads and replaced images may leave unreferenced objects for later maintenance. New clients are required to display uploaded images; reload older sessions after deploying.

## Project layout

```
src/
  lib/         Supabase client, auth, character data hook, game rules (dice, effects, equip, rest…)
  components/  Shared chrome — Layout, Topbar, Bottombar, Nav, toasts
  screens/     One file per screen — Codex, Stats, Equipment, Features, Inventory,
               Operator Console (DM), Login
  styles/      Design tokens + global CSS
  catalog/     Item catalog data
supabase/      Migrations + seed SQL (paste-and-run in the Supabase SQL editor)
public/        Static assets (favicon, logo)
```

## Design principles

- **One source of truth per value.** Current HP lives at `sheet.hp.current` and
  nowhere else; every screen reads and writes that one field. Same for spell slots,
  attunement, equipped-vs-carried, and prepared spells.
- **Render from data, never from markup.** Screens are driven by the character
  object — no hardcoded values in the JSX.

## Content licences

- **SRD 5.2** game content (spells, equipment, magic items, species, feats) —
  CC BY 4.0, from Wizards of the Coast via the Open5e API. Notice:
  [`srd-data/LICENSE.txt`](srd-data/LICENSE.txt).
- **game-icons.net** icon set — CC BY 3.0 (some CC0):
  [`public/icons/license.txt`](public/icons/license.txt).

Attributions and the reasoning behind them: [`docs/CREDITS.md`](docs/CREDITS.md).
