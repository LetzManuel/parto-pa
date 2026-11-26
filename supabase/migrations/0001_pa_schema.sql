-- Parto PA cloud schema (draft, not applied yet). EU region, same conventions as Parto Projects.
-- Personal space = a group of kind 'personal' with exactly one member. Parto People will add groups of kind
-- 'family' to the same tables, so PA can show family rows through normal membership without copying data.

create table if not exists public.parto_group (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal', 'family')),
  name text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- one personal space per person
create unique index if not exists parto_group_one_personal on public.parto_group (created_by) where kind = 'personal';

create table if not exists public.group_member (
  group_id uuid not null references public.parto_group (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  primary key (group_id, user_id)
);

-- Which private apps a person may use (Parto ID: one login for People, Place, PA).
create table if not exists public.user_app (
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('people', 'place', 'pa')),
  tier text not null default 'free',
  primary key (user_id, app)
);

create or replace function public.is_group_member(p_group uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_member where group_id = p_group and user_id = auth.uid())
$$;

create or replace function public.is_personal_space(p_group uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from parto_group g join group_member m on m.group_id = g.id
    where g.id = p_group and g.kind = 'personal' and m.user_id = auth.uid())
$$;

create or replace function public.has_app(p_app text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_app where user_id = auth.uid() and app = p_app)
$$;

-- Creates (or returns) the caller's personal space. Called by the app after sign-in.
create or replace function public.ensure_personal_space() returns uuid
  language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into g from parto_group where created_by = auth.uid() and kind = 'personal';
  if g is null then
    insert into parto_group (kind, name, created_by) values ('personal', 'Ich', auth.uid()) returning id into g;
    insert into group_member (group_id, user_id, role) values (g, auth.uid(), 'owner');
  end if;
  insert into user_app (user_id, app) values (auth.uid(), 'pa') on conflict do nothing;
  return g;
end $$;

-- Synced tables: columns mirror src/core/db/schema.ts (snake_case), plus space_id and soft delete.
create table if not exists public.pa_order (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  title text not null, kind text not null, state text not null, due_date date, wait_days int not null default 2,
  waiting_for text, fallback text, place text, every_n int, every_unit text, lead_days int not null default 14,
  last_done date, provider_id uuid, source text, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.provider (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  name text not null, category text not null, service text, phone text, email text, website text,
  booking_way text not null, every_n int, every_unit text, last_visit date, contact_person text, notes text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.deadline (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  title text not null, kind text not null, due_date date not null, lead_days int not null,
  every_n int, every_unit text, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.memory (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  text text not null, category text not null, source text not null,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.cal_event (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  title text not null, date date not null, start text, "end" text, tentative boolean not null default false, order_id uuid,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.memo (
  id uuid primary key, space_id uuid not null references public.parto_group (id) on delete cascade,
  text text not null, result text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);

alter table public.parto_group enable row level security;
alter table public.group_member enable row level security;
alter table public.user_app enable row level security;
create policy parto_group_read on public.parto_group for select using (public.is_group_member(id));
create policy group_member_read on public.group_member for select using (public.is_group_member(group_id));
create policy user_app_read on public.user_app for select using (user_id = auth.uid());

-- Orders, providers, deadlines, events: any group the person belongs to (family rows later via People).
do $$
declare t text;
begin
  foreach t in array array['pa_order', 'provider', 'deadline', 'cal_event'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (public.is_group_member(space_id) and public.has_app(''pa''))
                    with check (public.is_group_member(space_id) and public.has_app(''pa''))', t || '_member', t);
  end loop;
  -- Memory and memos stay personal: never visible in a family group, not even to its members.
  foreach t in array array['memory', 'memo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (public.is_personal_space(space_id) and public.has_app(''pa''))
                    with check (public.is_personal_space(space_id) and public.has_app(''pa''))', t || '_personal', t);
  end loop;
end $$;
