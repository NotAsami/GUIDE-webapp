import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const PLAYER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DM = '33333333-3333-4333-8333-333333333333'
const CHAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_CHAR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('private images follow record access and resist forged portrait references', async t => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public, storage to authenticated, anon;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant select, insert, update, delete on storage.objects to authenticated, anon;
      create table quests(id uuid primary key);
    `)
    for (const migration of ['0001_init', '0023_handouts', '0024_npcs', '0029_image_uploads']) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${migration}.sql`, import.meta.url), 'utf8')
        .replace(/^create extension if not exists pgcrypto;$/m, '')
        .replace(/^alter publication supabase_realtime add table \w+;$/gm, '')
      await db.exec(sql)
    }
    await db.exec(`
      grant select, update on characters to authenticated;
      grant select on dm_users, npcs, handouts to authenticated;
      insert into auth.users values ('${PLAYER}'), ('${OTHER}'), ('${DM}');
      insert into dm_users values ('${DM}');
      insert into characters(id, owner, name, identity) values
        ('${CHAR}', '${PLAYER}', 'Player', '{"portrait":"storage:guide-images/characters/${CHAR}/face.webp"}'),
        ('${OTHER_CHAR}', '${OTHER}', 'Other', '{"portrait":"storage:guide-images/characters/${OTHER_CHAR}/face.webp"}');
      insert into npcs(name, portrait, known_to) values
        ('Known', 'storage:guide-images/npcs/known.webp', array['${CHAR}']::uuid[]),
        ('Secret', 'storage:guide-images/npcs/secret.webp', '{}');
      insert into handouts(title, image_url, recipients) values
        ('Held', 'storage:guide-images/handouts/held.webp', array['${CHAR}']::uuid[]),
        ('Draft', 'storage:guide-images/handouts/draft.webp', '{}');
      insert into storage.objects(bucket_id, name) values
        ('guide-images', 'characters/${CHAR}/face.webp'),
        ('guide-images', 'characters/${OTHER_CHAR}/face.webp'),
        ('guide-images', 'npcs/known.webp'), ('guide-images', 'npcs/secret.webp'),
        ('guide-images', 'handouts/held.webp'), ('guide-images', 'handouts/draft.webp'),
        ('guide-images', 'handouts/orphan.webp'), ('other-bucket', 'npcs/known.webp');
    `)
    const as = async (user: string, fn: () => Promise<void>, role = 'authenticated') => {
      await db.exec('begin')
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user])
        await db.exec(`set local role ${role}`)
        await fn()
      } finally { await db.exec('rollback') }
    }
    const names = async () => (await db.query<{ name: string }>('select name from storage.objects order by name')).rows.map(r => r.name)
    await t.test('DM reads drafts and uploads; other buckets remain protected', () => as(DM, async () => {
      assert.equal((await names()).length, 7)
      await db.exec("insert into storage.objects(bucket_id,name) values ('guide-images','npcs/new.webp')")
      assert.equal((await names()).length, 8)
    }))
    await t.test('player sees own portrait, known NPC, and delivered handout only', () => as(PLAYER, async () => {
      assert.deepEqual(await names(), [`characters/${CHAR}/face.webp`, 'handouts/held.webp', 'npcs/known.webp'])
    }))
    await t.test('other players do not inherit the first player’s reveals', () => as(OTHER, async () => {
      assert.deepEqual(await names(), [`characters/${OTHER_CHAR}/face.webp`])
    }))
    await t.test('copying a secret reference into an owned character does not authorize it', async () => {
      for (const path of ['npcs/secret.webp', 'handouts/draft.webp', `characters/${OTHER_CHAR}/face.webp`]) {
        await as(PLAYER, async () => {
          await db.query("update characters set identity=jsonb_build_object('portrait',$1::text) where id=$2", ['storage:guide-images/' + path, CHAR])
          assert.ok(!(await names()).includes(path))
        })
      }
    })
    await t.test('revoking recipients blocks new reads', async () => {
      await db.exec('begin')
      try {
        await db.exec("update handouts set recipients='{}'; update npcs set known_to='{}'")
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [PLAYER])
        await db.exec('set local role authenticated')
        assert.deepEqual(await names(), [`characters/${CHAR}/face.webp`])
      } finally { await db.exec('rollback') }
    })
    await t.test('player cannot upload, overwrite, or delete images', () => as(PLAYER, async () => {
      assert.equal((await db.query('delete from storage.objects returning *')).rows.length, 0)
      assert.equal((await db.query("update storage.objects set name='changed' returning *")).rows.length, 0)
      await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('guide-images','handouts/forged.webp')"), /row-level security/)
    }))
    await t.test('anonymous users have no image access', () => as('', async () => {
      assert.deepEqual(await names(), [])
    }, 'anon'))
  } finally { await db.close() }
})
