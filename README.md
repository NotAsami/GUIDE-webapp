# G.U.I.D.E. Codex

<img src="public/guide-codex-logo.svg" alt="G.U.I.D.E. Codex" width="360" />

An in-world D&D character codex with a fantasy-cyberpunk terminal UI, built for a
private 3–4 player campaign. Players view and manage their own character; the DM
authors content and grants items and levels. It's online-first — every screen
renders from a single character data object stored in Supabase.

## Stack

- **Frontend** — Vite + React + React Router + TypeScript
- **Backend** — Supabase (Postgres + Auth + Realtime), no custom server
- **Auth** — Supabase magic-link (passwordless)
- **Hosting** — static host (Vercel/Netlify) + Supabase cloud

## Quick start

```bash
git clone <repo-url>
cd GUIDE-webapp
npm install
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
| `npm run build`     | TypeScript build + production build to `dist/`    |
| `npm run typecheck` | `tsc -b --noEmit`                                 |
| `npm run preview`   | Serve the production build locally                |

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
