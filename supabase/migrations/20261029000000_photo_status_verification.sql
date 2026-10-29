-- Photos follow the two-student verification too. apply_item_status (used by resolve_job_existing
-- and resolve_job_new when a photo sets an item's status) used to stamp the uploader as the reporter
-- every time and never touch status_verified. So a second student's photo never confirmed the first
-- report, the first student's next photo took the report back as their own (still pending, forever),
-- and a photo that changed the status of a verified item left it marked verified.
--
-- Now, like set_item_status: the same status as a pending report from someone else confirms it, the
-- same status otherwise is a no-op, and a different status is a new pending report. The cooldown and
-- the 'out' cap stay on set_item_status only: a photo job resolves in the background and must not fail.

create or replace function public.apply_item_status(p_item_id uuid, p_status text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items%rowtype;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found then raise exception 'item not found'; end if;

  -- Same status as the current report (never for legacy rows with no reporter).
  if v_item.status_updated_by is not null and v_item.status = p_status then
    if not v_item.status_verified and v_item.status_updated_by <> p_user then
      update public.items set status_verified = true where id = p_item_id;
      insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, p_user, 'confirm');
    end if;
    return;
  end if;

  update public.items
    set status = p_status, status_updated_at = now(), status_updated_by = p_user, status_verified = false
    where id = p_item_id;
  insert into public.item_status_log (item_id, status, user_id, kind) values (p_item_id, p_status, p_user, 'report');
end;
$$;
revoke all on function public.apply_item_status(uuid, text, uuid) from public, anon, authenticated;
