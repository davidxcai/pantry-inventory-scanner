import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const alice = '00000000-0000-0000-0000-000000000001'
const bob = '00000000-0000-0000-0000-000000000002'
const product = '10000000-0000-0000-0000-000000000001'
const hidden = '10000000-0000-0000-0000-000000000002'
let db: PGlite

async function signIn(id: string, email = 'student@mavs.uta.edu') {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id, JSON.stringify({ email })])
}
const save = (owner = alice, id = product) => db.query(
  'insert into public.watchlist_items (user_id, item_id) values ($1, $2) on conflict (user_id, item_id) do nothing', [owner, id],
)
const entries = () => db.query<{ item_id: string }>('select item_id from public.watchlist_items')

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    grant usage on schema auth to anon, authenticated;
    create table public.items (
      id uuid primary key,
      categories text[] not null,
      status text not null default 'out',
      status_updated_at timestamptz
    );
    create view public.available_items as
      select id, status as availability from public.items where not ('other' = any(categories));
    grant select on public.available_items to anon, authenticated;
  `)
  const emailMigration = readFileSync('supabase/migrations/20261012000000_crowdsourced_status.sql', 'utf8')
  const userMigration = readFileSync('supabase/migrations/20261015000000_remove_staff.sql', 'utf8')
  await db.exec(emailMigration.match(/create function public\.is_uta_email\([\s\S]+?\$\$;/i)![0])
  await db.exec(userMigration.match(/create function public\.is_uta_user\([\s\S]+?\$\$;/i)![0])
  // Execute the real migration, with real PostgreSQL roles and row-level policies.
  await db.exec(readFileSync('supabase/migrations/20261024000000_personal_watchlist.sql', 'utf8'))
}, 30_000)

beforeEach(async () => {
  await db.exec('reset role; truncate auth.users, public.items cascade;')
  await db.query('insert into auth.users (id) values ($1), ($2)', [alice, bob])
  await db.query("insert into public.items (id, categories) values ($1, array['snacks']), ($2, array['other'])", [product, hidden])
})

afterAll(async () => { await db?.close() })

describe('saved-products migration and account privacy', () => {
  it('persists an owner’s saved product across sessions without duplicate entries', async () => {
    await signIn(alice)
    await save()
    await save()
    await signIn(bob)
    expect((await entries()).rows).toEqual([])
    await signIn(alice)
    expect((await entries()).rows).toEqual([{ item_id: product }])
  })

  it('allows independent lists and prevents removing another account’s entries', async () => {
    await signIn(alice)
    await save()
    await signIn(bob)
    await save(bob)
    await db.query('delete from public.watchlist_items where user_id = $1', [alice])
    await signIn(alice)
    expect((await entries()).rows).toHaveLength(1)
    await db.query('delete from public.watchlist_items where item_id = $1', [product])
    expect((await entries()).rows).toHaveLength(0)
    await signIn(bob)
    expect((await entries()).rows).toHaveLength(1)
  })

  it('rejects a forged owner even when ON CONFLICT would ignore an existing entry', async () => {
    await signIn(alice)
    await save()
    await signIn(bob)
    await expect(save(alice)).rejects.toMatchObject({ code: '42501' })
  })

  it('denies anonymous and non-UTA access', async () => {
    await db.exec('set role anon')
    await expect(entries()).rejects.toMatchObject({ code: '42501' })
    await expect(save()).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('delete from public.watchlist_items')).rejects.toMatchObject({ code: '42501' })
    await signIn(alice, 'student@example.com')
    await expect(save()).rejects.toMatchObject({ code: '42501' })
    expect((await entries()).rows).toHaveLength(0)
  })

  it('rejects hidden and nonexistent products but allows saving out-of-stock products', async () => {
    await signIn(alice)
    await expect(save(alice, hidden)).rejects.toMatchObject({ code: '42501' })
    await expect(save(alice, '10000000-0000-0000-0000-000000000099')).rejects.toBeDefined()
    await save()
    expect((await entries()).rows).toHaveLength(1)
  })

  it('does not change inventory and reads current availability after a later stock report', async () => {
    await signIn(alice)
    await save()
    await db.exec('reset role')
    expect((await db.query('select status, status_updated_at from public.items where id = $1', [product])).rows).toEqual([{ status: 'out', status_updated_at: null }])
    await db.query("update public.items set status = 'in_stock' where id = $1", [product])
    await signIn(alice)
    const current = await db.query('select i.availability from public.watchlist_items w join public.available_items i on i.id = w.item_id')
    expect(current.rows).toEqual([{ availability: 'in_stock' }])
    await expect(db.query('update public.watchlist_items set user_id = $1', [bob])).rejects.toMatchObject({ code: '42501' })
  })

  it('lets the owner remove a saved product after it becomes unlisted', async () => {
    await signIn(alice)
    await save()
    await db.exec('reset role')
    await db.query("update public.items set categories = array['other'] where id = $1", [product])
    await signIn(alice)
    expect((await entries()).rows).toHaveLength(1)
    expect((await db.query('select * from public.available_items')).rows).toHaveLength(0)
    await db.query('delete from public.watchlist_items where item_id = $1', [product])
    expect((await entries()).rows).toHaveLength(0)
  })

  it('cleans up saved entries when their product or owner is deleted', async () => {
    await signIn(alice)
    await save()
    await db.exec('reset role')
    await db.query('delete from public.items where id = $1', [product])
    expect((await entries()).rows).toHaveLength(0)
    await db.query("insert into public.items (id, categories) values ($1, array['snacks'])", [product])
    await signIn(alice)
    await save()
    await db.exec('reset role')
    await db.query('delete from auth.users where id = $1', [alice])
    expect((await entries()).rows).toHaveLength(0)
  })
})
