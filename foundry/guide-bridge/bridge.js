/**
 * G.U.I.D.E. Bridge — the Foundry half of the codex integration.
 *
 * ONE broadcast channel, two directions:
 *   out  {kind:'turn'}    a combat turn began for a mapped actor
 *   in   {kind:'roll'}    post a settled codex roll to chat, as its character
 *   in   {kind:'actors'}  create/update the party actors from the codex rows
 *   out  {kind:'mapped'}  the actor-id -> character-id map, after a sync
 *
 * GM CLIENT ONLY. Foundry hooks are local to a client and only a GM may create
 * or update actors, so a player client running this would either duplicate the
 * turn message or fail the write. `game.user.isGM` is the whole guard.
 *
 * The module never reads or writes Postgres — it signs in only so the socket
 * has a real identity. Everything it knows arrives on the channel.
 */

const MOD = 'guide-bridge'
const CHANNEL = 'guide-foundry'
const EVENT = 'fvtt'

/** actor id -> character row id. A world setting, not a DB column: two PCs and
 *  a map the actor sync fills in on its own. */
const mapOf = () => game.settings.get(MOD, 'map') ?? {}
const charOf = (actorId) => mapOf()[actorId]
/* A LIVE actor only. An actor deleted in Foundry leaves its id behind in the
   map, and returning that dead id made every later sync create a fresh actor
   AND keep finding the dead one first — a new duplicate on every press. The
   map is pruned on save; this is the guard that makes a stale one harmless in
   the meantime. */
const actorOf = (charId) => {
  const map = mapOf()
  return Object.keys(map).find((a) => map[a] === charId && game.actors.get(a))
}

let ch = null
const send = (msg) => ch?.send({ type: 'broadcast', event: EVENT, payload: msg })

/** The UMD global from lib/supabase.umd.js. module.json loads it as a classic
 *  script, which SHOULD run before this ES module — the fallback exists because
 *  "should" is not a guarantee across Foundry versions, and the failure mode is
 *  a bridge that silently never connects. */
async function supabaseLib() {
  if (globalThis.supabase) return globalThis.supabase
  await new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `modules/${MOD}/lib/supabase.umd.js`
    el.onload = resolve
    el.onerror = reject
    document.head.append(el)
  }).catch(() => null)
  return globalThis.supabase ?? null
}

Hooks.once('init', () => {
  const s = (key, name, hint, extra = {}) =>
    game.settings.register(MOD, key, {
      name, hint, scope: 'world', config: true, type: String, default: '', ...extra,
    })
  s('url', 'Supabase URL', 'https://<project>.supabase.co')
  s('key', 'Supabase anon key', 'The publishable/anon key — never the service-role key.')
  s('email', 'Bridge account email', 'The dedicated Supabase user this module signs in as.')
  s('password', 'Bridge account password', 'Stored in this world\u2019s settings.')
  game.settings.register(MOD, 'map', {
    scope: 'world', config: false, type: Object, default: {},
  })
})

Hooks.once('ready', async () => {
  if (!game.user.isGM) return
  const url = game.settings.get(MOD, 'url')
  const key = game.settings.get(MOD, 'key')
  if (!url || !key) return ui.notifications.warn('G.U.I.D.E. Bridge: set the Supabase URL and key in module settings.')

  const lib = await supabaseLib()
  if (!lib) return ui.notifications.error('G.U.I.D.E. Bridge: the Supabase library did not load.')
  const client = lib.createClient(url, key, { auth: { persistSession: false } })
  const email = game.settings.get(MOD, 'email')
  const password = game.settings.get(MOD, 'password')
  if (email) {
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) return ui.notifications.error(`G.U.I.D.E. Bridge: sign-in failed — ${error.message}`)
  }

  ch = client.channel(CHANNEL)
  ch.on('broadcast', { event: EVENT }, ({ payload }) => onMessage(payload))
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log(`${MOD}: joined`)
    else if (status === 'CHANNEL_ERROR') ui.notifications.error('G.U.I.D.E. Bridge: channel error.')
  })
})

async function onMessage(msg) {
  try {
    if (msg?.kind === 'roll') await postRoll(msg)
    else if (msg?.kind === 'actors') await syncActors(msg)
  } catch (err) {
    console.error(`${MOD}:`, err)
    ui.notifications.error(`G.U.I.D.E. Bridge: ${err.message}`)
  }
}

/** The codex sends finished HTML. It renders its own breakdown; Foundry only
 *  has to say WHO rolled, which is what keeps it from reading as a GM message. */
async function postRoll({ character, title, html }) {
  const actorId = actorOf(character)
  const actor = actorId ? game.actors.get(actorId) : null
  await ChatMessage.create({
    content: html,
    flavor: title ?? '',
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: 'G.U.I.D.E.' },
  })
}

/**
 * Update an actor that already exists.
 *
 * `items` CANNOT ride along in the update: Foundry treats an embedded entry
 * with no `_id` as a CREATE, so every re-sync added a second class item — two
 * Arbiter 18s read as a level-36 character with +10 proficiency. The document
 * and its embedded items are two writes, and the class item is matched by TYPE
 * rather than by name so renaming a class updates it instead of doubling it.
 *
 * Only the ONE class item the exporter sends is reconciled. Anything else on
 * the actor — items the DM added by hand, a second class from a multiclass done
 * Foundry-side — is left alone.
 */
async function updateActor(actor, data) {
  const { items = [], ...doc } = data
  await actor.update(doc)
  for (const item of items) {
    const match = actor.items.find((i) => i.type === item.type)
    if (match) await match.update({ name: item.name, system: item.system })
    else await actor.createEmbeddedDocuments('Item', [item])
  }
}

/** Create or update one actor per character row. The payload is built app-side
 *  (lib/foundryActor.ts) off the DERIVED sheet — this end does no arithmetic. */
async function syncActors({ actors }) {
  const map = { ...mapOf() }
  for (const { character, data } of actors ?? []) {
    const known = actorOf(character)
    const existing = known ? game.actors.get(known) : null
    if (existing) await updateActor(existing, data)
    else {
      const created = await Actor.create(data)
      map[created.id] = character
    }
  }
  // Forget actors that no longer exist, so the map cannot grow a graveyard.
  for (const id of Object.keys(map)) if (!game.actors.get(id)) delete map[id]
  await game.settings.set(MOD, 'map', map)
  send({ kind: 'mapped', map })
  ui.notifications.info(`G.U.I.D.E. Bridge: ${actors?.length ?? 0} actor(s) synced.`)
}

/* THE TURN SIGNAL. `combatTurnChange` is the v13+ hook tied to the managed
   combat-events workflow — `updateCombat` fires on every combat write and would
   send a turn message when someone renames the encounter. `current` is
   CombatHistoryData: {round, turn, combatantId, tokenId}. */
Hooks.on('combatTurnChange', (combat, _prior, current) => {
  if (!game.user.isGM || !ch) return
  const actorId = combat.combatants.get(current?.combatantId)?.actor?.id
  const character = actorId ? charOf(actorId) : undefined
  if (!character) return
  send({
    kind: 'turn',
    character,
    combat: combat.id,
    round: current.round,
    turn: current.turn,
  })
})

/* ---------------------------------------------------------------------------
   TARGETS
   
   `targetToken` fires on THIS client for anyone's targeting — Foundry syncs the
   reticle to everyone — so the GM client sees a player's target without the
   player running the module.

   WHOSE ROLL IT IS. A player targeting answers for themselves: their Foundry
   user has an assigned actor (`user.character`). The GM has none, so their
   target belongs to whoever is currently up in the combat tracker, which is the
   only reading that matches what a DM is doing when they target for the person
   swinging. Out of combat, a GM target belongs to nobody and is not sent.

   DEBOUNCED, and the message states the WHOLE selection rather than one
   token's change: clearing targets without SHIFT fires the hook several times,
   and `user.targets` is the only thing that is true afterwards. A dropped
   message therefore cannot leave a stale target behind.
--------------------------------------------------------------------------- */

let targetTimer = null

function activeCharacter() {
  const combat = game.combats?.active
  const actorId = combat?.combatant?.actor?.id
  return actorId ? charOf(actorId) : undefined
}

function sendTarget(user) {
  const character = user.character ? charOf(user.character.id) : activeCharacter()
  if (!character) return
  const token = user.targets.first() ?? null
  send({
    kind: 'target',
    character,
    token: token
      ? {
        token: token.id,
        name: token.name ?? token.actor?.name ?? 'Target',
        /* The AC the app compares the d20 against. Read as GM, which is the
           whole reason this runs here: a player client cannot see an enemy's
           sheet. The app shows the verdict, never this number. */
        ac: token.actor?.system?.attributes?.ac?.value,
      }
      : null,
  })
}

Hooks.on('targetToken', (user, _token, _targeted) => {
  if (!game.user.isGM || !ch) return
  clearTimeout(targetTimer)
  targetTimer = setTimeout(() => sendTarget(user), 80)
})
