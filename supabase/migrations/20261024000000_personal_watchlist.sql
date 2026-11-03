-- Personal saved products. Saving an item does not change its stock or require pantry check-in.
create table public.watchlist_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index watchlist_items_item on public.watchlist_items (item_id);
create index watchlist_items_recent on public.watchlist_items (user_id, created_at desc, item_id);

alter table public.watchlist_items enable row level security;
revoke all on public.watchlist_items from public, anon, authenticated;
grant select, insert, delete on public.watchlist_items to authenticated;
grant all on public.watchlist_items to service_role;

create policy watchlist_select_own on public.watchlist_items for select to authenticated
  using (public.is_uta_user() and user_id = (select auth.uid()));

create policy watchlist_insert_own on public.watchlist_items for insert to authenticated
  with check (
    public.is_uta_user() and user_id = (select auth.uid())
    and exists (select 1 from public.available_items i where i.id = item_id)
  );

-- Allow removing saved products even if they have since been hidden from the catalog.
create policy watchlist_delete_own on public.watchlist_items for delete to authenticated
  using (public.is_uta_user() and user_id = (select auth.uid()));
