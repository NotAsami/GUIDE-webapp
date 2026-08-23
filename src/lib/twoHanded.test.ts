// Run: node --test src/lib/twoHanded.test.ts
//
// "You cannot dual-wield claymores." The rule lives in three places that must
// agree — the Equipment slot, the inventory popup, and the write — so it is one
// predicate (`offHandBlockedBy`) and one refusal (`equipWeaponPatch` returning
// null). These pin both, plus the fallback that keeps 454 imported weapons
// working without a migration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EquippedGear, EquippedWeapon, InventoryItem } from './database.types.ts'
import { equipWeaponPatch, getWeapons, isTwoHanded, offHandBlockedBy } from './equip.ts'

const weapon = (over: Partial<EquippedWeapon>): EquippedWeapon => ({
  id: over.id ?? 'w1', name: 'Blade', w: 1, h: 2, category: 'weapon', ...over,
} as EquippedWeapon)

const carried = (over: Partial<InventoryItem>): InventoryItem => ({
  id: over.id ?? 'i1', name: 'Blade', w: 1, h: 2, category: 'weapon',
  containerId: 'person', col: 1, row: 1, ...over,
} as InventoryItem)

const gearWith = (...ws: EquippedWeapon[]): EquippedGear => ({ weapons: ws } as EquippedGear)

// ── the predicate ───────────────────────────────────────────────────────────

test('the explicit flag wins over the free-text list', () => {
  assert.equal(isTwoHanded({ twoHanded: true, properties: [] }), true)
  assert.equal(isTwoHanded({ twoHanded: false, properties: ['Two-Handed'] }), false)
})

test('IMPORTED DATA STILL WORKS — the properties fallback reads the SRD string', () => {
  // 454 of 493 catalog weapons carry this and no `twoHanded` flag.
  assert.equal(isTwoHanded({ properties: ['Heavy', 'Two-Handed'] }), true)
  assert.equal(isTwoHanded({ properties: ['two handed'] }), true)
  assert.equal(isTwoHanded({ properties: ['Finesse', 'Light'] }), false)
  assert.equal(isTwoHanded({}), false)
})

test('VERSATILE IS NOT TWO-HANDED — it would lock the off hand on half the martials', () => {
  // A longsword may be swung in two hands; it does not forbid a shield.
  assert.equal(isTwoHanded({ properties: ['Sap', 'Versatile'] }), false)
})

test('offHandBlockedBy names the offending weapon, or nothing', () => {
  assert.equal(offHandBlockedBy(gearWith()), null)
  assert.equal(offHandBlockedBy(gearWith(weapon({ hand: 'main', name: 'Longsword' }))), null)
  const maul = weapon({ hand: 'main', name: 'Maul', twoHanded: true })
  assert.equal(offHandBlockedBy(gearWith(maul))?.name, 'Maul')
  // Only the MAIN hand can block; a stray off-hand two-hander is not the rule.
  assert.equal(offHandBlockedBy(gearWith(weapon({ hand: 'off', twoHanded: true }))), null)
})

// ── the write ───────────────────────────────────────────────────────────────

test('equipping a two-hander to MAIN displaces the off hand to the bag', () => {
  const gear = gearWith(weapon({ id: 'shield-ish', hand: 'off', name: 'Shortbow' }))
  const p = equipWeaponPatch(carried({ id: 'maul', name: 'Maul', twoHanded: true }), 'main', gear, [])
  assert.ok(p, 'main hand always accepts')
  const ws = getWeapons(p!.equipped as EquippedGear)
  assert.deepEqual(ws.map(w => w.name), ['Maul'], 'the off-hand weapon must come off')
  assert.equal((p!.inventory as InventoryItem[]).some(i => i.name === 'Shortbow'), true, 'and land in the bag')
})

test('the off hand REFUSES while a two-hander is held', () => {
  const gear = gearWith(weapon({ hand: 'main', name: 'Maul', twoHanded: true }))
  const p = equipWeaponPatch(carried({ id: 'dag', name: 'Dagger' }), 'off', gear, [])
  assert.equal(p, null, 'a refusal, not a state the rules forbid')
})

test('a two-hander cannot go in the off hand even with the main hand free', () => {
  const p = equipWeaponPatch(carried({ id: 'maul', name: 'Maul', twoHanded: true }), 'off', gearWith(), [])
  assert.equal(p, null)
})

test('nothing changes for one-handed weapons — the old behaviour is intact', () => {
  const gear = gearWith(weapon({ id: 'a', hand: 'main', name: 'Longsword' }))
  const p = equipWeaponPatch(carried({ id: 'b', name: 'Dagger' }), 'off', gear, [])
  assert.ok(p)
  const ws = getWeapons(p!.equipped as EquippedGear)
  assert.deepEqual(ws.map(w => w.name).sort(), ['Dagger', 'Longsword'], 'both hands stay filled')
})

test('one hand still holds one weapon — the same hand displaces as before', () => {
  const gear = gearWith(weapon({ id: 'a', hand: 'main', name: 'Longsword' }))
  const p = equipWeaponPatch(carried({ id: 'b', name: 'Rapier' }), 'main', gear, [])
  const ws = getWeapons(p!.equipped as EquippedGear)
  assert.deepEqual(ws.map(w => w.name), ['Rapier'])
  assert.equal((p!.inventory as InventoryItem[]).some(i => i.name === 'Longsword'), true)
})

test('a two-hander replacing a two-hander leaves exactly one weapon', () => {
  const gear = gearWith(weapon({ id: 'a', hand: 'main', name: 'Maul', twoHanded: true }))
  const p = equipWeaponPatch(carried({ id: 'b', name: 'Greatsword', twoHanded: true }), 'main', gear, [])
  const ws = getWeapons(p!.equipped as EquippedGear)
  assert.deepEqual(ws.map(w => w.name), ['Greatsword'])
})
