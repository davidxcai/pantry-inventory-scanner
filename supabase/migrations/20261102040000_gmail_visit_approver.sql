-- A single Gmail registration exception for the designated visit reviewer.
-- This does not make Gmail accounts students or automatically grant approval access.
-- A trusted operator must add the verified auth user to visit_reward_approvers.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_uta_email(new.email) and lower(coalesce(new.email,'')) <> 'salmanfarse2025@gmail.com' then
    raise exception 'Only UTA emails or the designated visit approver account can register';
  end if;
  insert into public.profiles(user_id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40));
  return new;
end;
$$;

create or replace function public.is_visit_reward_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.visit_reward_approvers a join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid() and u.email_confirmed_at is not null
      and (public.is_uta_email(u.email) or lower(u.email) = 'salmanfarse2025@gmail.com'));
$$;

create or replace function public.request_extra_visit(p_request_id uuid) returns uuid
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
  if not exists(select 1 from public.visit_reward_approvers a join auth.users u on u.id = a.user_id where u.email_confirmed_at is not null and (public.is_uta_email(u.email) or lower(u.email) = 'salmanfarse2025@gmail.com')) then raise exception 'An approver must be configured first'; end if;
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
