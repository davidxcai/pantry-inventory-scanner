-- Saved products stay unchanged. Wishlist is a separate, explicit opt-in for saved out-of-stock products.
-- The prior draft of this migration was never applied to the hosted project.
create table public.wishlist_items (
  user_id uuid not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(user_id,item_id),
  foreign key(user_id,item_id) references public.watchlist_items(user_id,item_id) on delete cascade
);
create index wishlist_items_product on public.wishlist_items(item_id);
alter table public.wishlist_items enable row level security;
revoke all on public.wishlist_items from public,anon,authenticated;
grant select on public.wishlist_items to authenticated;
grant all on public.wishlist_items to service_role;
create policy wishlist_read_own on public.wishlist_items for select to authenticated
  using(public.is_uta_user() and user_id=(select auth.uid()));
create function public.set_wishlist_item(p_item_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  if not public.is_uta_user() then raise exception 'Sign in with your UTA account'; end if;
  if p_enabled is null then raise exception 'Wishlist choice is required'; end if;
  if not p_enabled then
    delete from public.wishlist_items where user_id=auth.uid() and item_id=p_item_id;
    return;
  end if;
  -- Serialize subscription with availability transitions, so a concurrent restock cannot be missed.
  select status into v_status from public.items where id=p_item_id for update;
  if not found then raise exception 'Product not found'; end if;
  perform 1 from public.watchlist_items where user_id=auth.uid() and item_id=p_item_id for key share;
  if not found then raise exception 'Save this product before adding it to your wishlist'; end if;
  if exists(select 1 from public.wishlist_items where user_id=auth.uid() and item_id=p_item_id) then return; end if;
  if v_status<>'out' or not exists(select 1 from public.available_items where id=p_item_id and availability='out') then
    raise exception 'Only out-of-stock saved products can be added to the wishlist';
  end if;
  insert into public.wishlist_items(user_id,item_id) values(auth.uid(),p_item_id) on conflict do nothing;
end;
$$;
revoke all on function public.set_wishlist_item(uuid,boolean) from public,anon;
grant execute on function public.set_wishlist_item(uuid,boolean) to authenticated;
-- Watching is retired. Its historical rows remain intact; they are not automatically saved or wishlisted.
revoke insert,update,delete on public.item_subscriptions from authenticated;

create table public.wishlist_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true
);
alter table public.wishlist_email_preferences enable row level security;
revoke all on public.wishlist_email_preferences from public,anon,authenticated;
grant all on public.wishlist_email_preferences to service_role;

create function public.get_wishlist_email_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_uta_user() then raise exception 'Sign in with your UTA account'; end if;
  return jsonb_build_object('enabled',coalesce((select enabled from public.wishlist_email_preferences where user_id=auth.uid()),true));
end;
$$;
create function public.set_wishlist_email_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_uta_user() then raise exception 'Sign in with your UTA account'; end if;
  if p_enabled is null then raise exception 'Email preference is required'; end if;
  insert into public.wishlist_email_preferences(user_id,enabled) values(auth.uid(),p_enabled)
    on conflict(user_id) do update set enabled=excluded.enabled;
end;
$$;
create function public.stop_wishlist_emails(p_user_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.wishlist_email_preferences(user_id,enabled) values(p_user_id,false)
    on conflict(user_id) do update set enabled=false;
$$;
revoke all on function public.get_wishlist_email_settings(),public.set_wishlist_email_enabled(boolean) from public,anon;
grant execute on function public.get_wishlist_email_settings(),public.set_wishlist_email_enabled(boolean) to authenticated;
revoke all on function public.stop_wishlist_emails(uuid) from public,anon,authenticated;
grant execute on function public.stop_wishlist_emails(uuid) to service_role;

-- Retire unsent "any update" notices. No old low/out/confirmation emails leak into Wishlist.
update public.notification_queue set sent_at=now() where sent_at is null;
alter table public.notification_queue drop constraint notification_queue_type_check;
alter table public.notification_queue add constraint notification_queue_type_check check(type in ('status_update','wishlist_available'));
alter table public.notification_queue add column claim_token uuid, add column claimed_until timestamptz;
-- Keep the old log trigger harmless for older migrations and existing integrations.
create or replace function public.queue_status_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin return new; end;
$$;

create function public.queue_wishlist_availability() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status='out' and new.status in ('in_stock','low')
    and exists(select 1 from public.available_items where id=new.id) then
    insert into public.notification_queue(user_id,item_id,status,kind,type)
      select w.user_id,new.id,new.status,case when new.status_verified then 'confirm' else 'report' end,'wishlist_available'
      from public.wishlist_items w
      left join public.wishlist_email_preferences p on p.user_id=w.user_id
      where w.item_id=new.id and coalesce(p.enabled,true);
  end if;
  return new;
end;
$$;
revoke all on function public.queue_wishlist_availability() from public,anon,authenticated;
create trigger wishlist_became_available after update of status on public.items
  for each row when(old.status is distinct from new.status) execute function public.queue_wishlist_availability();

-- Leases are separate from successful delivery. A crashed worker leaves jobs retryable.
drop function public.claim_notifications(integer);
create function public.claim_notifications(p_users integer)
returns table(id bigint,user_id uuid,item_id uuid,item_name text,status text,kind text,created_at timestamptz,claim_token uuid)
language plpgsql security definer set search_path = public as $$
declare v_token uuid:=gen_random_uuid();
begin
  -- Discard obsolete jobs, including removed/unlisted products and unsubscribed accounts.
  update public.notification_queue q set sent_at=now(),claim_token=null,claimed_until=null
    where q.sent_at is null and (q.type<>'wishlist_available' or not exists(
      select 1 from public.wishlist_items w join public.available_items i on i.id=w.item_id
      left join public.wishlist_email_preferences p on p.user_id=w.user_id
      where w.user_id=q.user_id and w.item_id=q.item_id and i.availability in ('in_stock','low') and coalesce(p.enabled,true)));
  return query
  with recipients as (
    select q.user_id from public.notification_queue q
      where q.sent_at is null and (q.claimed_until is null or q.claimed_until<=now())
      group by q.user_id order by min(q.created_at) limit greatest(0,least(coalesce(p_users,0),25))
  ), claimed as (
    update public.notification_queue q set claim_token=v_token,claimed_until=now()+interval '5 minutes'
      where q.id in(select q2.id from public.notification_queue q2 where q2.sent_at is null
        and (q2.claimed_until is null or q2.claimed_until<=now()) and q2.user_id in(select r.user_id from recipients r)
        for update skip locked)
      returning q.*
  )
  select c.id,c.user_id,c.item_id,i.name,i.status,c.kind,c.created_at,c.claim_token
    from claimed c join public.items i on i.id=c.item_id;
end;
$$;
create function public.finish_wishlist_notifications(p_ids bigint[],p_claim_token uuid,p_sent boolean) returns void
language sql security definer set search_path = public as $$
  update public.notification_queue set sent_at=case when p_sent then now() else null end,claim_token=null,claimed_until=null
    where id=any(p_ids) and claim_token=p_claim_token and sent_at is null;
$$;
revoke all on function public.claim_notifications(integer),public.finish_wishlist_notifications(bigint[],uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_notifications(integer),public.finish_wishlist_notifications(bigint[],uuid,boolean) to service_role;
notify pgrst,'reload schema';
