-- Rhythms ("Friseur etwa alle 5 Wochen", "Mit Anna alle 3 Wochen telefonieren") and their history (touches:
-- "mit Anna telefoniert", "war beim Friseur"). Who the user is in touch with and how often is personal: both tables
-- live only in the personal space, like memory and memos, never in a family group.

create table if not exists public.rhythm (
  id uuid primary key, space_id uuid not null references public.groups (id),
  subject text not null, label text not null, kind text not null check (kind in ('booking', 'contact', 'task')),
  status text not null check (status in ('active', 'paused', 'dismissed')), origin text not null check (origin in ('manual', 'learned')),
  every_n int not null check (every_n > 0), every_unit text not null check (every_unit in ('day', 'week', 'month', 'year')),
  last_done date, snoozed_until date, provider_id uuid, phone text, channel text, note text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp()
);
create table if not exists public.touch (
  id uuid primary key, space_id uuid not null references public.groups (id),
  subject text not null, kind text not null, date date not null, source text not null, direction text,
  created_at timestamptz not null, updated_at timestamptz not null, deleted boolean not null default false,
  synced_at timestamptz not null default clock_timestamp()
);

do $$
declare t text;
begin
  foreach t in array array['rhythm', 'touch'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_personal', t);
    execute format('create policy %I on public.%I for all using (public.is_personal_space(space_id) and public.has_app(''pa''))
                    with check (public.is_personal_space(space_id) and public.has_app(''pa''))', t || '_personal', t);
    execute format('create index if not exists %I on public.%I (space_id)', t || '_space', t);
    execute format('create index if not exists %I on public.%I (synced_at)', t || '_synced', t);
    execute format('drop trigger if exists keep_newer on public.%I', t);
    execute format('create trigger keep_newer before insert or update on public.%I for each row execute function public.pa_keep_newer()', t);
  end loop;
end $$;
