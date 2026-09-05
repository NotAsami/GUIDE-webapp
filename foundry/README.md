# G.U.I.D.E. Bridge — the Foundry half

A Foundry VTT module that joins the same Supabase Realtime broadcast channel the
webapp uses (`guide-foundry`) and:

- sends `{kind:'turn'}` when a combat turn begins for a mapped character → the
  codex runs its turn boundary (effects tick, per-turn vars reset, uses recharge);
- receives `{kind:'roll'}` → posts the codex's roll breakdown to chat, spoken by
  that character;
- receives `{kind:'apply'}` → applies that roll's damage to the creature it was
  rolled against, through `Actor5e#applyDamage`, so the target's own
  resistances and immunities decide what it actually takes;
- receives `{kind:'actors'}` → creates or updates the party actors from the
  webapp's derived sheets, and remembers actor-id → character-id;
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

## Using it

1. **Operator Console → the d20 button** in the header syncs the party. Actors
   appear in the Actors sidebar; press it again after a level-up or new gear and
   it updates rather than duplicating.
2. Drag the actors onto a scene and start a combat. Advancing to a mapped
   combatant's turn runs that player's turn boundary in the codex.
3. **Roll Context Panel → "Post to Foundry"** on any settled roll posts its
   breakdown to chat. Disabled while riders are still waiting, because the total
   is still moving.

## What it deliberately does not do

Target selection, applying damage or conditions to enemy tokens, reading HP back
out of Foundry. The codex has no notion of a target creature (a documented
boundary — `docs/GUIDE_Codex_Deferred.md`), and `sheet.hp.current` stays the one
source of truth for hit points. The Foundry actor is a mirror.

`lib/supabase.umd.js` is a verbatim copy of
`node_modules/@supabase/supabase-js/dist/umd/supabase.js` — re-copy it when the
app bumps supabase-js. There is no build step for this module on purpose.
