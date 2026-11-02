-- Lets the item dialog tell the reporter of a pending status apart from everyone else, so it can
-- offer "confirm" only to students who are allowed to confirm. A boolean rather than the reporter's
-- user id so the public view still exposes no user ids. Same columns as
-- 20261015010000_status_verification.sql plus 'reported_by_me' on the end. auth.uid() is null for
-- anon, so it is always false there.
create or replace view public.available_items as
  select
    i.id,
    i.name,
    i.categories[1] as category,
    i.thumbnail_path,
    i.status as availability,
    i.limit_per_visit,
    i.status_updated_at as updated_at,
    p.display_name as updated_by_name,
    (i.status_updated_by is not null and not i.status_verified) as pending,
    coalesce(i.status_updated_by is not null and not i.status_verified
      and i.status_updated_by = auth.uid(), false) as reported_by_me
  from public.items i
  left join public.profiles p on p.user_id = i.status_updated_by
  where not ('other' = any (i.categories));
