# G.U.I.D.E. Codex

In-world D&D character codex (fantasy-cyberpunk terminal UI) for a private 3–4 player
campaign. Players view/manage their own character; the DM authors content and grants
items/levels.

## Stack
- Frontend: single-page app assembled from ten design mockups (same visual language) Frontend: Vite + React + React Router + supabase-js (TypeScript).
- Backend: Supabase (Postgres + Auth + Realtime). No custom server.
- Auth: Supabase magic-link (passwordless).
- Hosting: static host (Vercel/Netlify) + Supabase cloud. Online-first; localhost = dev only.

## Non-negotiables
- ONE source of truth per value. Current HP lives at `sheet.hp.current` and nowhere else;
  every screen reads/writes that field. Same for spell slots, attunement, equipped-vs-carried,
  prepared spells. Never let two screens each "own" a value.
- Render every screen FROM the character data object; never hardcode values into markup.
  The Shard Tree and Spellbook mockups are the reference pattern.
- CANON — do not regress to mockup placeholders: level 7, HP 52, hit dice 7d10, proficiency +3.
  Ability scores come from the seeded character, NOT the mockups (Character and Stat Panel
  mockups disagree with each other).
- Do not invent lore. Treat mockup flavor (Castellan language/guard, Champion archetype,
  "Brettany Reclamation", named gear) as placeholder unless it's in the seeded data.
- Cantrips scale by character level, not slot upcast.

## Architecture & data model
Full spec: `docs/GUIDE_Codex_Build_Handoff.md`. Read it before working on the schema, data
wiring, or any screen's data contract.

## Build order
Phase 0 (Supabase schema + auth/RLS + app shell + wire screens to DB)
→ 1 Rest button → 2 DM View (+ item catalog + acquisition toast)
→ 3 Level-up (DM-side) → 4 Mobile port.

## Commands
- `npm install` — install deps
- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — TS build + Vite production build to `dist/`
- `npm run typecheck` — `tsc -b --noEmit`
- `npm run preview` — serve the production build locally

## Supabase setup (one-time, done by the human)
1. Create a Supabase project at supabase.com; add `http://localhost:5173/auth/callback`
   to Authentication → URL Configuration → Redirect URLs. Enable Email auth (magic link).
2. Copy `.env.example` to `.env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   from Settings → API.
3. Apply the schema: open Supabase SQL editor, paste `supabase/migrations/0001_init.sql`, Run.
4. Sign in once via `/login` so an `auth.users` row exists for the player email.
5. Apply `supabase/seed.sql` (it joins `auth.users` by email) to insert the canonical character.
6. To grant DM access, log the DM in once, then in SQL: `insert into dm_users (user_id) select id from auth.users where email = 'DM_EMAIL';`

## Phase 0 smoke test (proves the loop)
- Login → land on `/` → topbar shows HP 52/52 and the three story cards render from `progress.stories`.
- Topbar HP `−` / `+` writes through to `characters.sheet.hp.current`; reload preserves the new value.
- A second account (no character row, not in `dm_users`) sees the "no character bound" screen — RLS holds.

## Project layout
- `src/lib/` — `supabase.ts` (client), `auth.tsx` (session + magic link), `character.ts` (row hook + section update), `database.types.ts` (hand-written types, replace with `supabase gen types` later).
- `src/components/Layout.tsx` + `Topbar.tsx` (HP pill = Phase 0 write surface) + `Bottombar.tsx` + `Nav.tsx` — the shared chrome from the Codex mockup, identical across routes.
- `src/screens/Codex.tsx` — wired end-to-end (reads `progress.stories[]`). The other eight screens are `Stub`s that dump their owning JSONB section as JSON; visual ports are Phase 1+ work.
- `src/styles/tokens.css` + `global.css` — design tokens (CSS vars) shared by all screens.
- `supabase/migrations/0001_init.sql` + `supabase/seed.sql` — paste-and-run via the Supabase SQL editor.