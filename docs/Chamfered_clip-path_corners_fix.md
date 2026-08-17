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

### The recipe above only works for 45° chamfers — a HEXAGON needs the two-layer fix
`0.7071` is `1/√2`, the perpendicular offset of a **45°** line. A hexagon
(`polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)`) has obliques at a
different angle entirely, so the two gradients land in the wrong place and all four
diagonals stay bare. Reaching for the recipe above and finding it "didn't work" is
exactly how this came back on `.imCrystal` (the Features popup's crystal icon) after
being fixed everywhere else.

**For any polygon that is not a 45° chamfer, don't draw a border at all — paint two
layers.** A filled shape, and the same shape inset by the border width on top:

```css
.hex {
  --edge: rgba(0, 166, 214, 0.5);      /* the "border" colour */
  position: relative;
  background: var(--edge);             /* the fill IS the border */
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.hex::before {                          /* the interior, 1.5px smaller */
  content: ""; position: absolute; inset: 1.5px; z-index: 0;
  background: #0b0b0b;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.hex > * { position: relative; z-index: 1; }   /* content above the interior */
```
Variants override `--edge` and the `::before` background — never `border-color`,
which no longer exists here. `inset: 1.5px` rather than `1px` for the same
fractional-zoom reason as below. Existing examples: `.hxFrame`/`.hxInner` (the
Features card hexagon, which does this with two real elements instead of a
pseudo-element) and `.imCrystal`. This is also the technique the mockups use for
every framed panel — a beige fill with a dark inset — so it is the house style
rather than a workaround.

**The mockups themselves contain the buggy version** (`.im-crystal` is `clip-path`
+ `border: 1px`), so porting one faithfully reproduces the bug. Fix it in the port.

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
