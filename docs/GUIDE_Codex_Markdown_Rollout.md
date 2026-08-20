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
- `[text]{colour}` — an inline colour span. A palette name (`radiant`, `fire`, `cold`, …), a design
  token (`--cyan-hot`) or a literal hex (`#e2b021`), resolved through `lib/palette.ts`. Nests, so
  `[**Fire**]{fire}` still bolds. An unresolvable colour renders the source verbatim rather than
  silently dropping the tag. `]{` and `](` cannot both match at one position, so a colour span and
  a link never collide. Full authoring guidance: `GUIDE_Codex_Authoring.md` → *Colouring prose*.
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

## Rolled out — complete

Every field that offers the shortcuts now renders them, and the two directions are guarded rather
than tracked as a checklist here.

- **Authoring** — `src/lib/proseFields.test.ts` fails on a prose textarea that renders markdown but
  does not offer `Ctrl+B`/`I`/`K`. Fields that are plain on purpose live in `PLAIN_ON_PURPOSE`,
  each with the reason it renders nowhere.
- **Rendering** — the same file fails on a markdown-authored field printed raw. `RAW_ON_PURPOSE`
  holds the two deliberate exceptions: op-schema field help (hardcoded in `opSchema.ts`, not
  authored) and shard perk blurbs (a single-line input that never offered the shortcuts).

Both exemption lists fail their own staleness test if an entry stops matching anything, so an
excuse cannot outlive the field it was written for.

### Closed since the list above was written

- Quest player-facing description and session recap — both now `<Prose>` in `Journal.tsx`; the
  local `paragraphs()` splitter is gone.
- Feature `light_description` / `deep_description` — authored with shortcuts in `FeatureEditor.tsx`,
  rendered with `<Prose>` in `Features.tsx`. *(The earlier entry filed these under the item catalog.
  They are Feature fields; items carry `flavor`.)*
- Quest GM notes and true lore — deliberately plain, now recorded in `PLAIN_ON_PURPOSE` rather than
  left as unchecked boxes. They are DM-only and render nowhere a player sees.

### The render-side gap, and why it is worth remembering

Adoption was tracked as an authoring problem, so the rollout above was declared done while six
surfaces still printed the text raw. A weapon's description coloured correctly in its hover tooltip
and showed `[Mercy]{radiant}` as literal characters in the Equipment detail panel directly beneath
it — one authored string, two render paths, only one upgraded. Item and weapon detail, the Inventory
item popup, the shop header and the path-choice cards were fixed together.

Nothing looked broken at any point: `{item.flavor}` is valid React that renders something plausible.
That is why the guard is a source scan and not a unit test — no pure function can see a missing JSX
wrapper. See `CLAUDE.md` → *Recurring bug: one authored value, two render paths*, which covers the
icon version of the identical mistake.
