-- Let a user cancel one of their own photos that is stuck in the queue (never identified, failed,
-- waiting for quota, or left in 'processing' by a timed-out function).
-- A cancelled job is final: the API cannot claim it, and the resolve functions refuse it.

alter table public.intake_jobs drop constraint if exists intake_jobs_status_check;
alter table public.intake_jobs add constraint intake_jobs_status_check
  check (status in ('queued', 'processing', 'green', 'yellow', 'red', 'waiting_quota', 'rejected', 'cancelled'));

-- Same as before, plus: a cancelled job cannot be resolved by anyone, including an identify run
-- that was already in flight when the user cancelled.
create or replace function public.lock_job(p_job_id uuid) returns public.intake_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job public.intake_jobs;
begin
  if auth.uid() is not null and not public.is_uta_user() then
    raise exception 'sign in with a UTA email';
  end if;
  select * into v_job from public.intake_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found'; end if;
  if auth.uid() is not null and v_job.created_by <> auth.uid() then
    raise exception 'job not found';
  end if;
  if v_job.status = 'cancelled' then raise exception 'job cancelled'; end if;
  return v_job;
end;
$$;
revoke all on function public.lock_job(uuid) from public, anon, authenticated;

-- Only jobs that never produced an item can be cancelled; once an item exists the photo has
-- already changed the catalog, so cancelling would not undo anything.
create function public.cancel_intake_job(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_job public.intake_jobs := public.lock_job(p_job_id);
begin
  if v_job.item_id is not null or v_job.status in ('green', 'rejected') then
    raise exception 'this photo is already done';
  end if;
  update public.intake_jobs set status = 'cancelled', error = null where id = p_job_id;
end;
$$;
revoke all on function public.cancel_intake_job(uuid) from public, anon;
grant execute on function public.cancel_intake_job(uuid) to authenticated;
