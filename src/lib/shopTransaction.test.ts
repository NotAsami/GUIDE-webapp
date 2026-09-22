import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const CHAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('purchase transactions against PostgreSQL', async t => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
    `)
    for (const migration of ['0001_init', '0009_shop_catalog', '0012_shop_price_unit', '0025_reliable_writes']) {
      // PGlite has gen_random_uuid built in; logical replication isn't needed
      // for transactional tests. All tables, policies and functions run as-is.
      const sql = readFileSync(new URL(`../../supabase/migrations/${migration}.sql`, import.meta.url), 'utf8')
        .replace(/^create extension if not exists pgcrypto;$/m, '')
        .replace(/^alter publication supabase_realtime add table \w+;$/gm, '')
      await db.exec(sql)
    }
    await db.exec(`
      grant select, update on characters to authenticated;
      grant select on dm_users, shop_catalog to authenticated;
      insert into auth.users values ('${OWNER}'), ('${OTHER}');
      insert into characters(id, owner, name, sheet) values
        ('${CHAR}', '${OWNER}', 'Test', '{"coins":{"gold":10,"silver":0,"copper":0}}');
      insert into shop_catalog(id, is_open, data) values ('shop', true,
        '{"stock":[{"item_id":"potion","item":{"name":"Potion","category":"consumable"},"price":2,"unit":"gp","mode":"limited","qty":3}]}');
      select set_config('request.jwt.claim.sub', '${OWNER}', false);
    `)
    const snapshot = async () => {
      const c = await db.query<{ stamp: string; sheet: any; inventory: any }>('select updated_at::text as stamp, sheet, inventory from characters where id=$1', [CHAR])
      const s = await db.query<{ stamp: string; data: any }>("select updated_at::text as stamp, data from shop_catalog where id='shop'")
      return { character: c.rows[0], shop: s.rows[0] }
    }
    const buy = async (opts: { request?: string; stamp?: string; character?: string; destination?: object; item?: string } = {}) => {
      const state = await snapshot()
      const res = await db.query<{ result: any }>('select shop_purchase($1,$2,$3,$4,$5,$6,$7) as result',
        ['shop', opts.item ?? 'potion', opts.request ?? REQUEST, opts.character ?? CHAR,
          opts.stamp ?? state.character.stamp, state.shop.stamp, JSON.stringify(opts.destination ?? { containerId: 'person', col: 1, row: 1 })])
      return res.rows[0].result
    }
    const run = async (name: string, fn: () => Promise<void>) => {
      await t.test(name, async () => { await db.exec('begin'); try { await fn() } finally { await db.exec('rollback') } })
    }
    await run('payment, stock and canonical inventory item commit together', async () => {
      await db.exec('set local role authenticated')
      assert.equal((await buy()).ok, true)
      const state = await snapshot()
      assert.equal(state.character.sheet.coins.gold, 8)
      assert.equal(state.shop.data.stock[0].qty, 2)
      assert.equal(state.character.inventory.length, 1)
      assert.equal(state.character.inventory[0].name, 'Potion')
      assert.equal(state.character.inventory[0].qty, 1)
    })
    await run('a repeated request after closure returns the receipt without charging twice', async () => {
      const first = await buy()
      await db.exec("update shop_catalog set is_open=false where id='shop'")
      assert.deepEqual(await buy(), first)
      const state = await snapshot()
      assert.equal(state.character.sheet.coins.gold, 8)
      assert.equal(state.character.inventory.length, 1)
      assert.equal(state.shop.data.stock[0].qty, 2)
    })
    await run('inventory failure rolls back payment, stock and receipt', async () => {
      await db.exec(`create function reject_delivery() returns trigger language plpgsql as $$ begin
        if new.inventory is distinct from old.inventory then raise exception 'delivery failed'; end if;
        return new; end $$;
        create trigger reject_delivery before update on characters for each row execute function reject_delivery();`)
      // An exception aborts the transaction, so use a savepoint for inspection.
      await db.exec('savepoint attempt')
      await assert.rejects(buy(), /delivery failed/)
      await db.exec('rollback to savepoint attempt')
      const state = await snapshot()
      assert.equal(state.character.sheet.coins.gold, 10)
      assert.equal(state.shop.data.stock[0].qty, 3)
      assert.equal(state.character.inventory.length, 0)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from shop_purchase_receipts')).rows[0].n, 0)
    })
    await run('stale placement version is rejected before payment', async () => {
      const old = await snapshot()
      await db.exec("update characters set inventory='[{\"name\":\"Gift\"}]' where id='" + CHAR + "'")
      assert.equal((await buy({ stamp: old.character.stamp })).reason, 'conflict')
      assert.equal((await snapshot()).character.sheet.coins.gold, 10)
    })
    await run('stackable items merge into their existing unlocked destination', async () => {
      await db.exec(`update characters set inventory='[{"id":"stack","name":"Potion","category":"consumable","containerId":"person","qty":3}]'`)
      assert.equal((await buy()).ok, true)
      assert.equal((await snapshot()).character.inventory[0].qty, 4)
    })
    await run('insufficient funds leave inventory and stock unchanged', async () => {
      await db.exec(`update characters set sheet='{"coins":{"gold":0}}'`)
      assert.equal((await buy()).reason, 'insufficient')
      assert.equal((await snapshot()).shop.data.stock[0].qty, 3)
    })
    await run('invalid destinations and foreign characters cannot charge the owner', async () => {
      assert.equal((await buy({ destination: { containerId: 'someone-elses-bag' } })).reason, 'invalid_request')
      await db.exec(`select set_config('request.jwt.claim.sub', '${OTHER}', true)`)
      assert.equal((await buy()).reason, 'no_character')
    })
    await run('legacy debit-only RPC and receipt writes are denied to players', async () => {
      const permissions = await db.query<{ legacy: boolean; receipt: boolean }>(`select
        has_function_privilege('authenticated','shop_buy(text,text)','execute') as legacy,
        has_table_privilege('authenticated','shop_purchase_receipts','insert') as receipt`)
      assert.deepEqual(permissions.rows[0], { legacy: false, receipt: false })
    })
    await run('updated_at advances for multiple writes within one transaction', async () => {
      const first = (await snapshot()).character.stamp
      await db.exec(`update characters set name='Another' where id='${CHAR}'`)
      const second = (await snapshot()).character.stamp
      await db.exec(`update characters set name='Again' where id='${CHAR}'`)
      const third = (await snapshot()).character.stamp
      assert.notEqual(first, second)
      assert.notEqual(second, third)
      const stale = await db.query('update characters set name=$1 where id=$2 and updated_at=$3 returning id', ['Stale', CHAR, second])
      assert.equal(stale.rows.length, 0)
    })
  } finally { await db.close() }
})
