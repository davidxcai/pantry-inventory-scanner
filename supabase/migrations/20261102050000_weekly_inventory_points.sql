-- One earned point per product/account per rolling 168 hours. Stock reports still save.
-- Requires 20261028000000_inventory_points.sql; independent of visit redemption setup.
alter table public.inventory_point_awards drop constraint inventory_point_awards_user_id_item_id_key;
alter table public.inventory_point_awards drop constraint inventory_point_awards_user_id_product_key_key;
create unique index inventory_points_source_once on public.inventory_point_awards(source_log_id) where source_log_id is not null;
create index inventory_points_product_recent on public.inventory_point_awards(user_id, product_key, created_at desc);
create index inventory_points_item_recent on public.inventory_point_awards(user_id, item_id, created_at desc);

alter table public.item_status_log add column source_job_id uuid references public.intake_jobs(id) on delete set null;
create table public.inventory_point_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,
  job_id uuid references public.intake_jobs(id) on delete set null,
  source_log_id uuid unique references public.item_status_log(id) on delete set null,
  item_name text not null,
  outcome text not null check(outcome in ('earned','cooldown')),
  next_eligible_at timestamptz not null,
  created_at timestamptz not null
);
create index inventory_activity_jobs on public.inventory_point_activity(user_id, job_id);
create index inventory_activity_recent on public.inventory_point_activity(user_id, created_at desc);
alter table public.inventory_point_activity enable row level security;
revoke all on public.inventory_point_activity from public, anon, authenticated;
grant select on public.inventory_point_activity to authenticated;
grant all on public.inventory_point_activity to service_role;
create policy inventory_activity_own on public.inventory_point_activity for select to authenticated
  using (public.is_uta_user() and user_id = (select auth.uid()));

create function public.record_inventory_point(p_log_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_log public.item_status_log; v_item public.items; v_key text;
  v_previous timestamptz; v_existing timestamptz; v_outcome text; v_next timestamptz;
begin
  select * into v_log from public.item_status_log where id = p_log_id;
  if not found or v_log.user_id is null then return; end if;
  select * into v_item from public.items where id = v_log.item_id;
  if not found then return; end if;
  v_key := public.inventory_reward_product_key(v_item.name, v_item.brand);
  if v_key = '' then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_log.user_id::text, 0));
  if exists(select 1 from public.inventory_point_activity where source_log_id = p_log_id) then return; end if;
  select created_at into v_existing from public.inventory_point_awards where source_log_id = p_log_id;
  if found then
    v_outcome := 'earned'; v_next := v_existing + interval '168 hours';
  else
    -- Both identity and item ID matter: duplicate rows and renamed entries cannot bypass the cooldown.
    -- The upper bound also protects historical recovery against a newer existing award.
    select max(created_at) into v_previous from public.inventory_point_awards
      where user_id = v_log.user_id and (item_id = v_item.id or product_key = v_key)
        and created_at > v_log.created_at - interval '168 hours'
        and created_at < v_log.created_at + interval '168 hours';
    if v_previous is null then
      insert into public.inventory_point_awards(user_id,item_id,product_key,item_name,source_log_id,created_at)
        values(v_log.user_id,v_item.id,v_key,v_item.name,p_log_id,v_log.created_at);
      v_outcome := 'earned'; v_next := v_log.created_at + interval '168 hours';
    else
      v_outcome := 'cooldown'; v_next := v_previous + interval '168 hours';
    end if;
  end if;
  insert into public.inventory_point_activity(user_id,item_id,job_id,source_log_id,item_name,outcome,next_eligible_at,created_at)
    values(v_log.user_id,v_item.id,v_log.source_job_id,p_log_id,v_item.name,v_outcome,v_next,v_log.created_at);
end;
$$;
revoke all on function public.record_inventory_point(uuid) from public, anon, authenticated;
create or replace function public.award_inventory_point() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.record_inventory_point(new.id);
  return new;
end;
$$;

-- Exact attribution to a photo job, shared with regular reports and shelf confirmations.
create function public.apply_item_status(p_item_id uuid,p_status text,p_user uuid,p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_item public.items;
begin
  select * into v_item from public.items where id=p_item_id for update;
  if not found then raise exception 'item not found'; end if;
  if v_item.status_updated_by is not null and v_item.status=p_status then
    -- Keep the existing reporter/verification state on repeat photos. Only another
    -- student's matching photo can verify a pending report; the point receipt is independent.
    if not v_item.status_verified and v_item.status_updated_by <> p_user then
      update public.items set status_verified=true where id=p_item_id;
    end if;
    insert into public.item_status_log(item_id,status,user_id,kind,source_job_id)
      values(p_item_id,p_status,p_user,case when v_item.status_updated_by=p_user then 'report' else 'confirm' end,p_job_id);
    return;
  end if;
  update public.items set status=p_status,status_updated_at=now(),status_updated_by=p_user,status_verified=false where id=p_item_id;
  insert into public.item_status_log(item_id,status,user_id,kind,source_job_id) values(p_item_id,p_status,p_user,'report',p_job_id);
end;
$$;
revoke all on function public.apply_item_status(uuid,text,uuid,uuid) from public, anon, authenticated;
create or replace function public.apply_item_status(p_item_id uuid,p_status text,p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.apply_item_status(p_item_id,p_status,p_user,null);
end;
$$;

create or replace function public.resolve_job_existing(p_job_id uuid, p_item_id uuid, p_model text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_job public.intake_jobs := public.lock_job(p_job_id);
  v_actor uuid := coalesce(auth.uid(), v_job.created_by);
begin
  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'item not found';
  end if;
  if v_job.item_id is not null then return v_job.item_id; end if; -- already resolved

  perform public.apply_item_status(p_item_id, v_job.availability, v_actor, v_job.id);

  update public.intake_jobs
  set item_id = p_item_id, status = 'green', model_used = coalesce(p_model, model_used), error = null
  where id = p_job_id;

  if auth.uid() is not null then
    insert into public.item_images (item_id, storage_path, source)
    values (p_item_id, v_job.photo_path, 'user_confirmed');
  end if;
  return p_item_id;
end;
$$;

create or replace function public.resolve_job_new(
  p_job_id uuid,
  p_name text,
  p_brand text,
  p_size text,
  p_categories text[],
  p_status text default 'green',
  p_model text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_job public.intake_jobs := public.lock_job(p_job_id);
  v_actor uuid := coalesce(auth.uid(), v_job.created_by);
  v_item_id uuid;
  v_key text;
  v_new boolean := false;
begin
  if p_status not in ('green', 'yellow') then raise exception 'bad status'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'name required'; end if;
  if exists (select 1 from unnest(p_categories) c where c not in (select slug from public.categories)) then
    raise exception 'unknown category';
  end if;
  if v_job.item_id is not null then return v_job.item_id; end if;

  v_key := public.inventory_reward_product_key(p_name,p_brand);
  if v_key = '' then raise exception 'name required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog-product:' || v_key,0));
  select id into v_item_id from public.items where public.inventory_reward_product_key(name,brand)=v_key order by created_at,id limit 1;
  if v_item_id is null then
  insert into public.items (name, brand, size, categories, thumbnail_path, created_by)
  values (btrim(p_name), nullif(btrim(p_brand), ''), nullif(btrim(p_size), ''), p_categories,
          v_job.id::text || '.jpg', v_actor)
  returning id into v_item_id;

    v_new := true;
  end if;

  perform public.apply_item_status(v_item_id, v_job.availability, v_actor, v_job.id);

  update public.intake_jobs
  set item_id = v_item_id, status = case when v_new then p_status else 'green' end, model_used = coalesce(p_model, model_used), error = null
  where id = p_job_id;

  if auth.uid() is not null then
    insert into public.item_images (item_id, storage_path, source)
    values (v_item_id, v_job.photo_path, 'user_confirmed');
  end if;
  return v_item_id;
end;
$$;

create or replace function public.set_item_status(p_item_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c_out_cap constant int := 30;
  c_cooldown constant interval := interval '10 minutes';
  v_uid uuid := auth.uid();
  v_item public.items%rowtype;
  v_own_pending boolean;
begin
  if v_uid is null or not public.is_uta_email(auth.jwt() ->> 'email') then
    raise exception 'sign in with a UTA email to update stock';
  end if;
  if p_status not in ('in_stock', 'low', 'out') then
    raise exception 'invalid status';
  end if;
  perform public.assert_can_update_stock();

  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;

  -- Same status as the current report: this is a confirmation (never for legacy rows with no reporter).
  if v_item.status_updated_by is not null and v_item.status = p_status then
    if v_item.status_verified then
      update public.items set status_updated_at=now(), status_updated_by=v_uid where id=p_item_id;
      insert into public.item_status_log(item_id,status,user_id,kind) values(p_item_id,p_status,v_uid,'confirm');
      return;
    end if;
    if v_item.status_updated_by = v_uid and v_item.status_updated_at > now() - interval '168 hours' then
      raise exception 'you already reported this; another student needs to confirm it';
    end if;
    update public.items set status_verified = status_updated_by is distinct from v_uid, status_updated_at=now() where id = p_item_id;
    insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, v_uid, case when v_item.status_updated_by = v_uid then 'report' else 'confirm' end);
    return;
  end if;

  -- A new report. Fixing your own still-pending report is always allowed.
  v_own_pending := v_item.status_updated_by = v_uid and not v_item.status_verified;
  if not v_own_pending and exists (
    select 1 from public.item_status_log
    where item_id = p_item_id and user_id = v_uid and created_at > now() - c_cooldown
  ) then
    raise exception 'you updated this item a moment ago; try again in a few minutes';
  end if;

  if p_status = 'out' then
    -- Serialize per user so parallel calls cannot slip past the cap.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
    if (select count(*) from public.items
        where status_updated_by = v_uid and status = 'out' and not status_verified) >= c_out_cap then
      raise exception 'you have % out-of-stock reports waiting for another student to confirm', c_out_cap;
    end if;
  end if;

  update public.items
    set status = p_status, status_updated_at = now(), status_updated_by = v_uid, status_verified = false
    where id = p_item_id;
  insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, v_uid, 'report');
end;
$$;

-- Recover successful reports from the last seven days missed while earning was uninstalled.
-- Existing source IDs/weekly awards suppress retries and duplicate-product history.
do $$
declare v_log uuid;
begin
  for v_log in select id from public.item_status_log
    where user_id is not null and created_at >= now() - interval '168 hours' and created_at <= now()
    order by created_at,id loop
    perform public.record_inventory_point(v_log);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
