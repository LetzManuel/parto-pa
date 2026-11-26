-- Shopping and food orders: baskets ("Einkaufslisten") with an optional rhythm, and the history of orders the user
-- confirmed. PA never orders by itself; these rows only hold what the user prepared and confirmed.
-- Personal space only (like memory): what someone buys is private, a family group gets its own lists via People later.
create table if not exists public.shop_list (
  id uuid primary key, space_id uuid not null references public.groups (id),
  name text not null, kind text not null, platform_id text, store_url text, items text not null default '',
  every_n int, every_unit text, weekday int, next_date date, lead_days int not null default 1,
  handed_on date, last_ordered date, state text not null default 'active',
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.shop_run (
  id uuid primary key, space_id uuid not null references public.groups (id),
  list_id uuid, platform_id text, date date not null, items text not null,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);

do $$
declare t text;
begin
  foreach t in array array['shop_list', 'shop_run'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_personal', t);
    execute format('create policy %I on public.%I for all using (public.is_personal_space(space_id) and public.has_app(''pa''))
                    with check (public.is_personal_space(space_id) and public.has_app(''pa''))', t || '_personal', t);
    execute format('create index if not exists %I on public.%I (space_id)', t || '_space', t);
    execute format('alter table public.%I add column if not exists synced_at timestamptz not null default clock_timestamp()', t);
    execute format('create index if not exists %I on public.%I (synced_at)', t || '_synced', t);
    execute format('drop trigger if exists keep_newer on public.%I', t);
    execute format('create trigger keep_newer before insert or update on public.%I for each row execute function public.pa_keep_newer()', t);
  end loop;
end $$;
