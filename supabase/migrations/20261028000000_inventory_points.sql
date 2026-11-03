-- Rewards are account-owned and written only by trusted inventory operations.
-- No retroactive awards; each distinct product earns at most one point per account.
create function public.inventory_reward_product_key(p_name text, p_brand text) returns text
language sql immutable set search_path = public as $$
  with cleaned as (
    select regexp_replace(
      regexp_replace(lower(regexp_replace(normalize(coalesce(p_brand, '') || ' ' || coalesce(p_name, ''), NFKD), U&'[\0300-\036f]', '', 'g')), '[''’]', '', 'g'),
      '\m[0-9]+([.,][0-9]+)?\s*(fl\.?\s*oz|oz|ounces?|lbs?|pounds?|kg|g|ml|l|ct|count|pk|packs?|capsules?|softgels?|tablets?|gummies|rolls?|packets?|bags?|bottles?|cans?)\M\.?', ' ', 'g'
    ) as value
  ), tokens as (
    select regexp_split_to_table(regexp_replace(regexp_replace(value, '[^a-z0-9%.[:space:]]', ' ', 'g'), '(?<![0-9])\.|\.(?![0-9])', ' ', 'g'), '\s+') as word from cleaned
  ), singular as (
    select case when length(word) > 4 and word like '%ies' then left(word, -3) || 'y'
      when length(word) > 3 and word like '%s' and word !~ '(ss|us|is)$' then left(word, -1)
      else word end as word from tokens where word not in ('', 'the', 'a', 'an', 'of', 'and', 'with', 'for', 'in')
  ) select coalesce(string_agg(distinct word, ' ' order by word), '') from singular;
$$;

create table public.inventory_point_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null, -- keep earned points if the catalog item is later removed
  product_key text not null,
  item_name text not null,
  source_log_id uuid references public.item_status_log(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, item_id),
  unique (user_id, product_key)
);
create index inventory_point_awards_recent on public.inventory_point_awards(user_id, created_at desc);
alter table public.inventory_point_awards enable row level security;
create policy points_read_own on public.inventory_point_awards for select to authenticated
  using (public.is_uta_user() and user_id = (select auth.uid()));
revoke all on public.inventory_point_awards from public, anon, authenticated;
grant select on public.inventory_point_awards to authenticated;
grant all on public.inventory_point_awards to service_role;

create function public.award_inventory_point() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_key text;
begin
  if new.user_id is null then return new; end if;
  select * into v_item from public.items where id = new.item_id;
  if not found then return new; end if;
  v_key := public.inventory_reward_product_key(v_item.name, v_item.brand);
  if v_key = '' then return new; end if;
  insert into public.inventory_point_awards(user_id, item_id, product_key, item_name, source_log_id)
    values (new.user_id, new.item_id, v_key, v_item.name, new.id)
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.award_inventory_point() from public, anon, authenticated;
create trigger award_inventory_point after insert on public.item_status_log
  for each row execute function public.award_inventory_point();

-- Read-only summary. No redemption or appointment/check-in behavior is enabled.
-- A future redemption ledger can reference immutable award IDs without changing inventory writes.
create function public.get_inventory_points() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_earned bigint;
begin
  if not public.is_uta_user() then raise exception 'Sign in with a UTA email to view points'; end if;
  select count(*) into v_earned from public.inventory_point_awards where user_id = v_uid;
  return jsonb_build_object(
    'balance', v_earned, 'earned', v_earned, 'reward_threshold', 100,
    'recent_updates', coalesce((select jsonb_agg(row_to_json(a)) from (
      select id, item_name, created_at from public.inventory_point_awards where user_id = v_uid order by created_at desc, id limit 20
    ) a), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_inventory_points() from public, anon;
grant execute on function public.get_inventory_points() to authenticated;
