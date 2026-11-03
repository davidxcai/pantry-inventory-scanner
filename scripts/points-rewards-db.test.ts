import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { PointsSummary } from '../shared/inventoryPoints'

const alice = '00000000-0000-0000-0000-000000000001'
const bob = '00000000-0000-0000-0000-000000000002'
const approver = '00000000-0000-0000-0000-000000000003'
const request = '10000000-0000-0000-0000-000000000001'
const second = '10000000-0000-0000-0000-000000000002'
let db: PGlite
async function admin() { await db.exec('reset role') }
async function signIn(id = alice, email = `${id}@mavs.uta.edu`) {
  await db.exec('reset role; set role authenticated;')
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ email })])
}
async function balance() { return (await db.query<{ value: PointsSummary }>('select public.get_inventory_points() as value')).rows[0].value }
async function earn(count = 100, user = alice) {
  await admin()
  await db.query("insert into public.inventory_point_awards(user_id,item_id,product_key,item_name) select $1, gen_random_uuid(), 'product-'||n, 'Product '||n from generate_series(1,$2::int) n", [user, count])
  await signIn(user)
}
async function submit(id = request) { return (await db.query<{ id: string }>('select public.request_extra_visit($1) as id', [id])).rows[0].id }
async function decide(decision = 'approved', id = request) {
  await signIn(approver)
  await db.query('select public.review_extra_visit($1,$2,$3)', [id, decision, 'Contact us to arrange a visit.'])
  await signIn()
}
const checkIn = (code = 'test-code') => db.query<{ at: string }>('select public.check_in($1) as at', [code])
async function ageRegular() {
  await admin()
  await db.exec("update public.pantry_checkins set checked_in_at = now() - interval '1 hour'")
  await signIn()
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    create function public.is_uta_email(text) returns boolean language sql immutable as $$ select $1 ~ '@(mavs\\.)?uta\\.edu$' $$;
    create function public.is_uta_user() returns boolean language sql stable as $$ select auth.uid() is not null and public.is_uta_email(auth.jwt()->>'email') $$;
    create table public.profiles(user_id uuid primary key references auth.users(id) on delete cascade, display_name text);
    create table public.items(id uuid primary key, name text, brand text, status text, status_updated_by uuid, status_updated_at timestamptz, status_verified boolean default false);
    create table public.item_status_log(id uuid primary key default gen_random_uuid(), item_id uuid, user_id uuid, status text, kind text, created_at timestamptz default now());
    create table public.intake_jobs(id uuid primary key);
  `)
  await db.exec(readFileSync('supabase/migrations/20261015020000_pantry_gate.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261028000000_inventory_points.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261102030000_extra_visit_rewards.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261102040000_gmail_visit_approver.sql', 'utf8'))
  await db.exec('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()')
}, 30_000)
beforeEach(async () => {
  await admin()
  await db.exec("truncate auth.users cascade; update public.pantry_settings set value = 'true' where key = 'visit_rewards_enabled'; update public.pantry_settings set value = 'false' where key = 'gates_enabled'; update public.pantry_settings set value = 'test-code' where key = 'checkin_code';")
  await db.query('insert into auth.users(id,email) values($1,$4),($2,$5),($3,$6)', [alice, bob, approver, 'alice@mavs.uta.edu', 'bob@mavs.uta.edu', 'reviewer@uta.edu'])
  await db.query('insert into public.visit_reward_approvers values($1)', [approver])
  await signIn()
})
afterAll(async () => { await db?.close() })

it('starts disabled in the migration and requires verified students and a configured approver', async () => {
  await earn()
  await admin(); await db.exec("update pantry_settings set value='false' where key='visit_rewards_enabled'"); await signIn()
  await expect(submit()).rejects.toThrow('not enabled')
  await admin(); await db.exec("update pantry_settings set value='true' where key='visit_rewards_enabled'; delete from visit_reward_approvers"); await signIn()
  await expect(submit()).rejects.toThrow('approver')
  await admin(); await db.query('insert into visit_reward_approvers values($1)', [approver]); await db.query('update auth.users set email_confirmed_at=null where id=$1', [alice]); await signIn()
  await expect(submit()).rejects.toThrow('verified UTA')
})
it('requires 100 points, reserves exactly once across retries and simultaneous submissions', async () => {
  await earn(99)
  await expect(submit()).rejects.toThrow('100 available')
  await admin(); await db.query("insert into inventory_point_awards(user_id,item_id,product_key,item_name) values($1,gen_random_uuid(),'extra','Extra')", [alice]); await signIn()
  expect(await Promise.all([submit(), submit(), submit(second)])).toEqual([request, request, request])
  expect(await balance()).toMatchObject({ earned: 100, balance: 0, reserved: 100, spent: 0 })
  await admin()
  expect((await db.query('select * from visit_reward_mail')).rows).toHaveLength(1)
  expect((await db.query('select * from visit_reward_events')).rows).toHaveLength(1)
})
it('cancels pending requests once and rejects cancellation after approval', async () => {
  await earn(); await submit()
  await db.query('select public.cancel_extra_visit($1)', [request]); await db.query('select public.cancel_extra_visit($1)', [request])
  expect(await balance()).toMatchObject({ balance: 100, reserved: 0, spent: 0 })
  await submit(second); await decide('approved', second)
  await expect(db.query('select public.cancel_extra_visit($1)', [second])).rejects.toThrow('Only pending')
})
it('authorizes decisions and review lists only for allowlisted users and protects owner data', async () => {
  await earn(); await submit(); await signIn(bob)
  await expect(db.query("select public.review_extra_visit($1,'approved')", [request])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('select public.list_visit_reward_requests()')).rejects.toMatchObject({ code: '42501' })
  expect((await db.query('select * from public.visit_reward_requests')).rows).toEqual([])
  await expect(db.query('select public.cancel_extra_visit($1)', [request])).rejects.toThrow('not found')
  await expect(db.query("update public.visit_reward_requests set status='approved'")).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('select public.expire_user_visit_rewards($1)', [alice])).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('select public.claim_visit_reward_mail()')).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('select * from public.visit_reward_approvers')).rejects.toMatchObject({ code: '42501' })
  await signIn(approver)
  const reviews = (await db.query<{ rows: { student_email: string }[] }>('select public.list_visit_reward_requests($1) as rows', [request])).rows[0].rows
  expect(reviews[0].student_email).toBe('alice@mavs.uta.edu')
  await db.exec('reset role; set role anon')
  await expect(submit()).rejects.toMatchObject({ code: '42501' })
})
it('spends only on approval and releases rejected reservations exactly once', async () => {
  await earn(); await submit(); await decide('rejected'); await decide('rejected')
  expect(await balance()).toMatchObject({ balance: 100, reserved: 0, spent: 0 })
  await submit(second); await decide('approved', second); await decide('approved', second)
  const data = await balance()
  expect(data).toMatchObject({ balance: 0, reserved: 0, spent: 100, current_reward: { status: 'approved' } })
  expect(new Date(data.current_reward!.expires_at!).getTime() - new Date(data.current_reward!.decided_at!).getTime()).toBe(30 * 24 * 60 * 60 * 1000)
  await admin()
  expect((await db.query("select * from visit_reward_mail where kind='approved'")).rows).toHaveLength(1)
})
it('refunds an expired unused reward during balance reads and allows another request', async () => {
  await earn(); await submit(); await decide()
  await admin(); await db.query("update visit_reward_requests set expires_at=now()-interval '1 second' where id=$1", [request]); await signIn()
  expect(await balance()).toMatchObject({ balance: 100, reserved: 0, spent: 0, current_reward: null })
  expect((await balance()).balance).toBe(100)
  await submit(second)
  expect((await balance()).reserved).toBe(100)
  await admin()
  expect((await db.query("select * from visit_reward_events where status='expired'")).rows).toHaveLength(1)
})
it('uses the regular visit first, reuses active sessions, and consumes one reward atomically', async () => {
  await earn(); await submit(); await decide()
  await expect(checkIn('bad-code')).rejects.toThrow('QR code')
  await checkIn()
  expect((await balance()).current_reward?.status).toBe('approved')
  await ageRegular()
  const scans = await Promise.all([checkIn(), checkIn(), checkIn()])
  expect(scans.map(s => s.rows[0].at)).toEqual([scans[0].rows[0].at, scans[0].rows[0].at, scans[0].rows[0].at])
  expect(await balance()).toMatchObject({ spent: 100, current_reward: null })
  await admin()
  expect((await db.query('select * from extra_pantry_checkins')).rows).toHaveLength(1)
  expect((await db.query('select * from pantry_checkins')).rows).toHaveLength(1)
  await db.exec("update extra_pantry_checkins set checked_in_at=now()-interval '1 hour'; update visit_reward_requests set expires_at=now()-interval '1 second'")
  await signIn()
  expect((await balance()).spent).toBe(100) // used rewards never refund
  await expect(checkIn()).rejects.toThrow('already checked in')
})
it('allows repeated rewards in one month after use, without holding multiple unused rewards', async () => {
  await earn(200); await submit(); await decide()
  expect(await submit(second)).toBe(request)
  await checkIn(); await ageRegular(); await checkIn()
  expect((await balance()).balance).toBe(100)
  await submit(second); await decide('approved', second)
  await admin(); await db.exec("update extra_pantry_checkins set checked_in_at=now()-interval '1 hour'"); await signIn()
  await checkIn()
  expect(await balance()).toMatchObject({ balance: 0, reserved: 0, spent: 200, current_reward: null })
  await admin()
  expect((await db.query('select * from pantry_checkins')).rows).toHaveLength(1)
  expect((await db.query('select * from extra_pantry_checkins')).rows).toHaveLength(2)
})
it('blocks expired rewards even before the scheduled expiry worker and reports pending approval', async () => {
  await earn(); await checkIn(); await ageRegular(); await submit()
  await expect(checkIn()).rejects.toThrow('awaiting approval')
  await decide()
  await admin(); await db.query("update visit_reward_requests set expires_at=now()-interval '1 second' where id=$1", [request]); await signIn()
  await expect(checkIn()).rejects.toThrow('expired')
  expect((await balance()).balance).toBe(100)
})
it('preserves opening/closing restrictions and accepts extra visits as inventory presence', async () => {
  await earn(); await submit(); await decide(); await checkIn(); await ageRegular()
  await admin()
  await db.exec("update pantry_settings set value='true' where key='gates_enabled'; create or replace function public.pantry_closes_at(p_at timestamptz default now()) returns timestamptz language sql stable as $$ select null::timestamptz $$;")
  await signIn(); await expect(checkIn()).rejects.toThrow('closed right now')
  await admin(); await db.exec("create or replace function public.pantry_closes_at(p_at timestamptz default now()) returns timestamptz language sql stable as $$ select now()+interval '10 minutes' $$;"); await signIn()
  await expect(checkIn()).rejects.toThrow('about to close')
  await admin(); await db.exec("create or replace function public.pantry_closes_at(p_at timestamptz default now()) returns timestamptz language sql stable as $$ select now()+interval '1 hour' $$;"); await signIn()
  await checkIn()
  // Gate is private; exercise it through the real inventory entrypoint.
  await admin(); await db.exec("insert into items(id,name) values('90000000-0000-0000-0000-000000000001','Rice')"); await signIn()
  await db.exec("select set_item_status('90000000-0000-0000-0000-000000000001','in_stock')")
  expect((await balance()).earned).toBe(101)
})
it('handles competing cancellation and decision without both spending and refunding', async () => {
  await earn(); await submit()
  await admin(); await db.query('insert into visit_reward_approvers values($1)', [alice]); await signIn()
  const results = await Promise.allSettled([
    db.query('select cancel_extra_visit($1)', [request]),
    db.query("select review_extra_visit($1,'approved')", [request]),
  ])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  const data = await balance()
  expect(data.balance + data.spent + data.reserved).toBe(100)
})
it('leases mail, retries failures with backoff, and ignores stale completion tokens', async () => {
  await earn(); await submit(); await admin()
  const claim = async () => (await db.query<{ id: string; lease_token: string; attempts: number }>('select * from claim_visit_reward_mail()')).rows[0]
  const mail = await claim()
  expect(mail.attempts).toBe(1)
  expect(await claim()).toBeUndefined()
  await db.query('select finish_visit_reward_mail($1,$2,$3)', [mail.id, mail.lease_token, 'SMTP unavailable'])
  expect(await claim()).toBeUndefined()
  await db.exec("update visit_reward_mail set next_attempt_at=now()-interval '1 second'")
  const retry = await claim()
  expect(retry.attempts).toBe(2)
  await db.query('select finish_visit_reward_mail($1,$2)', [mail.id, mail.lease_token])
  expect((await db.query<{ sent_at: string | null }>('select sent_at from visit_reward_mail')).rows[0].sent_at).toBeNull()
  await db.query('select finish_visit_reward_mail($1,$2)', [retry.id, retry.lease_token])
  expect(await claim()).toBeUndefined()
})

const gmailUser = '00000000-0000-0000-0000-000000000004'
const gmail = 'salmanfarse2025@gmail.com'
it('permits only the designated Gmail registration exception, without auto-granting approval', async () => {
  await admin()
  await expect(db.query("insert into auth.users(id,email) values($1,'someone@gmail.com')", [gmailUser])).rejects.toThrow('designated visit approver')
  await expect(db.query("insert into auth.users(id,email) values($1,'salmanfarse2025+alias@gmail.com')", [gmailUser])).rejects.toThrow('designated visit approver')
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)', [gmailUser, gmail.toUpperCase()])
  await signIn(gmailUser, gmail)
  expect((await db.query<{ allowed: boolean }>('select is_visit_reward_approver() as allowed')).rows[0].allowed).toBe(false)
  await expect(db.query('select list_visit_reward_requests()')).rejects.toMatchObject({ code: '42501' })
  await expect(db.query('insert into visit_reward_approvers values($1)', [gmailUser])).rejects.toMatchObject({ code: '42501' })
  await admin(); await db.query('insert into visit_reward_approvers values($1)', [gmailUser]); await signIn(gmailUser, gmail)
  await expect(db.query('select list_visit_reward_requests()')).rejects.toMatchObject({ code: '42501' })
})
it('lets the verified allowlisted Gmail review, but preserves student-only privileges and revokes changed identities', async () => {
  await admin()
  await db.query('insert into auth.users(id,email) values($1,$2)', [gmailUser, gmail])
  await db.query('insert into visit_reward_approvers values($1)', [gmailUser])
  await db.query('delete from visit_reward_approvers where user_id=$1', [approver])
  await earn(); await submit() // Gmail is the only approver, so readiness must accept it.
  await signIn(gmailUser, gmail)
  const results = (await db.query<{ requests: unknown[] }>('select list_visit_reward_requests() as requests')).rows[0].requests
  expect(results).toHaveLength(1)
  await db.query("select review_extra_visit($1,'approved','Approved by Gmail reviewer')", [request])
  await expect(submit(second)).rejects.toThrow('verified UTA')
  await expect(checkIn()).rejects.toThrow('UTA email')
  await expect(balance()).rejects.toThrow('UTA email')
  await admin()
  await db.query("update auth.users set email='another@gmail.com' where id=$1", [gmailUser])
  // A stale JWT still claiming the original address must not preserve reviewer access.
  await signIn(gmailUser, gmail)
  await expect(db.query('select list_visit_reward_requests()')).rejects.toMatchObject({ code: '42501' })
})
