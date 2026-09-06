# G.U.I.D.E. Bridge — the Foundry half

A Foundry VTT module that joins the same Supabase Realtime broadcast channel the
webapp uses (`guide-foundry`) and:

- sends `{kind:'turn'}` when a combat turn begins for a mapped character → the
  codex runs its turn boundary (effects tick, per-turn vars reset, uses recharge);
- receives `{kind:'roll'}` → posts the codex's roll breakdown to chat, spoken by
  that character;
- receives `{kind:'apply'}` → posts the roll to chat AND applies its damage to
  the creature it was rolled against, through `Actor5e#applyDamage`, so the
  target's own resistances and immunities decide what it actually takes. One
  message, one handler, on purpose: nobody takes hit points off a creature
  without the table seeing the roll that did it;
- receives `{kind:'actors'}` → creates or updates the party actors from the
  webapp's derived sheets — including the equipped weapons, **to be looked at
  and not rolled** (the codex knows about shards, features and armed modifiers;
  the Foundry sheet does not) — and remembers actor-id → character-id. It
  updates and deletes only items it made, so anything you add to an actor by
  hand is left alone;
- receives `{kind:'condition'}` → toggles a Foundry status on the targeted
  creature, from the Operator Console;
- receives `{kind:'macros'}` → keeps a hotbar macro per equipped weapon. The
  macro ASKS the codex to roll (`{kind:'request'}`); it never rolls here, since
  this side knows nothing about shards, features or armed modifiers;
- receives `{kind:'effects'}` → projects the character's OWN effects onto their
  token, reconciled to the codex's list. A name that matches a real condition
  lights Foundry's own icon; anything else appears as a named effect. Clearing
  one of these in Foundry brings it back — the codex's list is the record, so
  ending it there is what ends it;
- sends `{kind:'conditions'}` whenever a mapped character's statuses change, so
  a Blinded dropped on a token shows up in that player's Effects panel — a
  mirror, not a record: the app never writes them to the character row, and they
  are lifted in Foundry;
- sends `{kind:'downed'}` when an NPC reaches 0 HP, which the party's toast
  layer says out loud — the one battlemap event every player wants and none of
  them can see;
- re-sends the target whenever a creature or token changes, so editing a
  targeted enemy's AC mid-combat cannot leave the app deciding hit or miss
  against a number that has moved.

**GM client only.** Foundry hooks are local to a client and only a GM may write
actors. Nothing works when no Foundry client is connected — that is Foundry's
model, not a limitation of this module.

## Install

Already linked on this machine (a directory junction, so edits here are live —
just reload Foundry with F5):

```
mklink /J "%LOCALAPPDATA%\FoundryVTT\Data\modules\guide-bridge" "<repo>\foundry\guide-bridge"
```

Then in Foundry: **Game Settings → Manage Modules → G.U.I.D.E. Bridge → enable →
reload**, and fill in the four settings:

| Setting | Value |
|---|---|
| Supabase URL | the project URL (same as `VITE_SUPABASE_URL`) |
| Supabase anon key | same as `VITE_SUPABASE_ANON_KEY` — **never** the service-role key |
| Bridge account email | a dedicated Supabase user, e.g. `foundry-bridge@…` |
| Bridge account password | that user's password (email+password sign-in must be enabled) |

The bridge account needs **no** table access: the module never touches Postgres,
it only signs in so the socket has an identity. Do not add it to `dm_users`.

A working boot logs `guide-bridge: joined` to the Foundry console (F12).

## Swinging from the map

After a sync each character's weapons exist as macros named `<Character> ·
<Weapon>`. Drag one to the hotbar once — later syncs update it in place, so the
slot survives. Clicking it asks that player's codex to roll: the result lands in
their roll log, the toast, and — where the roll hit a targeted creature — the
chat card and the creature's hit points.

The result posts itself to chat, because a swing asked for from the map that
says nothing on the map reads as a macro that did not work. The exception is a
roll with an offered modifier still on it (Brutal Strike and its like): that
total is still moving, so it waits for the panel's own Post control, where the
decision can actually be made.

The codex has to be OPEN on that character for a request to be answered; it is
the thing doing the rolling. It does not have to be on any particular screen.

One difference from pressing Attack in the app: no priming sheet. The button
offers armable modifiers first when there are any, and a macro has nobody
looking at that screen, so it rolls with whatever is already armed.

## Using it

1. **Operator Console → the d20 button** in the header syncs the party. Actors
   appear in the Actors sidebar; press it again after a level-up or new gear and
   it updates rather than duplicating.
2. Drag the actors onto a scene and start a combat. Advancing to a mapped
   combatant's turn runs that player's turn boundary in the codex.
3. **Roll Context Panel** → **"Post & apply N to <creature>"** on a settled roll
   that hit something: the breakdown lands in chat and the damage lands on the
   creature, in one press. With nothing targeted — or on a miss, a check, a save
   — the control is **"Post to Foundry"** and only posts. Both are disabled
   while riders are still waiting, because the total is still moving.

## What it deliberately does not do

Reading HP back out of Foundry: `sheet.hp.current` stays the one source of truth
for a PC's hit points and the Foundry actor is a mirror. Nothing here writes to
a character row.

"Tell me when the creature I MARKED is hurt" is the one event of the seven still
unbuilt — the hook is one line, but nothing in the app can say "that one" about
a creature yet. See `docs/GUIDE_Codex_Deferred.md`.

No `socketlib`, and none is needed: it exists so a PLAYER's Foundry client can
ask a GM client to touch something it does not own, and this module already runs
on the GM client.

`lib/supabase.umd.js` is a verbatim copy of
`node_modules/@supabase/supabase-js/dist/umd/supabase.js` — re-copy it when the
app bumps supabase-js. There is no build step for this module on purpose.

## Dressing Foundry's own screens (optional)

`login.css` and `setup.css` in this folder restyle Foundry's join and setup
screens in the codex's language — cyan for the player's side, amber for the
operator's, the same tokens `src/styles/tokens.css` holds.

They need **Plutonium's server-side addons**, which are not a module: they patch
Foundry itself.

1. Install the Plutonium backend (`plutonium-backend.mjs` beside Foundry's
   `main.mjs`, plus the import line — see Plutonium's own README).
2. Copy `plutonium-backend-addon-custom-login.mjs` and
   `plutonium-backend-addon-custom-setup.mjs` next to it.
3. `login.css` → `Data/worlds/elyndor/login.css`
   `setup.css` → `Data/setup.css` (beside `modules`, `systems`, `worlds`).

**Two things to know before you do.** The patch is to Foundry's own files, so it
must be re-applied after every Foundry update — the styling itself survives,
being plain CSS in the data folder. And Plutonium's own README warns that
enabling these addons lets anyone with upload permission run scripts and styles
on those pages; for a private table with no untrusted uploaders that is a
shrug, but it is worth knowing you accepted it.

The CSS is written conservatively — colour and type, no layout surgery, no
clip-path chamfers — because Foundry moves this markup between versions and a
missed selector should leave a plain control on a styled page rather than an
invisible one. If something reads wrong, say which control and I will target it.

