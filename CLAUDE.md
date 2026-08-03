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

## Phase 0 smoke test (proves the loop)
- Login → land on `/` → topbar shows HP 52/52 and the three story cards render from `progress.stories`.
- Topbar HP `−` / `+` writes through to `characters.sheet.hp.current`; reload preserves the new value.
- A second account (no character row, not in `dm_users`) sees the "no character bound" screen — RLS holds.

## Project layout
- `src/lib/` — `supabase.ts` (client), `auth.tsx` (session + magic link), `character.ts` (row hook + section update), `database.types.ts` (hand-written types, replace with `supabase gen types` later).
- `src/components/Layout.tsx` + `Topbar.tsx` (HP pill = Phase 0 write surface) + `Bottombar.tsx` + `Nav.tsx` — the shared chrome from the Codex mockup, identical across routes.
- `src/screens/Codex.tsx`, `Stats.tsx`, `Equipment.tsx`, `Inventory.tsx`, `Features.tsx`, `Journal.tsx` are wired end-to-end. The remaining four screens (`character`, `shard`, `lore`, `spellbook`) are `Stub`s that dump their owning JSONB section as JSON; visual ports are Phase 1+ work.
- `src/styles/tokens.css` + `global.css` — design tokens (CSS vars) shared by all screens.
- `supabase/migrations/0001_init.sql` + `supabase/seed.sql` — paste-and-run via the Supabase SQL editor.

## Recurring bug: chamfered clip-path corners lose their border
Any element with a chamfered `clip-path` (the `polygon(Npx 0, 100% 0, 100% calc(100% - Npx), ...)`
cut-corner shape used everywhere in this UI) that also styles its edge with a plain CSS `border`
will render **bare 45° corners** — the border draws fine on the straight edges, but clip-path
slices the diagonal corner off with no border pixels on it at all. This has been fixed
independently at least twice (`ab9a53c`, and again on the Journal screen's `.badge`) because it's
easy to write the plain-border version first and only notice the missing diagonal at real zoom.

**The fix, applied via CSS variables, never `border-color` + shorthand `background`:**
```css
.thing {
  --cut: 5px;                        /* must match the clip-path chamfer size */
  --bc: rgba(212, 191, 125, 0.55);   /* the "border" color */
  border: 1px solid var(--bc);       /* still needed for the straight edges */
  clip-path: polygon(var(--cut) 0, 100% 0,
    100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%,
    0 100%, 0 var(--cut));
  background-image:
    linear-gradient(135deg, transparent calc(var(--cut) * 0.7071 - 1px), var(--bc) 0, var(--bc) calc(var(--cut) * 0.7071 + 1px), transparent 0),
    linear-gradient(315deg, transparent calc(var(--cut) * 0.7071 - 1px), var(--bc) 0, var(--bc) calc(var(--cut) * 0.7071 + 1px), transparent 0);
  background-repeat: no-repeat;
  background-origin: border-box;
  background-position: top left, bottom right;
  background-size: calc(var(--cut) + 1px) calc(var(--cut) + 1px);
}
```
The two gradients paint the diagonal stroke that a straight-line `border` physically cannot draw
along an oblique clip-path edge (`0.7071` ≈ 1/√2, the perpendicular offset of a 45° line). Variants
must override `--bc` and `background-color` — never `border-color` (the base rule already keys
`border` off `--bc`) and never the `background` shorthand (it silently resets `background-image`
to `none` and the fix disappears again). Existing examples: `.qFacing` in
`OperatorConsole.module.css`, `.panel`/`.cHead` in `Features.module.css`, and others across
`Inventory.module.css`, `Equipment.module.css`, `Stats.module.css`, `Codex.module.css` — grep
`0.7071` for the full list before writing a new chamfered+bordered element from scratch.

## Other guides
- Inventory refactor spec: docs/GUIDE_Codex_Inventory_Refactor.md

## Subagent Usage
- Always delegate file searches and grep operations to subagents
- Use subagents for independent implementation tasks that don't need shared context
- Prefer parallel subagents over sequential work in the main context
- Subagents should return concise summaries, not raw file contents