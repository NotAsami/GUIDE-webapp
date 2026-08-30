# Foundry VTT ↔ External App: Creature-Boundary Integration Feasibility Assessment

## TL;DR
- **All seven event types are technically feasible**, but the right architecture is a **small custom Foundry module** (~a few hundred lines of JS/TS) that listens to Foundry/dnd5e Hooks and talks to your Supabase project directly — not the generic community REST relay, which is request/response-plus-SSE and adds a mandatory always-connected middleman.
- **Easy wins:** turn/round advancement (`combatTurn`/`combatRound`/`updateCombat`), 0-HP/"on kill" detection (`dnd5e.damageActor` + `updateActor`), target selection (`targetToken`), posting rolls to chat (`ChatMessage.create`), and applying damage (`Actor5e.applyDamage`). **Harder/caveated:** reliable "marked creature took damage/died" and applying conditions to *unowned* enemy tokens — both blocked by Foundry's permission model and solvable only via a GM-side socket relay.
- **The hard constraint that shapes everything:** Foundry is a client-side app. A module only runs inside a live, logged-in browser/Electron client. For your app to write to enemy tokens (damage, conditions) or to guarantee events are captured, **a GM (or Assistant GM) client must be connected**; player clients cannot modify creatures they don't own.

## Key Findings

### The architecture decision
There are three viable paths. In order of recommendation for your specific "narrow creature boundary" goal:

1. **Custom module → Supabase Realtime (recommended).** A purpose-built module registers Foundry Hooks and, inside the Foundry client, opens a WebSocket to Supabase Realtime (or calls `supabase-js`). This is the cleanest fit because your app already owns a Supabase project with Realtime, and the module can both *push* Foundry events into a Supabase channel and *subscribe* to a channel to receive commands (post roll, apply damage). No third-party relay, no monthly fee, no extra hop.
2. **Custom module → your own WebSocket/HTTP endpoint.** Same as above but pointing at a Supabase Edge Function or your own server instead of Realtime directly.
3. **Community "Foundry REST API" relay (ThreeHats).** Fastest to prototype (install a module, get an API key), but introduces a mandatory relay server, rate limits on the public tier, and a request/response + SSE model that is less ergonomic than owning the module.

### Foundry core Hooks (verified against v13/v14 API docs)
These are the exact hook names and signatures. Register with `Hooks.on("hookName", callback)`.

- **`updateCombat(combat, changes, options, userId)`** — fires on every combat document update. Detect turn changes with `if ("turn" in changes)` and round changes with `if ("round" in changes)`.
- **`combatTurn(combat, updateData, updateOptions)`** — `updateData = {round, turn}`, `updateOptions = {advanceTime, direction}`. Fires when the turn changes, on the initiating client *before* the database update.
- **`combatRound(combat, updateData, updateOptions)`** — same shape; fires when the round changes.
- **`combatTurnChange(combat, prior, current)`** — newer hook tied to the managed combat-events workflow; `prior`/`current` are `CombatHistoryData`. Good for reacting cleanly to turn-order progression without the false positives of `updateCombat`.
- **`targetToken(user, token, targeted)`** — fires when a token is targeted/untargeted; `targeted` is a boolean. Note a known quirk: clearing targets without SHIFT can fire the hook multiple times, so debounce and read `game.user.targets` (a `UserTargets` set) as the source of truth rather than trusting each call.
- **`updateActor(actor, change, options, userId)`** / **`preUpdateActor(...)`** — generic document update; HP lives at `actor.system.attributes.hp.value` in dnd5e. `preUpdateActor` fires before the write and can be used to see the delta.

### dnd5e system Hooks (verified against dnd5e wiki, current as of system v5.3.0)
The official D&D 5e system emits its own `dnd5e.*` hooks, which are far more precise than raw document updates:

- **`dnd5e.damageActor(actor, changes, update, userId)`** and **`dnd5e.healActor(...)`** — fires whenever an actor is damaged or healed *by any means* (including manual sheet edits and direct updates). `changes = {hp, temp, total}`. These were added in **dnd5e 3.1.0** specifically to close the gap that per-method `applyDamage` hooks missed: as dnd5e issue #3035 notes, the older hooks did "not account for the times a user may simply apply damage (or healing) directly through the character sheet, or via a direct update." The 3.1.0 release notes confirm "The new dnd5e.damageActor and dnd5e.healActor hooks should appropriately fire whenever an Actor is damaged or healed now," and that "the old dhp and dtemp options… have been removed." This is your primary "creature took damage" signal.
- **`dnd5e.preApplyDamage(actor, amount, updates, options)`** / **`dnd5e.applyDamage(actor, amount, options)`** — fire only when the system's `applyDamage` method is called (not manual HP edits).
- **`dnd5e.preCalculateDamage` / `dnd5e.calculateDamage`** — fire around resistance/immunity/vulnerability calculation.
- **`dnd5e.rollAttack`, `dnd5e.rollDamage`, `dnd5e.rollSavingThrow`, `dnd5e.rollDeathSave`, `dnd5e.postRollDeathSave`** — roll lifecycle hooks.
- **`dnd5e.rollInitiative(actor, combatants)`** and combat-recovery hooks (`dnd5e.combatRecovery`, `dnd5e.preCombatRecovery`) for start-of-turn resource recovery.

There is **no single dedicated "reduced to 0 HP / on kill" hook.** You detect it by combining `dnd5e.damageActor` (or `updateActor`) with a check that `actor.system.attributes.hp.value <= 0` (and, for the "reduced to 0 by this damage" semantics, that it was `> 0` before). Foundry's combat tracker separately marks combatants "defeated," and the system can auto-apply the `Dead` status to NPCs at 0 HP.

### Writing back into Foundry
- **Post a roll/message to chat:** `ChatMessage.create({...})`. For dice, `Roll#toMessage()` evaluates and posts in one call; the default message data is `{user, content, sound: CONFIG.sounds.dice}`, with formatting driven by `Roll.CHAT_TEMPLATE`. You can pass pre-computed content/flavor HTML so your app's roll breakdown renders verbatim. Any connected client can post chat.
- **Apply damage:** the dnd5e system exposes **`Actor5e#applyDamage(damages, options)`** (called as `actor.applyDamage(...)`), which respects resistances/immunities/vulnerabilities. Alternatively a raw HP write via `actor.update({"system.attributes.hp.value": n})`. The catch is *permissions* (below).
- **Apply a condition/status:** toggle a status effect on the token/actor (e.g. `token.actor.toggleStatusEffect(id)` in v12+, or create an `ActiveEffect`). Same permission constraint.

### The permission / connectivity model (the crux)
- Foundry is a **Node.js web app**; the module code runs **client-side in each connected browser/Electron client**. Hooks are **local** to the client — they are *not* sockets and do not automatically broadcast.
- A **player client can only modify documents it owns.** Enemy/NPC tokens are typically GM-owned, so a player client cannot apply damage or conditions to a targeted enemy. The standard workaround is Foundry's socket system: the player client emits a socket message and a **connected GM client** performs the privileged update. This is exactly what modules like Effective Tray do — per its package listing it "transmits target target and change data via sockets to allow an active GM client to apply effects (or damage) to a non GM user's targets."
- **`socketlib`** (community library, `game.socket` under the hood) provides `executeAsGM()` — "If a GM client is connected, that client will execute that function... If multiple GMs are connected, socketlib will make sure only one of the GMs will execute the function." **It fails if no GM is connected.** Foundry v13+ also has a native "queries" mechanism (`CONFIG.queries`, `QUERY_USER` permission) as an alternative.
- **Consequence:** anything that reads/writes *your own character* works from the player's own client. Anything touching *enemy creatures* (applying damage/conditions to targeted tokens, reliably observing an NPC's HP) needs a GM (or Assistant GM) client online. If your world is left running (cloud-hosted) but nobody is connected, **no module code runs at all** — persistence of the world happens server-side, but hooks/sockets require a live client.

### The community "Foundry REST API" relay (ThreeHats)
Verified capabilities (the package page lists it as compatible with Foundry "Versions 12+ (Verified 14)"):
- **Model:** a Foundry module connects over WebSocket to a relay server (Node.js); your app calls REST endpoints on the relay, which routes commands to the connected world. It "exposes your world data - actors, items, scenes, rolls, macros, chat, and more - through a clean REST API." Public relay at `wss://foundryrestapi.com`; self-host default `localhost:3010` (Docker). Auth via `x-api-key` header; scoped keys supported.
- **It CAN push events outward** via **Server-Sent Events**: `GET /chat/subscribe`, `GET /rolls/subscribe`, and `GET /hooks/subscribe` ("Stream Foundry hook events (combat, actor, scene, and more)"), all returning a persistent `text/event-stream`. A separate bidirectional **WebSocket API** also exists. So it is *not* request/response only.
- **Endpoint groups:** Auth, Canvas (tokens/walls/lights), Chat (send/retrieve/subscribe), Clients, DnD5e, Effects (active effects on actors & tokens), Encounter (combat encounter management), Entity (CRUD via `/get`,`/create`,`/update`,`/delete`), Events, FileSystem, Macro, Playlist, Roll, Scene, Search, Session (headless), Sheet, Structure, User, Utility, WebSocket.
- **Chat posting, combat-state reading, entity/HP updates are supported** (chat group explicitly sends messages; Encounter group manages combat; entity `/update` can write `system.attributes.hp.value`). A dedicated typed-damage endpoint under `/dnd5e` is plausible but I could not verify its exact path/body against the live docs.
- **Requires a connected Foundry client** (the module runs in a browser/Electron client; pairing token stored per-browser in localStorage). It offers a **headless Puppeteer "Session"** mode to run an unattended client, but there is no serverless mode.
- **Public-tier rate limits:** per the relay README, "The public relay has rate limits (100 requests/month free, 1000/day). For unlimited usage, self-host or subscribe for $5/month."

### Module developer experience
- **Language/tooling:** plain JavaScript ES modules, or TypeScript compiled with Vite (community type definitions: `@league-of-foundry-developers/foundry-vtt-types`). Given your stack is already Vite + React + TS, you can reuse your toolchain.
- **Manifest:** a `module.json` with required fields `id`, `title`, `description`, `version` (plus `compatibility` and `esmodules`/`scripts` arrays). The module folder lives in `{userData}/Data/modules/<id>/` and the folder name must match `id`.
- **Loading:** scripts in `esmodules` load automatically in the game view (not the setup/join screens). A minimal "hello world" is a single `.js` file registering a hook in `Hooks.once("ready", ...)`.
- **Outbound network:** modules run in the browser, so calls are subject to CORS and the page's Content-Security-Policy `connect-src` directive, which governs `fetch()`, `XMLHttpRequest`, `WebSocket`, and `EventSource`. Self-hosted Foundry does not ship a restrictive CSP that blocks outbound `fetch`/WebSocket to arbitrary hosts, and Supabase serves permissive CORS headers for its REST/Realtime endpoints, so `supabase-js` and a Realtime WebSocket both work from inside a module. Effort for a minimal working module: roughly a day or two for someone comfortable with JS/TS.

### Prior art
- **Beyond20** (kakaroto/Beyond20, GPL v3; "over 300,000 users as of March 2021") is the closest analog: a browser extension that injects rolls from D&D Beyond into Foundry's chat, paired with a companion Foundry module so other clients render the rolls. Key lesson: it operates in the *same browser* as the Foundry tab and, on Chrome, "you need to click on the Beyond20 icon in the Chrome window's toolbar to activate Beyond20 for your FVTT installation" on each reload — a reminder that browser-context integrations are tied to a live session.
- **Effective Tray / Effective Tray NG** demonstrate the GM-socket relay pattern for letting non-GM players apply damage/effects to unowned targets.
- **external-dice-roll-connector** and KaKaRoTo's HTTP API module show simple external→Foundry roll injection via a module endpoint.

## Details — the seven event types

**FOUNDRY → EXTERNAL APP**

1. **Turn/round advancement — EASY.** Listen to `combatTurn` and `combatRound` (or `combatTurnChange` for clean turn-order deltas; or `updateCombat` with a `"turn"/"round" in changes` guard). Read `combat.round`, `combat.turn`, `combat.combatant`. Push a `{round, turn, combatantId}` message to Supabase. Works from any connected client, but to capture it reliably regardless of who's looking, run it on the GM client. ~1–2 hours.

2. **Reduced to 0 HP / "on kill" — EASY-MODERATE.** Best signal: `dnd5e.damageActor(actor, changes, update, userId)`, then check `actor.system.attributes.hp.value <= 0`. To distinguish "*reduced* to 0 by this hit," verify prior HP was `> 0` (use `preUpdateActor` to capture the before-value, or `changes.total`). No dedicated kill hook exists. Since the *victim* is usually a GM-owned NPC, the GM client is the reliable listener. ~2–4 hours including the "was it this player's damage" attribution.

3. **Target selection — EASY.** `targetToken(user, token, targeted)`; filter to `user.id === game.user.id` (the player's own targets) and read `game.user.targets`. Debounce the known multi-fire quirk. Push the current target set (token IDs, actor IDs, and — if you have permission — their HP/AC). Runs on the player's own client. ~1–2 hours.

4. **"Marked" creature took damage or died — MODERATE.** Feasible by listening to `dnd5e.damageActor`/`updateActor` for the specific token/actor UUIDs your app has flagged, then filtering client-side. Reliability requires a GM client online because the marked creature is GM-owned; a player client won't receive ownership-scoped updates for tokens it can't see/own, and won't fire local hooks for changes it didn't initiate unless it also has the document loaded. Recommend running this listener on the GM client and relaying. ~half a day.

**EXTERNAL APP → FOUNDRY**

5. **Post a formatted roll to chat — EASY.** `ChatMessage.create({content, flavor, speaker, rolls})` or `Roll#toMessage()`. Any connected client can post. Send your app's pre-rendered breakdown HTML as `content`. If via your own module: your module subscribes to a Supabase channel and calls `ChatMessage.create` on receipt. ~2–4 hours (mostly HTML/template polish).

6. **Apply damage to targeted token(s) — MODERATE.** Use `Actor5e#applyDamage()` (respects resistances) or a raw HP `update`. If the initiator is a player and the target is GM-owned, route through a GM client via `socketlib.executeAsGM()` or native queries. **Requires a GM/Assistant GM connected.** ~half a day to a day including the socket relay.

7. **Apply a condition/status to targeted token — MODERATE.** Toggle a status effect or create an `ActiveEffect` on the token/actor. Same GM-permission routing as #6. ~half a day, sharing the socket plumbing from #6.

## Recommendations

**Stage 1 — Prove the read path (1–3 days).** Build a minimal TS module (Vite, `module.json` with `esmodules`). In `Hooks.once("ready")`, open a Supabase Realtime channel using `supabase-js`. Wire `combatTurn`/`combatRound`, `targetToken`, and `dnd5e.damageActor` to publish JSON to a channel your React app subscribes to. Deliberately excludes any writes. This validates the whole transport and the CSP/CORS assumptions with near-zero permission risk. **Benchmark to proceed:** turn changes and target changes appear in your app within ~1s, reliably, with the GM client connected.

**Stage 2 — Add the write path for the character's own actions (2–4 days).** Subscribe the module to a "commands" channel; implement `ChatMessage.create` for roll posting (event #5). This needs no special permissions. **Benchmark:** your app's roll breakdown renders in Foundry chat identically to how it looks in your roll context panel.

**Stage 3 — Add creature writes via a GM relay (3–6 days).** Add `socketlib` as a dependency; implement `executeAsGM` handlers for `applyDamage` and status/condition application (events #6, #7), plus the GM-side listeners for "marked creature" and reliable 0-HP detection (events #2, #4). **Benchmark/threshold:** with a GM client online, damage applied from your app lands on the correct enemy token and respects resistances; with *no* GM online, your app degrades gracefully (queues or disables those buttons).

**Decision rule — module vs. relay.** Build the custom module (path 1) if you want to own the integration long-term, avoid rate limits/fees, and keep data flowing straight into Supabase. Use the ThreeHats REST relay only for a throwaway spike, or if you specifically want to drive Foundry from a *backend* (no browser) via its headless Puppeteer session and can accept the extra hop. If you ever need the integration to work with **no human GM present**, plan for a dedicated always-on headless "bot GM" client — that is the only way to keep privileged writes and reliable NPC-event capture alive between sessions.

## Caveats
- **A live client must be connected for any module code to run.** World data persists server-side, but hooks and sockets are client-side. No connected client = no events, no writes.
- **GM connectivity gates all creature-side operations.** Applying damage/conditions to enemy tokens and reliably observing NPC HP require a GM/Assistant GM client online. Design for graceful degradation.
- **No dedicated "on kill" hook** in core or dnd5e; you synthesize it from damage/HP-update hooks plus a threshold check.
- **`targetToken` multi-fires** on untarget without SHIFT; debounce and treat `game.user.targets` as truth.
- **Hooks are local, not broadcast.** An event fired on one client is not automatically seen by others; that's why the GM-listener + socket relay pattern matters.
- **Version currency:** hook signatures above are verified against Foundry v13/v14 API docs and dnd5e system wiki (up to date as of dnd5e 5.3.0, current in 2026). `combatTurnChange` is a newer core hook; older worlds (v10–v11) may only have `combatTurn`/`combatRound`/`updateCombat`. The dnd5e `damageActor`/`healActor` hooks require dnd5e **3.1.0+**, and that release "ONLY SUPPORTS Foundry Virtual Tabletop version 11 (release) and greater"; earlier systems relied on the now-removed `dhp` update option and only had `applyDamage`-based detection.
- **REST relay endpoint specifics:** I verified the relay's SSE push endpoints, endpoint groups, auth, rate limits, and connected-client requirement, but could not verify the exact path/body of a typed-damage endpoint under `/dnd5e` or the exact chat-send path; confirm against the live docs or repo source (`go-relay/` and `src/`) if you choose that path.
- **CSP/CORS:** verified in principle (browser `connect-src` governs outbound fetch/WebSocket; Supabase sends permissive CORS). If you place a reverse proxy in front of Foundry with a custom CSP, ensure `connect-src` allows your Supabase project's host and `wss://` endpoint.
- **Security:** embedding a Supabase key inside a distributed module exposes it to anyone with the module. Use a scoped/anon key with tight Row Level Security, or better, have the module authenticate as a specific service identity and restrict channel/table access; never ship a service-role key in client-side module code.