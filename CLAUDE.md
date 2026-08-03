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

## Subagent Usage
- Always delegate file searches and grep operations to subagents
- Use subagents for independent implementation tasks that don't need shared context
- Prefer parallel subagents over sequential work in the main context
- Subagents should return concise summaries, not raw file contents

### Recurring bug: chamfered clip-path corners lose their border
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

### Recurring bug: `Btn` collapses to 0 height in a flex-COLUMN container
The shared `Btn` component (`OperatorConsole.tsx`) is styled `.btn { height: 36px; flex: 1; ... }`
(`.sm`/`.lg` override the height). `flex: 1` is shorthand for `flex-grow:1; flex-shrink:1;
flex-basis:0%`, and flex-basis substitutes for the size on the flex container's MAIN axis —
which is only *width* when the parent is `flex-direction: row` (the assumed context: a row of
buttons sharing space equally). Drop a bare `<Btn>` directly into a `display:flex;
flex-direction: column` parent and the main axis becomes *height*, so `flex-basis: 0%` overrides
the explicit `height: 36px` and the button renders at 0px tall — present in the DOM, fully
functional (clickable if you knew where to click), completely invisible. This is exactly what
happened to the Quest Log's "New Quest" button: correct code, zero visible pixels.

The codebase already had the guard for this in two places (`.grantAction`, `.catNew` in
`OperatorConsole.module.css`, both `display: flex; flex: 0 0 auto;`) before the Quest Log's
button shipped without it — check for the wrapper any time you add a lone `Btn` as a direct
child of a column flex container, don't just eyeball the JSX and assume it renders:
```css
.myNew { display: flex; flex: 0 0 auto; }
```
```tsx
<div className={styles.myNew}>
  <Btn tone="cyan" icon="fa-plus" label="New Thing" onClick={...} />
</div>
```
The wrapper's own `flex: 0 0 auto` stops it from stretching/shrinking on the column's main axis,
and it re-establishes a row context (`display: flex`'s default `flex-direction` is `row`) so
`Btn`'s `flex: 1` basis only zeroes out *width* again, leaving `height: 36px` intact. Multiple
`Btn`s that should already share a row (`.qActions`, `.btnRow`) don't need this — the bug is
specific to a single `Btn` alone in a column parent. Before adding a new lone `Btn`, check whether
its immediate parent is `flex-direction: column`; if so, wrap it.

### Recurring bug: 1px hairline borders vanish at fractional browser zoom
At 110% zoom (what the user runs), a box whose only visible edge is exactly `1px` — either a real
`border: 1px solid` or a `::before` pseudo-element frame at `inset: 1px` — can round away on one
side, most often the bottom, and which side depends on the page's current SCROLL offset (fractional
zoom shifts the box's device-pixel alignment as it scrolls, so a line that's fine at the top of the
page can vanish once you scroll it elsewhere, then reappear on the next re-render). First diagnosed
and fixed in `ab9a53c` (`.opSigil::before`, `.ovEntry::before`), then found unfixed on six more
identical `::before` frames (`.pcCard`, `.pcPortrait`, `.dashRow`, `.selPortrait`, `.actCard` — the
Vitals/Currency/Status cards — `.catItem`), plus `SystemToasts.module.css`'s `.tgIc::before` and
`RollToast.module.css`'s `.toast::before` (the dice-roll popup), and again as a plain
`border: 1px solid` on `.qPlayerDesc` (Player Description), `.gmNotes` (GM Notes), and
`SystemToasts.module.css`'s `.toast` (the DM broadcast popup).

**The fix is always the same number: `1px` → `1.5px`.** For a `::before` frame: bump `inset`. For a
real border: bump the width (`border: 1.5px solid ...`; keep any `border-left`/other accent width
as-authored, only the vanishing 1px edge needs it). 1.5px still rounds to a visible line at every
zoom level this app is used at; 1px doesn't. If the element also participates in the chamfered
cut-corner-border-fix recipe above, set `--bw: 1.5px` alongside the border-width bump so the
diagonal stripe matches (see `.catPrev` for the paired example) — a straight 1.5px edge next to a
1px-tuned diagonal stripe is a visible seam.

Before adding any new bordered/framed box, grep for the vulnerable pattern rather than trusting a
1px value will render:
```
grep -n 'inset: 1px\|border: 1px solid' src/screens/*.module.css src/components/*.module.css
```

## Other guides
- Inventory refactor spec: docs/GUIDE_Codex_Inventory_Refactor.md