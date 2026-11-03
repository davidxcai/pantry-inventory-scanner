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
  await db.exec(readFileSync('supabase/migrations/20261028000000_inventory_points.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261102050000_weekly_inventory_points.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261102070000_single_student_verification.sql', 'utf8'))
}, 30_000)
beforeEach(async () => {
  await asAdmin()
  await db.exec('truncate auth.users, public.items, public.intake_jobs, public.item_images, public.shelf_scans cascade;')
  await db.query('insert into auth.users values ($1), ($2)', [alice, bob])
  await db.query("insert into public.items (id, name, brand, categories) values ($1, 'Barilla Spaghetti', 'Barilla', array['pasta_grains_rice'])", [existing])
  await signIn()
})
afterAll(async () => { await db?.close() })


it('awards once per rolling seven days and preserves successful repeat stock updates', async () => {
  await asAdmin()
  const upload = await job(); const duplicate = await job()
  await db.query("select resolve_job_existing($1,$2)",[upload,existing])
  await db.query("select resolve_job_existing($1,$2)",[duplicate,existing])
  await signIn()
  expect((await summary()).balance).toBe(1)
  const activity = (await db.query<{ outcome: string; job_id: string }>('select outcome,job_id from inventory_point_activity order by created_at,id')).rows
  expect(activity.map(entry=>entry.outcome).sort()).toEqual(['cooldown','earned'])
  expect(activity.map(entry=>entry.job_id).sort()).toEqual([upload,duplicate].sort())
  await asAdmin(); await db.exec("update inventory_point_awards set created_at=now()-interval '168 hours'")
  const next = await job(); await db.query('select resolve_job_existing($1,$2)',[next,existing]); await signIn()
  expect((await summary()).balance).toBe(2)
})
it('deduplicates canonical product creation and concurrent jobs without losing stock updates', async () => {
  await asAdmin()
  const first = await job(); const second = await job()
  const result = await Promise.all([
    db.query<{ id: string }>("select resolve_job_new($1,'BARILLA Spaghetti 32 oz.',null,null,array['pasta_grains_rice']) as id",[first]),
    db.query<{ id: string }>("select resolve_job_new($1,'Spaghetti','Barilla',null,array['pasta_grains_rice']) as id",[second]),
  ])
  expect(result.map(row=>row.rows[0].id)).toEqual([existing,existing])
  expect((await db.query('select * from items')).rows).toHaveLength(1)
  await signIn(); expect((await summary()).balance).toBe(1)
})
it('blocks points for duplicate rows and renaming, but awards distinct varieties and accounts', async () => {
  await status()
  await asAdmin(); const copy = await item('SPAGHETTI BARILLA 32 oz.',null); const variety = await item('Barilla Whole Grain Spaghetti','Barilla'); await signIn()
  await status(copy)
  await status(variety)
  expect((await summary()).balance).toBe(2)
  await signIn(bob); await status()
  expect((await summary()).balance).toBe(1)
})
it('supports weekly shelf restock reports even when stock is already verified', async () => {
  await status(existing,'in_stock')
  await asAdmin(); await db.exec("update inventory_point_awards set created_at=now()-interval '168 hours'; update items set status_verified=true")
  await signIn(); await status(existing,'in_stock')
  expect((await summary()).balance).toBe(2)
  await status(existing,'in_stock')
  expect((await summary()).balance).toBe(2)
})
it('keeps receipts private and denies forged point receipts and helper calls', async () => {
  await status(); await signIn(bob)
  expect((await db.query('select * from inventory_point_activity')).rows).toEqual([])
  await expect(db.query('delete from inventory_point_activity')).rejects.toMatchObject({code:'42501'})
  await expect(db.query('select record_inventory_point(gen_random_uuid())')).rejects.toMatchObject({code:'42501'})
})
it('recovers successful recent reports idempotently without rewarding duplicate-product history', async () => {
  await asAdmin()
  await db.exec('alter table item_status_log disable trigger award_inventory_point')
  await db.query("insert into item_status_log(item_id,status,user_id,created_at) values($1,'in_stock',$2,now()-interval '2 days'),($1,'low',$2,now()-interval '1 day')",[existing,alice])
  await db.exec('alter table item_status_log enable trigger award_inventory_point')
  const migration = readFileSync('supabase/migrations/20261102050000_weekly_inventory_points.sql','utf8')
  const recovery = migration.slice(migration.indexOf('do $$'))
  await db.exec(recovery); await db.exec(recovery)
  await signIn(); expect((await summary()).balance).toBe(1)
  expect((await db.query('select * from inventory_point_activity')).rows).toHaveLength(2)
})

it('verifies a photo from one student and never revives cancelled jobs', async () => {
  await asAdmin()
  await db.exec(readFileSync('supabase/migrations/20261102000000_cancel_intake_job.sql','utf8'))
  const first = await job(); await db.query('select resolve_job_existing($1,$2)',[first,existing])
  expect((await db.query<{status_verified:boolean;status_updated_by:string}>('select status_verified,status_updated_by from items where id=$1',[existing])).rows[0]).toMatchObject({status_verified:true,status_updated_by:alice})
  const other = (await db.query<{id:string}>("insert into intake_jobs(created_by) values($1) returning id",[bob])).rows[0].id
  await signIn(bob)
  await db.query('select resolve_job_existing($1,$2)',[other,existing])
  await signIn(); await asAdmin()
  // A repeat photo of the same status keeps the original reporter but is still logged (for points).
  expect((await db.query<{status_updated_by:string}>('select status_updated_by from items where id=$1',[existing])).rows[0].status_updated_by).toBe(alice)
  expect((await db.query('select * from item_status_log where item_id=$1',[existing])).rows).toHaveLength(2)
  const cancelled = await job('cancelled')
  await expect(db.query('select resolve_job_existing($1,$2)',[cancelled,existing])).rejects.toThrow('job cancelled')
})
