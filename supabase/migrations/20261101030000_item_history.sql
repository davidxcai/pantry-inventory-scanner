-- Recent updates to one item for the item dialog's timeline (direction plan P-10). Public like
-- available_items: anyone can see who changed an item and when, by display name only (no user ids).

-- ---------- keep the updater's name after account deletion ----------

-- Deleting a user nulls item_status_log.user_id and cascades away their profile, which would leave
-- the timeline nameless. Each row keeps a copy of the display name taken when it was written.
alter table public.item_status_log add column user_name text;

update public.item_status_log l set user_name = p.display_name
  from public.profiles p where p.user_id = l.user_id;

create function public.fill_status_log_user_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_name is null and new.user_id is not null then
    select display_name into new.user_name from public.profiles where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger item_status_log_user_name before insert on public.item_status_log
  for each row execute function public.fill_status_log_user_name();

-- ---------- history ----------

-- Security definer because item_status_log has no client access. The current profile name wins
-- over the copy, so a renamed user shows their new name. Items hidden from the catalog (the
-- 'other' category) return nothing. At most 20 rows per call.
create function public.item_history(p_item_id uuid, p_limit int default 5)
returns table (status text, kind text, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.status, l.kind, coalesce(p.display_name, l.user_name), l.created_at
  from public.item_status_log l
  join public.items i on i.id = l.item_id
  left join public.profiles p on p.user_id = l.user_id
  where l.item_id = p_item_id and not ('other' = any (i.categories))
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;
revoke all on function public.item_history(uuid, int) from public;
grant execute on function public.item_history(uuid, int) to anon, authenticated;
