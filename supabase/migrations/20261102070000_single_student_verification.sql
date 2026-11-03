-- One student is enough. A status report is verified as soon as it is made; there is no "pending"
-- state waiting for a second student any more. Two-student confirmation was too strict for the
-- traffic the pantry gets: most reports stayed "Pending verification" forever.
--
-- Builds on 20261102050000_weekly_inventory_points.sql (it must run after it, which is why this file
-- sorts last): set_item_status and apply_item_status keep that migration's behaviour, including the
-- log row written when someone re-checks an item that already shows the status (points are awarded
-- from item_status_log). Only the pending/confirmation branches are gone:
--   * every new report sets status_verified = true;
--   * repeating the current status refreshes who checked it and logs a 'confirm' row, as a repeat of
--     a verified status already did; the "you already reported this" error is gone;
--   * the 10-minute cooldown stays; fixing your own report (you are the current reporter) is still
--     always allowed so a mis-tap can be fixed;
--   * the 30-report 'out' cap used to count outstanding unverified reports, which no longer exist.
--     It now counts 'out' reports made in the last 24 hours, so one account still cannot empty the
--     catalog.
--
-- status_verified and the view's pending / reported_by_me columns stay so older clients keep
-- working; every row is verified from now on, so they are always true / false / false.

create index if not exists item_status_log_user on public.item_status_log (user_id, created_at desc);

update public.items set status_verified = true where not status_verified;
alter table public.items alter column status_verified set default true;

create or replace function public.set_item_status(p_item_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c_out_cap constant int := 30;
  c_out_window constant interval := interval '24 hours';
  c_cooldown constant interval := interval '10 minutes';
  v_uid uuid := auth.uid();
  v_item public.items%rowtype;
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

  -- Already showing this status (never for legacy rows with no reporter): a re-check.
  if v_item.status_updated_by is not null and v_item.status = p_status then
    update public.items set status_updated_at = now(), status_updated_by = v_uid, status_verified = true
      where id = p_item_id;
    insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, v_uid, 'confirm');
    return;
  end if;

  if v_item.status_updated_by is distinct from v_uid and exists (
    select 1 from public.item_status_log
    where item_id = p_item_id and user_id = v_uid and created_at > now() - c_cooldown
  ) then
    raise exception 'you updated this item a moment ago; try again in a few minutes';
  end if;

  if p_status = 'out' then
    -- Serialize per user so parallel calls cannot slip past the cap.
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
    if (select count(*) from public.item_status_log
        where user_id = v_uid and status = 'out' and kind = 'report'
          and created_at > now() - c_out_window) >= c_out_cap then
      raise exception 'you have marked % items out of stock today; try again tomorrow', c_out_cap;
    end if;
  end if;

  update public.items
    set status = p_status, status_updated_at = now(), status_updated_by = v_uid, status_verified = true
    where id = p_item_id;
  insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, v_uid, 'report');
end;
$$;

-- The 3-argument wrapper from 20261102050000 calls this one and is left as it is.
create or replace function public.apply_item_status(p_item_id uuid, p_status text, p_user uuid, p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_item public.items;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;
  if v_item.status_updated_by is not null and v_item.status = p_status then
    -- Keep the existing reporter on repeat photos; the log row still earns the point.
    insert into public.item_status_log (item_id, status, user_id, kind, source_job_id)
      values (p_item_id, p_status, p_user, case when v_item.status_updated_by = p_user then 'report' else 'confirm' end, p_job_id);
    return;
  end if;
  update public.items set status = p_status, status_updated_at = now(), status_updated_by = p_user, status_verified = true
    where id = p_item_id;
  insert into public.item_status_log (item_id, status, user_id, kind, source_job_id) values (p_item_id, p_status, p_user, 'report', p_job_id);
end;
$$;
revoke all on function public.apply_item_status(uuid, text, uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
