-- Parto PA on the shared Parto private cloud (parto-private-test, later production).
-- Builds on the private core that Parto People owns: groups, group_members, my_group_role / in_group.
-- PA adds: group kind 'personal' (exactly one member, the person), app licences (has_app), and its own tables.
-- A person's PA rows live in their personal group; family groups can hold shared orders later, memory never.

-- 1. Personal space as a group kind of the core.
alter table public.groups drop constraint if exists groups_kind_check;
alter table public.groups add constraint groups_kind_check check (kind in ('family', 'friends', 'club', 'personal'));
create unique index if not exists groups_one_personal on public.groups (created_by) where kind = 'personal' and not deleted;

-- 2. Which private apps a person may use (Parto ID: one login for People, Place, PA).
create table if not exists public.user_app (
  user_id uuid not null references auth.users (id) on delete cascade,
  app text not null check (app in ('people', 'place', 'pa')),
  tier text not null default 'free',
  created_at timestamptz not null default now(),
  primary key (user_id, app)
);
alter table public.user_app enable row level security;
drop policy if exists user_app_read on public.user_app;
create policy user_app_read on public.user_app for select using (user_id = auth.uid());

create or replace function public.has_app(p_app text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_app where user_id = auth.uid() and app = p_app)
$$;

create or replace function public.is_personal_space(g uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.in_group(g) and exists (select 1 from public.groups where id = g and kind = 'personal')
$$;

-- Creates (or returns) the caller's personal space and turns PA on for them. Called by the app after sign-in.
create or replace function public.ensure_personal_space() returns uuid
  language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); gid uuid; fname text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select id into gid from public.groups where created_by = uid and kind = 'personal' and not deleted;
  if gid is null then
    fname := coalesce((select first_name from public.profiles where user_id = uid), '');
    insert into public.groups (name, kind, created_by) values ('Ich', 'personal', uid) returning id into gid;
    insert into public.group_members (group_id, user_id, first_name, role) values (gid, uid, fname, 'parent');
    insert into public.group_settings (group_id) values (gid);
  end if;
  insert into public.user_app (user_id, app) values (uid, 'pa') on conflict do nothing;
  return gid;
end $$;

-- 3. PA tables. Columns mirror src/core/db/schema.ts (snake_case); space_id = the group.
create table if not exists public.pa_order (
  id uuid primary key, space_id uuid not null references public.groups (id),
  title text not null, kind text not null, state text not null, due_date date, wait_days int not null default 2,
  waiting_for text, fallback text, place text, every_n int, every_unit text, lead_days int not null default 14,
  last_done date, provider_id uuid, source text, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.provider (
  id uuid primary key, space_id uuid not null references public.groups (id),
  name text not null, category text not null, service text, phone text, email text, website text,
  booking_way text not null, every_n int, every_unit text, last_visit date, contact_person text, notes text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.deadline (
  id uuid primary key, space_id uuid not null references public.groups (id),
  title text not null, kind text not null, due_date date not null, lead_days int not null,
  every_n int, every_unit text, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.memory (
  id uuid primary key, space_id uuid not null references public.groups (id),
  text text not null, category text not null, source text not null,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.cal_event (
  id uuid primary key, space_id uuid not null references public.groups (id),
  title text not null, date date not null, start text, "end" text, tentative boolean not null default false, order_id uuid,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);
create table if not exists public.memo (
  id uuid primary key, space_id uuid not null references public.groups (id),
  text text not null, result text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false
);

-- 4. RLS. Orders, providers, deadlines, events: any group the person is in (family rows later via People).
-- Memory and memos: only the personal space, never a family group, not even for its parents.
do $$
declare t text;
begin
  foreach t in array array['pa_order', 'provider', 'deadline', 'cal_event'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member', t);
    execute format('create policy %I on public.%I for all using (public.in_group(space_id) and public.has_app(''pa''))
                    with check (public.in_group(space_id) and public.has_app(''pa''))', t || '_member', t);
    execute format('create index if not exists %I on public.%I (space_id)', t || '_space', t);
  end loop;
  foreach t in array array['memory', 'memo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_personal', t);
    execute format('create policy %I on public.%I for all using (public.is_personal_space(space_id) and public.has_app(''pa''))
                    with check (public.is_personal_space(space_id) and public.has_app(''pa''))', t || '_personal', t);
    execute format('create index if not exists %I on public.%I (space_id)', t || '_space', t);
  end loop;
end $$;
