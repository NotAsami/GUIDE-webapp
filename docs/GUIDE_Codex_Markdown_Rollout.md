# Markdown rollout log

`src/lib/markdown.ts` (`renderInline` + `Prose`) is the one markdown parser in the app. Inputs stay
plain textareas storing raw markdown; parsing is display-side only, and both functions return React
nodes directly — never `dangerouslySetInnerHTML` — so there's no HTML-injection surface.

## Supported syntax

- `**bold**`, `*italics*`
- `[text](url)` — only `http://`, `https://` and root-relative (`/…`) URLs become a real
  `<a target="_blank" rel="noopener noreferrer">`; anything else (e.g. `javascript:`) renders as
  plain text
- `#`, `##`, `###` at the start of a line → `<h1>`/`<h2>`/`<h3>` (inline markdown still applies to
  the heading text). A heading doesn't need a blank line around it — `## Title\nbody text` works.
- Anything else (blank-line-separated blocks with no heading) → one `<p>` per block, same as before
  this rollout.

## Adopting it on a field

- Multi-paragraph / heading-bearing text → `<Prose text={value} className={styles.whatever} />`
- Single-line text (a label, a tag, a one-line description) → `{renderInline(value)}`

Both live in `src/lib/markdown.ts`.

## Rolled out (this slice)

- `characters.lore.backstory`, `lore.personality.{trait,ideal,bond,flaw}`,
  `lore.relations[].desc` — `src/screens/Lore.tsx`
- `characters.spellbook.spells[].desc` — `src/screens/Spellbook.tsx` (`SpellDetail`'s
  `// Effect` block). Also closes the mockup's one HTML-injection gap: the Spellbook mockup
  wrote `sp.description` straight into `innerHTML` unescaped; `<Prose>` returns React nodes,
  never `dangerouslySetInnerHTML`, so there's no reopening it here.
- `effect_catalog.data.desc` (the Effects tab's Description block, `EffectForm` in
  `src/screens/OperatorConsole.tsx`) — `renderInline`, at every place the description is shown as
  a short/clipped fallback rather than a full paragraph: the effect's own live preview strip
  (`.efPrev .pr`), its index row summary (`.crS.prose`) in `EffectLibrarySurface`, and an item's
  referenced-effect summary (`.efRefSum.prose`) in the Items tab's Effects Granted picker. The
  input stays a plain textarea per the established convention; the hint suffix
  (`player-facing · **bold** *italics*`) follows the Spell form's exact wording.

## Not yet rolled out

Fields that still render raw text (or a bespoke blank-line-paragraph splitter with no inline
markdown) as of this slice:

- [ ] Quest player-facing description — `quests.description`, authored at
      `src/screens/OperatorConsole.tsx:3611` (`.qPlayerDesc` textarea), rendered raw via the
      local `paragraphs()` splitter at `src/screens/Journal.tsx:29-31,257`
- [ ] Session recap — `sessions.recap`, authored at `src/screens/OperatorConsole.tsx:3768`
      (`.sessRecap` textarea), rendered via the same `paragraphs()` splitter at
      `src/screens/Journal.tsx:307`
- [ ] Quest GM notes — `quest_secrets.gm_notes`, authored at `src/screens/OperatorConsole.tsx:3650`
      (DM-only, never shown to players — lower priority)
- [ ] True lore — `character_secrets.true_lore`, authored at `src/screens/OperatorConsole.tsx:3414`
      (`.gmNotes` textarea) — DM-only, never shown to players
- [ ] Item catalog `description` / `light_description` / `deep_description` —
      `src/lib/database.types.ts:129-136`, tooltip render in `src/components/ItemTooltip.tsx`
- [ ] Feature catalog descriptions — already migrated for Features cards
      (`src/screens/Features.tsx`), but confirm the DM authoring textarea in
      `src/screens/OperatorConsole.tsx` (FeatureForm) documents the syntax in its placeholder/hint

Ticking these off is a follow-up slice, not part of this one.
