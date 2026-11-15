-- Google sign-in and email/password accounts share the same email policy.
-- Keep the legacy helper name because existing RLS policies use it.
-- Approval access remains independently allowlisted; Gmail signup grants no review role.
create or replace function public.is_pantry_email(p_email text) returns boolean
language sql immutable as $$
  select coalesce(lower(p_email),'') ~ '^[^@[:space:]]+@((mavs\.)?uta\.edu|gmail\.com)$';
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_pantry_email(new.email) then
    raise exception 'Use your @uta.edu, @mavs.uta.edu, or @gmail.com email address';
  end if;
  insert into public.profiles(user_id,display_name) values(
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'),''),
      nullif(trim(new.raw_user_meta_data->>'full_name'),''),
      nullif(trim(new.raw_user_meta_data->>'name'),''),
      split_part(new.email,'@',1)
    ),40)
  );
  return new;
end;
$$;

create or replace function public.is_uta_user() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from auth.users u
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null
      and public.is_pantry_email(u.email)
  );
$$;
revoke all on function public.is_uta_user() from public;
grant execute on function public.is_uta_user() to anon,authenticated,service_role;
notify pgrst,'reload schema';
