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
- All ten mockup screens are wired end-to-end (`Codex.tsx`, `Stats.tsx`, `Equipment.tsx`, `Inventory.tsx`, `Features.tsx`, `Journal.tsx`, `Character.tsx`, `Shard.tsx`, `Lore.tsx`, `Spellbook.tsx`). `Stub.tsx` is unused by any route now — kept only in case a future screen needs a placeholder.
- The DM side has since grown past the mockups: `OperatorConsole.tsx` (the console and
  every catalog tab), `FeatureEditor.tsx`, `ShardLattice.tsx`, `OperatorShops.tsx`,
  `OperatorInventory.tsx`. Player-side splits: `EquipmentCarry.tsx`, `InventoryPopup.tsx`,
  `ShardTree.tsx`.
- `src/styles/tokens.css` + `global.css` — design tokens (CSS vars) shared by all screens.
- `supabase/migrations/0001_init.sql` + `supabase/seed.sql` — paste-and-run via the Supabase SQL editor.

## Subagent Usage
- Always delegate file searches and grep operations to subagents
- Use subagents for independent implementation tasks that don't need shared context
- Prefer parallel subagents over sequential work in the main context
- Subagents should return concise summaries, not raw file contents

### Recurring bug: chamfered clip-path corners lose their border
- If the user complains about missing corners in quadrilaterals or hexagons, read ./docs/Chamfered_clip-path_corners_fix.md for the fix.
- 45° chamfers are now guarded by `src/lib/chamferBorders.test.ts`, which fails on an
  unregistered rule, a `background:` shorthand that erases the diagonals, or a variant
  using `border-color` instead of `--bc`. Don't hand-audit for these — run the tests.
  Hexagons still need the two-layer fix and are NOT covered by the guard.

### Recurring bug: one authored value, two render paths
The same defect has now shipped twice, in two materials. A value the DM authors is
read by two different pieces of markup; one gets upgraded, the other keeps the old
render and fails **silently** — no error, no fallback, just wrong output that looks
deliberate.

- **Icons.** `<Icon>` (`src/components/Icon.tsx`) is the ONLY place an icon becomes
  pixels: `gi:` → a CSS mask, anything else → a Font Awesome class. Interpolating an
  authored value straight into `` `fa-solid ${…}` `` renders a game icon as *nothing*.
  Guarded by `src/lib/icons.test.ts`. Note the guard tests VALUE POSITIONS, not the
  mere presence of a literal — `${item.icon ?? 'fa-cube'}` contains `'fa-` and is
  still the bug.
- **Prose.** Any field authored through a `markdownShortcuts` textarea must render
  through `renderInline()` or `<Prose>`; printed raw, `**bold**` and `[text]{colour}`
  show as source. Guarded by `src/lib/proseFields.test.ts`, in both directions —
  offered-but-not-rendered and rendered-but-not-offered.
- Both guards carry an exemption list where each entry states why that source can
  only hold safe values. Adding to it is a decision; a stale entry fails its own test.
- Run the tests instead of grepping call sites by hand.

## Other guides
- Inventory refactor spec: docs/GUIDE_Codex_Inventory_Refactor.md
- Authoring guide (ops, targeting, variables, prose colour): docs/GUIDE_Codex_Authoring.md
- Deferred/designed-but-unbuilt register: docs/GUIDE_Codex_Deferred.md