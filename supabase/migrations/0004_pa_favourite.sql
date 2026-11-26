-- Favourites for "check my favourites in order" (Friseur, Restaurant, Tickets, Ärzte, Babysitter).
-- Columns mirror src/core/db/schema.ts v3. Personal space only, like memory: a list of one's doctors says something
-- about one's health, so it never shows up in a family group.
create table if not exists public.favourite (
  id uuid primary key, space_id uuid not null references public.groups (id),
  kind text not null, topic text, priority int not null, name text not null, system text not null, system_ref text,
  booking_url text, phone text, duration_min int, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp()
);
alter table public.favourite enable row level security;
drop policy if exists favourite_personal on public.favourite;
create policy favourite_personal on public.favourite for all
  using (public.is_personal_space(space_id) and public.has_app('pa'))
  with check (public.is_personal_space(space_id) and public.has_app('pa'));
create index if not exists favourite_space on public.favourite (space_id);
create index if not exists favourite_synced on public.favourite (synced_at);
drop trigger if exists keep_newer on public.favourite;
create trigger keep_newer before insert or update on public.favourite for each row execute function public.pa_keep_newer();
