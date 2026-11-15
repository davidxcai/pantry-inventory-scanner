import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
let db: PGlite
const user = '00000000-0000-4000-8000-000000000001'
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table public.profiles(user_id uuid primary key references auth.users(id), display_name text not null);
    create function public.is_uta_email(p_email text) returns boolean language sql immutable as $$select p_email ~ '^[^@]+@(mavs\\.)?uta\\.edu$'$$;
    create table public.visit_reward_approvers(user_id uuid primary key references auth.users(id));
    create function public.is_visit_reward_approver() returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from visit_reward_approvers a join auth.users u on u.id=a.user_id
      where a.user_id=auth.uid() and u.email_confirmed_at is not null
        and (is_uta_email(u.email) or lower(u.email)='salmanfarse2025@gmail.com'));
    $$;
  `)
  await db.exec(readFileSync('supabase/migrations/20261115010000_google_login.sql', 'utf8'))
  await db.exec('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()')
}, 30_000)
beforeEach(async () => { await db.exec('reset role; truncate auth.users cascade') })
afterAll(async () => { await db?.close() })
async function register(email: string, verified = true, metadata: object = {}) {
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4)',
    [user, email, verified ? new Date().toISOString() : null, JSON.stringify(metadata)])
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await db.exec('set role authenticated')
}
it.each(['person@gmail.com', 'person@uta.edu', 'person@mavs.uta.edu'])(
  'allows verified %s accounts through the existing RLS helper', async (email) => {
    await register(email)
    expect((await db.query<{ allowed: boolean }>('select public.is_uta_user() as allowed')).rows[0].allowed).toBe(true)
    expect((await db.query<{ allowed: boolean }>('select public.is_visit_reward_approver() as allowed')).rows[0].allowed).toBe(false)
  },
)
it('requires server-confirmed email even if profile metadata claims verification', async () => {
  await register('person@gmail.com', false, { email_verified: true })
  expect((await db.query<{ allowed: boolean }>('select is_uta_user() as allowed')).rows[0].allowed).toBe(false)
})
it.each(['person@yahoo.com', 'person@gmail.com.evil.test', 'person@eviluta.edu'])(
  'rejects unsupported or lookalike email domains: %s', async (email) => {
    await expect(register(email)).rejects.toThrow('Use your @uta.edu')
    expect((await db.query('select * from auth.users')).rows).toHaveLength(0)
  },
)
it('uses Google profile names without assigning special privileges', async () => {
  await register('person@gmail.com', true, { full_name: 'Google Student' })
  await db.exec('reset role')
  expect((await db.query<{ display_name: string }>('select display_name from profiles')).rows[0].display_name).toBe('Google Student')
})
it('keeps review access restricted to an explicitly allowlisted designated reviewer', async () => {
  await register('salmanfarse2025@gmail.com')
  expect((await db.query<{ allowed: boolean }>('select is_visit_reward_approver() as allowed')).rows[0].allowed).toBe(false)
  await db.exec('reset role')
  await db.query('insert into visit_reward_approvers values($1)', [user])
  await db.exec('set role authenticated')
  expect((await db.query<{ allowed: boolean }>('select is_visit_reward_approver() as allowed')).rows[0].allowed).toBe(true)
})
it('denies anonymous users even when the helper is executable', async () => {
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await db.exec('set role anon')
  expect((await db.query<{ allowed: boolean }>('select is_uta_user() as allowed')).rows[0].allowed).toBe(false)
})
