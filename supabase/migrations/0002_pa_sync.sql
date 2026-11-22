-- Sync support: the cloud stamps every write (synced_at, used as the pull cursor) and keeps the newer row when two
-- devices changed the same row (last writer by updated_at wins; Parto Projects' conflict dialog can come later).

create or replace function public.pa_keep_newer() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- an older change from another device: keep what is there
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pa_order', 'provider', 'deadline', 'memory', 'cal_event', 'memo'] loop
    execute format('alter table public.%I add column if not exists synced_at timestamptz not null default clock_timestamp()', t);
    execute format('create index if not exists %I on public.%I (synced_at)', t || '_synced', t);
    execute format('drop trigger if exists keep_newer on public.%I', t);
    execute format('create trigger keep_newer before insert or update on public.%I for each row execute function public.pa_keep_newer()', t);
  end loop;
end $$;
