-- Stock update notifications (docs/notifications-plan.md).
-- A signed-in student watches an item. Every row written to item_status_log (a report, a
-- confirmation, a close-up photo, a shelf scan) queues one notification per watcher, except the
-- student who made the update. /api/notify drains the queue and sends one digest email per user.

-- ---------- watches ----------

create table public.item_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- When the user last looked at their watching list. Drives the in-app "changed" badge.
  last_seen_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
-- The trigger below looks watchers up by item.
create index item_subscriptions_by_item on public.item_subscriptions (item_id);

alter table public.item_subscriptions enable row level security;
create policy item_subscriptions_select_own on public.item_subscriptions for select to authenticated
  using (public.is_uta_user() and user_id = (select auth.uid()));
create policy item_subscriptions_insert_own on public.item_subscriptions for insert to authenticated
  with check (public.is_uta_user() and user_id = (select auth.uid()));
create policy item_subscriptions_delete_own on public.item_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
-- last_seen_at moves only through mark_watches_seen().
revoke update, truncate on public.item_subscriptions from anon, authenticated;
revoke all on public.item_subscriptions from anon;

-- ---------- queue ----------

-- Written only by the trigger, read and marked by the API with the service role. No client access.
-- type leaves room for other notification kinds later (e.g. predicted restocks).
create table public.notification_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  status text not null check (status in ('in_stock', 'low', 'out')),
  kind text not null check (kind in ('report', 'confirm')),
  type text not null default 'status_update' check (type in ('status_update')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_queue_unsent on public.notification_queue (created_at) where sent_at is null;
alter table public.notification_queue enable row level security; -- no policies: service role only
revoke all on public.notification_queue from anon, authenticated;

create function public.queue_status_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_queue (user_id, item_id, status, kind)
  select s.user_id, new.item_id, new.status, new.kind
  from public.item_subscriptions s
  where s.item_id = new.item_id and s.user_id is distinct from new.user_id;
  return new;
end;
$$;
revoke all on function public.queue_status_notifications() from public, anon, authenticated;

-- Same transaction as the status change, so the queue never disagrees with the log.
create trigger item_status_log_notify after insert on public.item_status_log
  for each row execute function public.queue_status_notifications();

-- ---------- client functions ----------

-- The user's watches, each flagged if someone else updated the item since they last looked.
-- Security definer because item_status_log has no client access; only the flag leaves it.
create function public.my_watches()
returns table (item_id uuid, created_at timestamptz, changed boolean)
language sql stable security definer set search_path = public as $$
  select s.item_id, s.created_at, exists (
    select 1 from public.item_status_log l
    where l.item_id = s.item_id and l.created_at > s.last_seen_at
      and l.user_id is distinct from s.user_id
  )
  from public.item_subscriptions s
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;
revoke all on function public.my_watches() from public, anon;
grant execute on function public.my_watches() to authenticated;

create function public.mark_watches_seen() returns void
language sql security definer set search_path = public as $$
  update public.item_subscriptions set last_seen_at = now() where user_id = auth.uid();
$$;
revoke all on function public.mark_watches_seen() from public, anon;
grant execute on function public.mark_watches_seen() to authenticated;

-- ---------- sender functions (service role) ----------

-- Claims up to p_users users' unsent rows by marking them sent, so overlapping runs never send
-- the same row twice. Rows for items the user stopped watching are marked but not returned.
-- If sending fails the API calls release_notifications() to put them back.
create function public.claim_notifications(p_users int)
returns table (id bigint, user_id uuid, item_id uuid, item_name text, status text, kind text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with users as (
    select q.user_id from public.notification_queue q
    where q.sent_at is null
    group by q.user_id
    order by min(q.created_at)
    limit p_users
  ), claimed as (
    update public.notification_queue q set sent_at = now()
    where q.id in (
      select q2.id from public.notification_queue q2
      where q2.sent_at is null and q2.user_id in (select u.user_id from users u)
      for update skip locked
    )
    returning q.*
  )
  select c.id, c.user_id, c.item_id, i.name, c.status, c.kind, c.created_at
  from claimed c
  join public.items i on i.id = c.item_id
  where exists (select 1 from public.item_subscriptions s where s.user_id = c.user_id and s.item_id = c.item_id);
end;
$$;
revoke all on function public.claim_notifications(int) from public, anon, authenticated;

create function public.release_notifications(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.notification_queue set sent_at = null where id = any (p_ids);
$$;
revoke all on function public.release_notifications(bigint[]) from public, anon, authenticated;
