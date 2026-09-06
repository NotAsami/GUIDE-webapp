/**
 * A sound when something lands.
 *
 * The bridge made the codex a thing you can be told something by while looking
 * somewhere else entirely: a swing pressed on the Foundry hotbar, a turn that
 * came round, an arm waiting to be taken. All of it appeared silently on a
 * screen nobody was looking at, and a roll that needs an answer is exactly the
 * one you must not miss.
 *
 * SYNTHESISED, not a file. Two oscillators and an envelope are smaller than any
 * audio asset, need no licence and no network, and sound like the terminal this
 * app is dressed as. It also means there is nothing to 404.
 *
 * THE BROWSER WILL NOT LET A PAGE MAKE NOISE unheard. Audio is blocked until
 * the user has interacted with the page at least once, which is precisely the
 * case that matters here — the player is in Foundry and this tab is in the
 * background. `unlockChime` spends the first gesture the app receives on
 * opening the context, so every later sound works whatever tab is in front.
 */

const KEY = 'guide.chime'

/** Off is a deliberate choice and it persists per DEVICE, not per character:
 *  the phone on the table and the laptop in the corner want different answers,
 *  and neither is a fact about the character. */
export function chimeEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setChimeEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private window: this session only */ }
}

type Ctor = typeof AudioContext
let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (ctx) return ctx
  const Ctx: Ctor | undefined = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
  if (!Ctx) return null
  try { ctx = new Ctx() } catch { return null }
  return ctx
}

/** Spend the first user gesture on opening the audio context, so a sound
 *  triggered later — by Foundry, with this tab in the background — is allowed
 *  to play. Safe to call more than once; it removes its own listeners. */
export function unlockChime(): void {
  const open = () => {
    const c = context()
    if (c?.state === 'suspended') void c.resume()
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, open)
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, open, { passive: true })
}

/** One note. Triangle rather than sine: it carries across a room at a volume
 *  that does not make anyone jump. */
function note(c: AudioContext, hz: number, at: number, ms: number, gain: number) {
  const osc = c.createOscillator()
  const vol = c.createGain()
  osc.type = 'triangle'
  osc.frequency.value = hz
  /* An envelope, because a bare gate clicks: the attack and release are what
     make this a chime instead of a pop. */
  vol.gain.setValueAtTime(0, at)
  vol.gain.linearRampToValueAtTime(gain, at + 0.012)
  vol.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000)
  osc.connect(vol).connect(c.destination)
  osc.start(at)
  osc.stop(at + ms / 1000 + 0.02)
}

/** What happened, in the order of how much it wants you.
 *
 *  `ask` is three notes and the only rising one — it is the sound for "this is
 *  waiting on you", and it has to be distinguishable from the other two while
 *  someone is talking. `roll` and `notice` are single, quiet and quickly over. */
export function chime(kind: 'roll' | 'ask' | 'notice'): void {
  if (!chimeEnabled()) return
  const c = context()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime + 0.01
  if (kind === 'ask') {
    note(c, 784, t, 90, 0.05)
    note(c, 988, t + 0.09, 90, 0.05)
    note(c, 1319, t + 0.18, 160, 0.055)
  } else if (kind === 'roll') {
    note(c, 988, t, 70, 0.04)
    note(c, 1319, t + 0.07, 120, 0.04)
  } else {
    note(c, 660, t, 110, 0.035)
  }
}
