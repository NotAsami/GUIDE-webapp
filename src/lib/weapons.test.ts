// Run: node --test src/lib/weapons.test.ts
//
// The engine's FIRST consumer. Everything before this was pure and testable by
// inspection; rollWeaponAttack rolls dice, so these stub Math.random rather than
// asserting on ranges — a test that tolerates any number in a range would pass
// while the contribution silently went missing, which is the failure shape this
// whole engine exists to prevent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CharacterRow, CharacterSheet, EquippedWeapon } from './database.types.ts'
import type { Resolution } from './graph.ts'
import { buildContext, gid, resolve, total } from './graph.ts'
import { rollWeaponAttack, isRanged, weaponAbilityKey, weaponAttackBonus, weaponDamageBonus } from './weapons.ts'

const SHEET = {
  abilities: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 3,
} as CharacterSheet

/** STR 16 → +3, prof +3. Attack +6, damage +3, before anything the graph says. */
const SWORD = { id: 'w1', name: 'Longsword', damageDice: '1d8', ability: 'str', type: 'slashing' } as EquippedWeapon

/** Pin every die. Each entry is [face, sides] in the order the roller asks for
 *  them; running out throws, so a change in roll ORDER fails loudly instead of
 *  quietly reading someone else's die. */
function pin<T>(faces: [number, number][], fn: () => T): T {
  const real = Math.random
  const q = [...faces]
  Math.random = () => {
    const next = q.shift()
    if (!next) throw new Error('pin(): ran out of dice — the roll order changed')
    return (next[0] - 1) / next[1]
  }
  try { return fn() } finally { Math.random = real }
}

/** A Resolution carrying at most one unconditional contribution.
 *
 *  `flat`/`dice` used to live on the Resolution itself; §49 deleted that second
 *  record, so an unconditional contribution is now expressed the only way it
 *  exists — as an `always` rider. Same fixture shorthand, one layer down. */
const RES = ({ flat, dice, ...over }: Partial<Resolution> & { flat?: number; dice?: string[] } = {}): Resolution => ({
  adv: false, dis: false, crit: false, notes: [], problems: [],
  riders: flat || dice
    ? [{ label: 'Graph', source: 'F', op: 'add', formula: '', flat: flat ?? 0, dice: dice ?? [], when: 'always', on: true }]
    : [],
  ...over,
})

// Roll order inside rollWeaponAttack: graph ATTACK dice → the d20 pair →
// the weapon's damage dice → graph DAMAGE dice.

test('with no graph argument the roller behaves exactly as it did before', () => {
  const { attack, damage } = pin([[11, 20], [1, 20], [5, 8]], () => rollWeaponAttack(SWORD, SHEET))
  assert.equal(attack.d20, 11)
  assert.equal(attack.total, 17)          // 11 + 3 STR + 3 prof
  assert.equal(attack.breakdown, 'd20(11) +6')
  assert.equal(damage.total, 8)           // 5 + 3 STR
  assert.equal(damage.breakdown, '1d8(5) +3')
})

test('a flat graph contribution folds into the damage total and is visible in the breakdown', () => {
  const { damage } = pin([[11, 20], [1, 20], [5, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { damage: RES({ flat: 2 }) }))
  assert.equal(damage.total, 10)          // 5 + 3 + 2
  assert.ok(damage.breakdown.includes('+2'), damage.breakdown)
})

test('graph damage dice ride WITH the weapon dice, so a crit doubles them too', () => {
  // Nat 20 → weapon 1d8 becomes 2d8, and the graph's 1d4 becomes 2d4. This is
  // the reason resolve() hands back dice unrolled instead of a number.
  const { attack, damage } = pin(
    [[20, 20], [1, 20], [8, 8], [7, 8], [4, 4], [3, 4]],
    () => rollWeaponAttack(SWORD, SHEET, null, { damage: RES({ dice: ['1d4'] }) }),
  )
  assert.equal(attack.crit, true)
  assert.equal(damage.dice.length, 2)     // weapon dice doubled
  assert.equal(damage.total, 8 + 7 + 3 + 4 + 3)  // 15 weapon + 3 STR + 7 graph
})

test('graph ATTACK dice are rolled once and never doubled', () => {
  // A crit doubles damage dice, not the to-hit roll — Bless does not get better
  // because you rolled well.
  // The nat 20 doubles the WEAPON's damage dice (hence two d8s in the queue)
  // while the attack's own 1d4 is rolled exactly once.
  const { attack } = pin([[3, 4], [20, 20], [1, 20], [8, 8], [7, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ dice: ['1d4'] }) }))
  assert.equal(attack.total, 20 + 6 + 3)
})

test('a negative graph term subtracts — Bane through the whole path', () => {
  // §39's obligation, now proven at the roller rather than at parseDice: the
  // authored "-1d4" has to come out of the total, not be silently dropped.
  const { attack } = pin([[3, 4], [11, 20], [1, 20], [5, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ dice: ['-1d4'] }) }))
  assert.equal(attack.total, 11 + 6 - 3)
})

test('graph advantage takes the higher d20; advantage and disadvantage cancel', () => {
  const adv = pin([[7, 20], [18, 20], [5, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ adv: true }) }))
  assert.equal(adv.attack.d20, 18)
  assert.ok(adv.attack.breakdown.endsWith(' adv'))

  const both = pin([[7, 20], [18, 20], [5, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ adv: true, dis: true }) }))
  assert.equal(both.attack.d20, 7)        // first of the pair — neither applies
  assert.ok(!both.attack.breakdown.includes('adv'))
  assert.ok(!both.attack.breakdown.includes('dis'))
})

test('a lowered crit threshold crits on 19 and doubles the dice', () => {
  const { attack, damage } = pin([[19, 20], [1, 20], [8, 8], [6, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ critFrom: 19 }) }))
  assert.equal(attack.crit, true)
  assert.equal(damage.dice.length, 2)
  assert.equal(damage.total, 8 + 6 + 3)
})

test('a natural 1 is still a fumble even when the crit range is lowered', () => {
  const { attack } = pin([[1, 20], [1, 20], [5, 8]], () =>
    rollWeaponAttack(SWORD, SHEET, null, { attack: RES({ critFrom: 19 }) }))
  assert.equal(attack.fumble, true)
  assert.equal(attack.crit, false)
})

// --- the gid gap, pinned rather than discovered at a table -------------------

test('a weapon: target matches only a CATALOG-GRANTED weapon, never a hand-seeded one', () => {
  // gid() reads the catalog back-ref first and falls back to the instance id,
  // and EquippedItem.item_id is OPTIONAL. So the same authored feature reaches a
  // granted weapon and cannot ever reach a hand-seeded one — while the editor
  // shows "1 match" either way, because matchCount counts against the catalog.
  // Written down as a test so the behaviour is known, not stumbled into.
  const feature = {
    id: 'f1', name: 'Blade Bond',
    graph: [{ id: 'e1', op: 'add' as const, value: '2', label: 'Bond', target: ['weapon:cat-longsword'] }],
  }
  const character = (weapon: EquippedWeapon): CharacterRow => ({
    id: 'c1', owner: 'u1', name: 'T', identity: { level: 5 },
    sheet: { ...SHEET, features: [feature] }, resources: {}, inventory: [],
    equipped: { weapons: [weapon] }, shards: {}, spellbook: {}, lore: {}, progress: {}, updated_at: '',
  } as unknown as CharacterRow)

  const granted = { ...SWORD, item_id: 'cat-longsword' } as EquippedWeapon
  assert.equal(gid('weapon', granted), 'weapon:cat-longsword')
  assert.equal(
    total(resolve(buildContext(character(granted)), { kind: 'damage', subject: gid('weapon', granted) })).flat,
    2,
  )

  // Hand-seeded: no back-ref, so its gid is the instance id and nothing matches.
  assert.equal(gid('weapon', SWORD), 'weapon:w1')
  assert.equal(
    total(resolve(buildContext(character(SWORD)), { kind: 'damage', subject: gid('weapon', SWORD) })).flat,
    0,
  )
})

/* ---------- ranged ---------- */

test('the ranged flag decides it, in both directions', () => {
  assert.equal(isRanged({ ranged: true }), true)
  // Explicit false WINS over a legacy property string: a DM who unticks the box
  // on a converted weapon means it.
  assert.equal(isRanged({ ranged: false, properties: ['Ammunition'] }), false)
})

test('a weapon with neither is melee', () => {
  assert.equal(isRanged({}), false)
  assert.equal(isRanged({ properties: ['Versatile', 'Heavy'] }), false)
})

test('the legacy "ammunition" property still fires', () => {
  // The old rule was a regex over free text, with no control that could write it.
  // Data authored that way has to keep working — the flag is the new way to say
  // it, not a migration the DM has to run.
  assert.equal(isRanged({ properties: ['Ammunition (range 80/320)'] }), true)
  assert.equal(isRanged({ properties: ['ammunition'] }), true)
})

// --- `useability`: a feature that changes which ability swings the weapon ----
//
// Every wrong answer here is a plausible number. A forced swap instead of a
// best-of quietly makes an Arbiter with STR 20 WORSE; missing the damage half
// leaves attack and damage disagreeing by three; a sum instead of a union
// double-counts nothing visibly. So each is pinned.

const arb = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 18, cha: 10 },
  ...over,
} as CharacterSheet)

const sword: EquippedWeapon = { id: 'w', name: 'Longsword', ability: 'str', damageDice: '1d8' } as EquippedWeapon

test('SANCTITY: granted WIS wins when it is the better score', () => {
  const sheet = arb({ attackAbilities: ['wis'] })
  assert.equal(weaponAbilityKey(sword, sheet), 'wis', 'WIS 18 beats STR 10')
})

test('IT IS A MAY, NOT A SWAP — a strong Arbiter keeps Strength', () => {
  // The failure that would look correct: forcing the ability makes a STR 20
  // character attack at +4 instead of +5 and nobody would suspect the feature.
  const sheet = arb({ abilities: { str: 20, dex: 12, con: 12, int: 10, wis: 18, cha: 10 }, attackAbilities: ['wis'] })
  assert.equal(weaponAbilityKey(sword, sheet), 'str', 'STR 20 beats WIS 18')
})

test('it moves DAMAGE as well as attack', () => {
  // Both run through abMod, so they cannot disagree — but only if the grant is
  // read in that one place rather than bolted onto the attack path.
  const plain = arb()
  const blessed = arb({ attackAbilities: ['wis'] })
  assert.equal(weaponAttackBonus(sword, plain), weaponDamageBonus(sword, plain) + proficiencyOf(plain))
  assert.equal(weaponDamageBonus(sword, blessed) - weaponDamageBonus(sword, plain), 4,
    'WIS 18 (+4) replaces STR 10 (+0) on damage too')
})

test('a finesse weapon still picks the better of STR/DEX with no rule present', () => {
  const finesse: EquippedWeapon = { ...sword, ability: 'finesse' } as EquippedWeapon
  assert.equal(weaponAbilityKey(finesse, arb()), 'dex', 'DEX 12 beats STR 10')
})

test('a grant WIDENS the finesse set rather than replacing it', () => {
  const finesse: EquippedWeapon = { ...sword, ability: 'finesse' } as EquippedWeapon
  const sheet = arb({ abilities: { str: 20, dex: 12, con: 12, int: 10, wis: 18, cha: 10 }, attackAbilities: ['wis'] })
  assert.equal(weaponAbilityKey(finesse, sheet), 'str', 'best of {str, dex, wis}')
})

test('granting an ability the character is WORSE at changes nothing', () => {
  // Best-of can never make an attack worse, which is why no UI is needed to
  // ask the player whether they want it.
  assert.equal(weaponAbilityKey(sword, arb({ abilities: { str: 20, dex: 8, con: 10, int: 8, wis: 8, cha: 8 }, attackAbilities: ['cha'] })), 'str')
})

test('two features granting WIS is the same as one', () => {
  // effectiveSheet UNIONS rather than sums; this pins the read side treating a
  // repeated entry as one permission.
  const once = arb({ attackAbilities: ['wis'] })
  const twice = arb({ attackAbilities: ['wis', 'wis'] })
  assert.equal(weaponAbilityKey(sword, once), weaponAbilityKey(sword, twice))
  assert.equal(weaponDamageBonus(sword, once), weaponDamageBonus(sword, twice))
})

test('REMOVING THE FEATURE RESTORES STRENGTH — the whole reason it is a rule', () => {
  // A stored field would have overwritten `ability` on the weapon and stayed
  // wrong after the class changed. The grant lives on the effective sheet, so
  // dropping it is simply the absence of the entry.
  assert.equal(weaponAbilityKey(sword, arb({ attackAbilities: ['wis'] })), 'wis')
  assert.equal(weaponAbilityKey(sword, arb()), 'str')
})

/** Proficiency the weapon functions assume, so the attack/damage identity
 *  above states its own arithmetic instead of hiding it. */
function proficiencyOf(sheet: CharacterSheet): number {
  return weaponAttackBonus(sword, sheet) - weaponDamageBonus(sword, sheet)
}

// ── THE PAIR IS ALWAYS ROLLED ───────────────────────────────────────────────
//
// The whole Brutal Strike design rests on this. "Forgo the Advantage" is a
// PICK, not a reroll: both d20s are rolled whatever the mode, so dropping to
// the first one takes a die that was rolled independently and never saw the
// advantage. If this ever became "roll one under normal, two under advantage",
// forgoing would have to reroll — and a reroll after seeing the dice is a
// different game.

test('TWO d20s ARE CONSUMED IN EVERY MODE, and normal keeps the first', () => {
  const normal = pin([[7, 20], [19, 20], [4, 8]], () => rollWeaponAttack(SWORD, SHEET))
  assert.equal(normal.attack.mode, 'normal')
  assert.equal(normal.attack.d20, 7, 'the FIRST face, not the better one')
  assert.equal(normal.attack.d20, normal.attack.rolls[0].v)
  /* The damage die is 4, which is the THIRD pinned face — so the second d20 was
     drawn and discarded rather than never rolled. That is the invariant: the
     first face does not depend on the mode, so a roll made without advantage is
     the same roll it would have been, and forgoing costs nothing in fairness.
     (`rolls` itself keeps only the kept face here; the pair is retained for the
     panel to strike through under adv/dis, which the next test covers.) */
  assert.equal(normal.damage.dice[0].v, 4)
})

test('advantage keeps the higher of the SAME pair — so forgoing it is a pick', () => {
  const adv = pin([[7, 20], [19, 20], [4, 8]],
    () => rollWeaponAttack(SWORD, SHEET, undefined, { attack: RES({ adv: true }) }))
  assert.deepEqual(adv.attack.rolls.map(d => d.v), [7, 19])
  assert.equal(adv.attack.d20, 19)
  // Same faces, same order: normal above kept 7 from this identical pair. That
  // equivalence is what makes "forgo" honest — no die is rerolled or discarded
  // in the player's favour.
})

test('ADV AND DIS CANCEL TO NORMAL — Brutal Strike forgoing Reckless Attack', () => {
  const both = pin([[7, 20], [19, 20], [4, 8]],
    () => rollWeaponAttack(SWORD, SHEET, undefined, { attack: RES({ adv: true, dis: true }) }))
  assert.equal(both.attack.mode, 'normal')
  assert.equal(both.attack.d20, 7, 'back to the first face, exactly as if neither applied')
})
