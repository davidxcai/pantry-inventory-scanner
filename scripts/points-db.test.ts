import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { PointsSummary } from '../shared/inventoryPoints'

const alice = '00000000-0000-0000-0000-000000000001'
const bob = '00000000-0000-0000-0000-000000000002'
const existing = '10000000-0000-0000-0000-000000000001'
const base = readFileSync('supabase/migrations/20261015000000_remove_staff.sql', 'utf8')
const email = readFileSync('supabase/migrations/20261012000000_crowdsourced_status.sql', 'utf8')
const gate = readFileSync('supabase/migrations/20261015020000_pantry_gate.sql', 'utf8')
const shelf = readFileSync('supabase/migrations/20261016000000_shelf_scans.sql', 'utf8')
const definition = (source: string, name: string) => source.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?\\$\\$;`, 'i'))![0]
let db: PGlite
let originalCheckIn: string

async function signIn(id = alice, address = 'student@mavs.uta.edu') {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [id, JSON.stringify({ email: address })])
}
async function asAdmin() { await db.exec('reset role;') }
const summary = async () => (await db.query<{ summary: PointsSummary }>('select public.get_inventory_points() as summary')).rows[0].summary
const item = async (name = 'Barilla Spaghetti', brand: string | null = 'Barilla') => (await db.query<{ id: string }>('insert into public.items (name, brand, categories) values ($1, $2, array[\'pasta_grains_rice\']) returning id', [name, brand])).rows[0].id
const job = async (status = 'queued') => (await db.query<{ id: string }>('insert into public.intake_jobs (created_by, status) values ($1, $2) returning id', [alice, status])).rows[0].id
const status = (id = existing, value = 'low') => db.query('select public.set_item_status($1, $2)', [id, value])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    create table public.categories (slug text primary key);
    insert into public.categories values ('pasta_grains_rice'), ('other');
    create table public.items (
      id uuid primary key default gen_random_uuid(), name text not null, brand text, size text, categories text[],
      thumbnail_path text, created_by uuid, created_at timestamptz default now(), status text default 'out',
      status_updated_at timestamptz, status_updated_by uuid, status_verified boolean default false
    );
    create table public.item_status_log (
      id uuid primary key default gen_random_uuid(), item_id uuid references public.items(id) on delete cascade,
      status text, user_id uuid references auth.users(id) on delete set null, created_at timestamptz default now(), kind text default 'report'
    );
    create table public.intake_jobs (
      id uuid primary key default gen_random_uuid(), created_by uuid, item_id uuid references public.items(id),
      availability text default 'in_stock', status text default 'queued', photo_path text default 'photo.jpg', model_used text, error text
    );
    create table public.item_images (item_id uuid, storage_path text, source text);
  `)
  await db.exec(definition(email, 'is_uta_email'))
  for (const name of ['is_uta_user', 'lock_job', 'apply_item_status', 'resolve_job_new', 'resolve_job_existing', 'confirm_job']) await db.exec(definition(base, name))
  await db.exec('revoke all on function public.lock_job(uuid), public.apply_item_status(uuid, text, uuid) from public, anon, authenticated;')
  await db.exec(gate)
  await db.exec(shelf.match(/create table public\.shelf_scans[\s\S]+?\n\);/)![0])
  await db.exec(definition(shelf, 'confirm_shelf_scan'))
  originalCheckIn = (await db.query<{ definition: string }>("select pg_get_functiondef('public.check_in(text)'::regprocedure) as definition")).rows[0].definition
  await db.exec(readFileSync('supabase/migrations/20261028000000_inventory_points.sql', 'utf8'))
}, 30_000)
beforeEach(async () => {
  await asAdmin()
  await db.exec('truncate auth.users, public.items, public.intake_jobs, public.item_images, public.shelf_scans cascade;')
  await db.query('insert into auth.users values ($1), ($2)', [alice, bob])
  await db.query("insert into public.items (id, name, brand, categories) values ($1, 'Barilla Spaghetti', 'Barilla', array['pasta_grains_rice'])", [existing])
  await signIn()
})
afterAll(async () => { await db?.close() })

it('awards automatically after a successful inventory report and saves points across sessions', async () => {
  expect((await summary()).balance).toBe(0)
  await status()
  expect((await summary()).balance).toBe(1)
  await signIn(bob)
  expect((await summary()).balance).toBe(0)
  await signIn()
  expect((await summary()).balance).toBe(1)
  expect((await summary()).recent_updates[0].item_name).toBe('Barilla Spaghetti')
})
it('does not farm points by repeating or correcting reports for the same product', async () => {
  await status()
  await status(existing, 'out') // correction is an allowed write but not another point
  expect((await summary()).balance).toBe(1)
  await expect(status(existing, 'out')).rejects.toThrow('already reported')
  expect((await summary()).balance).toBe(1)
})
it('awards a second student for verification, but not for a no-op after verification', async () => {
  await status()
  await signIn(bob)
  await status()
  expect((await summary()).balance).toBe(1)
  await status()
  expect((await summary()).balance).toBe(1)
})
it('credits the upload owner when the API resolves a gallery/camera job and ignores retries', async () => {
  await asAdmin()
  const upload = await job()
  await db.query("select public.resolve_job_existing($1, $2, 'model')", [upload, existing])
  await db.query("select public.resolve_job_existing($1, $2, 'model')", [upload, existing])
  await signIn()
  expect((await summary()).balance).toBe(1)
})
it('awards a new-product upload once and does not award again on queue review confirmation', async () => {
  await asAdmin()
  const upload = await job()
  const result = await db.query<{ id: string }>("select public.resolve_job_new($1, 'Barilla Whole Grain Spaghetti', 'Barilla', null, array['pasta_grains_rice'], 'yellow') as id", [upload])
  expect(result.rows[0].id).toBeTruthy()
  await signIn()
  expect((await summary()).balance).toBe(1)
  await db.query("select public.confirm_job($1, 'Barilla Whole Grain Spaghetti', 'Barilla', array['pasta_grains_rice'])", [upload])
  expect((await summary()).balance).toBe(1)
})
it('earns one point per distinct confirmed shelf product and not per upload', async () => {
  await asAdmin()
  const other = await item('Ritz Crackers', 'Ritz')
  const scan = (await db.query<{ id: string }>("insert into public.shelf_scans(photo_path, status, detections, created_by) values ('shelf.jpg', 'ready', $1, $2) returning id", [JSON.stringify([{ item_id: existing }, { item_id: other }]), alice])).rows[0].id
  await signIn()
  const result = await db.query<{ result: { updated: number } }>('select public.confirm_shelf_scan($1, $2) as result', [scan, [existing, other, other]])
  expect(result.rows[0].result.updated).toBe(2)
  expect((await summary()).balance).toBe(2)
  await expect(db.query('select public.confirm_shelf_scan($1, $2)', [scan, [existing]])).rejects.toThrow('already confirmed')
  expect((await summary()).balance).toBe(2)
})
it('does not award for duplicate catalog entries differing only in size, punctuation, case or plural', async () => {
  await status()
  await asAdmin()
  const copy = await item('SPAGHETTI Barilla 32 oz.', null)
  await signIn()
  await status(copy)
  expect((await summary()).balance).toBe(1)
})
it('counts different brands and varieties as distinct products', async () => {
  await status()
  await asAdmin()
  const different = [await item('Spaghetti', 'De Cecco'), await item('Barilla Whole Grain Spaghetti', 'Barilla')]
  await signIn()
  for (const id of different) await status(id)
  expect((await summary()).balance).toBe(3)
})
it('does not award queued, failed or rejected photos or failed inventory writes', async () => {
  await expect(status('10000000-0000-0000-0000-000000000099')).rejects.toThrow('item not found')
  await asAdmin()
  for (const value of ['queued', 'red', 'rejected']) await job(value)
  await signIn()
  expect((await summary()).balance).toBe(0)
})
it('retains points when a catalog item is deleted and denies forged client awards', async () => {
  await status()
  await expect(db.query('insert into public.inventory_point_awards(user_id, item_id, product_key, item_name) values ($1,$2,\'fake\',\'fake\')', [alice, existing])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('delete from public.inventory_point_awards')).rejects.toMatchObject({ code: '42501' })
  await expect(db.query("select public.apply_item_status($1, 'out', $2)", [existing, alice])).rejects.toMatchObject({ code: '42501' })
  await asAdmin()
  await db.query('delete from public.items where id = $1', [existing])
  await signIn()
  expect((await summary()).balance).toBe(1)
})
it('protects balances and history from other users, anonymous clients and non-UTA accounts', async () => {
  await status()
  await signIn(bob)
  expect((await db.query('select * from public.inventory_point_awards')).rows).toEqual([])
  expect((await summary()).recent_updates).toEqual([])
  await db.exec('reset role; set role anon;')
  await expect(summary()).rejects.toMatchObject({ code: '42501' })
  await signIn(alice, 'student@example.com')
  await expect(summary()).rejects.toThrow('UTA email')
  expect((await db.query('select * from public.inventory_point_awards')).rows).toEqual([])
})
it('keeps all 100 earned points and leaves existing check-in policy and appointments untouched', async () => {
  await asAdmin()
  const before = (await db.query<{ definition: string }>("select pg_get_functiondef('public.check_in(text)'::regprocedure) as definition")).rows[0].definition
  expect(before).toBe(originalCheckIn)
  for (let index = 0; index < 100; index++) {
    const id = await item(`Test Product ${index}`, null)
    await db.query("select public.apply_item_status($1, 'in_stock', $2)", [id, alice])
  }
  await signIn()
  const data = await summary()
  expect(data.balance).toBe(100)
  expect(data.earned).toBe(100)
  expect(data.reward_threshold).toBe(100)
  expect(data.recent_updates).toHaveLength(20)
  await asAdmin()
  expect((await db.query('select * from public.pantry_checkins')).rows).toHaveLength(0)
  expect((await db.query("select to_regprocedure('public.redeem_inventory_points(uuid)') as redeem")).rows).toEqual([{ redeem: null }])
})
it('rolls back the point when the inventory transaction is rolled back', async () => {
  await db.exec('begin;')
  await status()
  expect((await summary()).balance).toBe(1)
  await db.exec('rollback;')
  expect((await summary()).balance).toBe(0)
})
it('does not issue retroactive points just because old history exists', async () => {
  // The migration attaches an INSERT trigger, not a history backfill.
  await asAdmin()
  await db.exec('alter table public.item_status_log disable trigger award_inventory_point;')
  await db.query("insert into public.item_status_log(item_id, status, user_id, created_at) values ($1, 'low', $2, now() - interval '2 days')", [existing, alice])
  await db.exec('alter table public.item_status_log enable trigger award_inventory_point;')
  await signIn()
  expect((await summary()).balance).toBe(0)
  await status()
  expect((await summary()).balance).toBe(1)
})
