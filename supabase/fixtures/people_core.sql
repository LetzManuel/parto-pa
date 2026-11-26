-- TEST FIXTURE ONLY, never applied to a cloud.
-- The part of the shared Parto private core (groups, members, roles) that PA builds on, copied from the
-- parto-private-test project as of 22 Nov 2026 (its migration 0001_groups.sql), so PA's migrations and RLS can be
-- tested in PGlite. If the core changes, refresh this copy.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '', call_name text, locale text not null default 'de',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'family' check (kind in ('family', 'friends', 'club')),
  name text not null, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id), user_id uuid, first_name text not null,
  role text not null check (role in ('parent', 'child', 'guest')), color text, needs_escort boolean not null default false,
  valid_from timestamptz, valid_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  check (role <> 'guest' or valid_until is not null)
);
create table public.group_settings (
  group_id uuid primary key references public.groups (id),
  child_rights jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);

create function public.my_group_role(g uuid) returns text language sql stable security definer set search_path = public as $$
  select m.role from public.group_members m join public.groups gr on gr.id = m.group_id
  where m.group_id = g and m.user_id = auth.uid() and not m.deleted and not gr.deleted
    and (m.valid_from is null or m.valid_from <= now()) and (m.valid_until is null or m.valid_until > now())
  limit 1
$$;
create function public.in_group(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.my_group_role(g) is not null
$$;
create function public.is_parent(g uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_group_role(g) = 'parent', false)
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_settings enable row level security;
create policy profiles_own on public.profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy groups_read on public.groups for select using (public.in_group(id));
create policy members_read on public.group_members for select using (public.in_group(group_id));
create policy settings_read on public.group_settings for select using (public.in_group(group_id));
