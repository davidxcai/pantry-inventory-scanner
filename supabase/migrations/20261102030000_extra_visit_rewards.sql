-- Extra visits: immutable earnings + auditable reservation/redemption state.
-- Disabled until the operator configures email delivery and an approver.
insert into public.pantry_settings(key, value) values ('visit_rewards_enabled', 'false');

create table public.visit_reward_approvers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.visit_reward_requests (
  id uuid primary key, -- client-generated idempotency key
  user_id uuid not null references auth.users(id) on delete cascade,
  cost integer not null default 100 check (cost = 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','expired','used')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text check (length(decision_note) <= 2000),
  expires_at timestamptz,
  used_at timestamptz,
  check (status not in ('approved','used','expired') or expires_at is not null),
  check ((status = 'used') = (used_at is not null))
);
create unique index visit_reward_one_active on public.visit_reward_requests(user_id) where status in ('pending','approved');
create index visit_reward_history on public.visit_reward_requests(user_id, created_at desc);
create table public.visit_reward_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_reward_requests(id) on delete cascade,
  status text not null,
  actor_id uuid,
  created_at timestamptz not null default now(),
  unique(request_id, status)
);
create table public.extra_pantry_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null unique references public.visit_reward_requests(id),
  checked_in_at timestamptz not null default now()
);
create index extra_checkins_recent on public.extra_pantry_checkins(user_id, checked_in_at desc);
create table public.visit_reward_mail (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_reward_requests(id) on delete cascade,
  kind text not null check(kind in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error text,
  unique(request_id, kind)
);
create index visit_mail_due on public.visit_reward_mail(next_attempt_at) where sent_at is null;
alter table public.visit_reward_approvers enable row level security;
alter table public.visit_reward_requests enable row level security;
alter table public.visit_reward_events enable row level security;
alter table public.extra_pantry_checkins enable row level security;
alter table public.visit_reward_mail enable row level security;
revoke all on public.visit_reward_approvers, public.visit_reward_requests, public.visit_reward_events, public.extra_pantry_checkins, public.visit_reward_mail from public, anon, authenticated;
grant all on public.visit_reward_approvers, public.visit_reward_requests, public.visit_reward_events, public.extra_pantry_checkins, public.visit_reward_mail to service_role;
grant select on public.visit_reward_requests, public.extra_pantry_checkins to authenticated;
create policy visit_requests_own on public.visit_reward_requests for select to authenticated using (user_id = (select auth.uid()) and public.is_uta_user());
create policy extra_checkins_own on public.extra_pantry_checkins for select to authenticated using (user_id = (select auth.uid()) and public.is_uta_user());

create function public.is_visit_reward_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.visit_reward_approvers a join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and u.email_confirmed_at is not null and public.is_uta_email(u.email));
$$;
revoke all on function public.is_visit_reward_approver() from public, anon;
grant execute on function public.is_visit_reward_approver() to authenticated;

create function public.record_visit_reward_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.visit_reward_events(request_id, status, actor_id) values(new.id, new.status, auth.uid());
    if new.status in ('pending','approved','rejected') then
      insert into public.visit_reward_mail(request_id, kind) values(new.id, new.status) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.record_visit_reward_event() from public, anon, authenticated;
create trigger visit_reward_audit after insert or update on public.visit_reward_requests for each row execute function public.record_visit_reward_event();

-- All state transitions use this same per-account lock, including expiry and check-in.
create function public.expire_user_visit_rewards(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  update public.visit_reward_requests set status = 'expired'
    where user_id = p_user and status = 'approved' and expires_at <= now();
end;
$$;
revoke all on function public.expire_user_visit_rewards(uuid) from public, anon, authenticated;
create function public.expire_visit_rewards() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  for v_uid in select distinct user_id from public.visit_reward_requests where status = 'approved' and expires_at <= now() order by user_id loop
    perform public.expire_user_visit_rewards(v_uid);
  end loop;
end;
$$;
revoke all on function public.expire_visit_rewards() from public, anon, authenticated;
grant execute on function public.expire_visit_rewards() to service_role;

create or replace function public.get_inventory_points() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_earned bigint; v_reserved bigint; v_spent bigint;
begin
  if not public.is_uta_user() then raise exception 'Sign in with a UTA email to view points'; end if;
  perform public.expire_user_visit_rewards(v_uid);
  select count(*) into v_earned from public.inventory_point_awards where user_id = v_uid;
  select coalesce(sum(cost) filter(where status = 'pending'),0), coalesce(sum(cost) filter(where status in ('approved','used')),0)
    into v_reserved, v_spent from public.visit_reward_requests where user_id = v_uid;
  return jsonb_build_object(
    'balance', v_earned - v_reserved - v_spent, 'earned', v_earned, 'reserved', v_reserved, 'spent', v_spent,
    'reward_threshold', 100, 'redemption_enabled', coalesce((select value = 'true' from public.pantry_settings where key = 'visit_rewards_enabled'),false),
    'is_approver', public.is_visit_reward_approver(),
    'current_reward', (select to_jsonb(r) from public.visit_reward_requests r where user_id = v_uid and status in ('pending','approved') limit 1),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id) from public.visit_reward_requests r where user_id = v_uid),'[]'::jsonb),
    'recent_updates', coalesce((select jsonb_agg(row_to_json(a)) from (
      select id, item_name, created_at from public.inventory_point_awards where user_id = v_uid order by created_at desc, id limit 20
    ) a), '[]'::jsonb));
end;
$$;

create function public.request_extra_visit(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_balance bigint; v_id uuid;
begin
  if not public.is_uta_user() or not exists(select 1 from auth.users where id = v_uid and email_confirmed_at is not null and public.is_uta_email(email)) then
    raise exception 'Sign in with a verified UTA email to request an extra visit';
  end if;
  perform public.expire_user_visit_rewards(v_uid);
  select id into v_id from public.visit_reward_requests where id = p_request_id and user_id = v_uid;
  if found then return v_id; end if;
  if not coalesce((select value = 'true' from public.pantry_settings where key = 'visit_rewards_enabled'),false) then raise exception 'Visit rewards are not enabled yet'; end if;
  if not exists(select 1 from public.visit_reward_approvers a join auth.users u on u.id = a.user_id where u.email_confirmed_at is not null and public.is_uta_email(u.email)) then raise exception 'An approver must be configured first'; end if;
  -- A second tab/request ID returns the existing active request rather than reserving twice.
  select id into v_id from public.visit_reward_requests where user_id = v_uid and status in ('pending','approved');
  if found then return v_id; end if;
  select (select count(*) from public.inventory_point_awards where user_id = v_uid) -
    coalesce(sum(cost) filter(where status in ('pending','approved','used')),0) into v_balance from public.visit_reward_requests where user_id = v_uid;
  if v_balance < 100 then raise exception 'You need 100 available points to request an extra visit'; end if;
  insert into public.visit_reward_requests(id, user_id) values(p_request_id, v_uid);
  return p_request_id;
end;
$$;
create function public.cancel_extra_visit(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.is_uta_user() then raise exception 'Sign in with a UTA email'; end if;
  perform public.expire_user_visit_rewards(auth.uid());
  select status into v_status from public.visit_reward_requests where id = p_request_id and user_id = auth.uid() for update;
  if not found then raise exception 'Request not found'; end if;
  if v_status = 'cancelled' then return; end if;
  if v_status <> 'pending' then raise exception 'Only pending requests can be cancelled'; end if;
  update public.visit_reward_requests set status = 'cancelled' where id = p_request_id;
end;
$$;
create function public.review_extra_visit(p_request_id uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_status text;
begin
  if not public.is_visit_reward_approver() then raise exception 'Approver access required' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
  if length(p_note) > 2000 then raise exception 'Note must be at most 2000 characters'; end if;
  select user_id into v_uid from public.visit_reward_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  perform public.expire_user_visit_rewards(v_uid);
  select status into v_status from public.visit_reward_requests where id = p_request_id for update;
  if v_status = p_decision then return; end if;
  if v_status <> 'pending' then raise exception 'This request is no longer pending. Refresh to see its status'; end if;
  update public.visit_reward_requests set status = p_decision, decided_at = now(), decided_by = auth.uid(), decision_note = nullif(trim(p_note),''),
    expires_at = case when p_decision = 'approved' then now() + interval '720 hours' else null end where id = p_request_id;
end;
$$;
create function public.list_visit_reward_requests(p_request_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_visit_reward_approver() then raise exception 'Approver access required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('student_email',u.email,'student_name',
      coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.email)) order by r.created_at desc, r.id)
    from public.visit_reward_requests r join auth.users u on u.id = r.user_id where p_request_id is null or r.id = p_request_id),'[]'::jsonb);
end;
$$;
revoke all on function public.request_extra_visit(uuid), public.cancel_extra_visit(uuid), public.review_extra_visit(uuid,text,text), public.list_visit_reward_requests(uuid) from public, anon;
grant execute on function public.request_extra_visit(uuid), public.cancel_extra_visit(uuid), public.review_extra_visit(uuid,text,text), public.list_visit_reward_requests(uuid) to authenticated;

-- Lease queue jobs so overlapping workers do not send the same message concurrently.
create function public.claim_visit_reward_mail() returns setof public.visit_reward_mail
language sql security definer set search_path = public as $$
  update public.visit_reward_mail set lease_token = gen_random_uuid(), lease_until = now() + interval '10 minutes', attempts = attempts + 1
    where id = (select id from public.visit_reward_mail where sent_at is null and next_attempt_at <= now()
      and (lease_until is null or lease_until <= now()) order by created_at, id for update skip locked limit 1)
    returning *;
$$;
create function public.finish_visit_reward_mail(p_id uuid, p_token uuid, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.visit_reward_mail set sent_at = case when p_error is null then now() else null end,
    next_attempt_at = now() + (least(360, power(2,least(attempts,8))::integer) * interval '1 minute'),
    lease_token = null, lease_until = null, last_error = left(p_error,1000)
    where id = p_id and lease_token = p_token and sent_at is null;
$$;
revoke all on function public.claim_visit_reward_mail(), public.finish_visit_reward_mail(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_visit_reward_mail(), public.finish_visit_reward_mail(uuid,uuid,text) to service_role;

create or replace function public.check_in(p_code text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tz text := (select value from public.pantry_settings where key = 'timezone');
  v_month date := date_trunc('month', now() at time zone v_tz)::date;
  v_close timestamptz; v_at timestamptz; v_reward uuid;
begin
  if not public.is_uta_user() then raise exception 'Sign in with a UTA email to check in'; end if;
  if p_code is distinct from (select value from public.pantry_settings where key = 'checkin_code') then raise exception 'That QR code is not valid. Scan the code posted at the pantry.'; end if;
  perform public.expire_user_visit_rewards(v_uid);
  select max(checked_in_at) into v_at from (
    select checked_in_at from public.pantry_checkins where user_id = v_uid
    union all select checked_in_at from public.extra_pantry_checkins where user_id = v_uid
  ) visits;
  if v_at > now() - interval '30 minutes' then return v_at; end if;

  if public.pantry_gates_on() and not exists(select 1 from public.pantry_gate_exempt where user_id = v_uid) then
    v_close := public.pantry_closes_at();
    if v_close is null then raise exception 'The pantry is closed right now. Check in when you are at the pantry during open hours.'; end if;
    if v_close - now() < interval '15 minutes' then raise exception 'The pantry is about to close, so check-in is closed for today. Your visit was not used.'; end if;
  end if;
  if not exists(select 1 from public.pantry_checkins where user_id = v_uid and visit_month = v_month) then
    insert into public.pantry_checkins(user_id,visit_month) values(v_uid,v_month) returning checked_in_at into v_at;
    return v_at;
  end if;
  select id into v_reward from public.visit_reward_requests where user_id = v_uid and status = 'approved' and expires_at > now() for update;
  if not found then
    if exists(select 1 from public.visit_reward_requests where user_id = v_uid and status = 'pending') then raise exception 'Your extra visit is awaiting approval. Your regular visit this month is already used.'; end if;
    if exists(select 1 from public.visit_reward_requests where user_id = v_uid and status = 'expired') then raise exception 'Your extra visit expired and its points were returned. Request a new approval, or check in next month.'; end if;
    raise exception 'You already checked in this month. Any previous extra visit has been used or is unavailable. Request an extra visit with 100 points, or check in next month.';
  end if;
  insert into public.extra_pantry_checkins(user_id,request_id) values(v_uid,v_reward) returning checked_in_at into v_at;
  update public.visit_reward_requests set status = 'used', used_at = v_at where id = v_reward;
  return v_at;
end;
$$;
-- Preserve all existing inventory gates, extending presence to extra check-ins.
create or replace function public.assert_can_update_stock() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pantry_gates_on() then return; end if;
  if exists(select 1 from public.pantry_gate_exempt where user_id = auth.uid()) then return; end if;
  if public.pantry_closes_at() is null then raise exception 'The pantry is closed. Stock can only be updated during pantry hours.'; end if;
  if not exists(select 1 from public.pantry_checkins where user_id = auth.uid() and checked_in_at > now() - interval '30 minutes')
    and not exists(select 1 from public.extra_pantry_checkins where user_id = auth.uid() and checked_in_at > now() - interval '30 minutes') then
    raise exception 'Check in at the pantry first by scanning the QR code posted there. Check-ins last 30 minutes.';
  end if;
end;
$$;
