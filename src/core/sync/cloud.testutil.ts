// Test helper: the cloud schema in PGlite with a stub auth.uid(), plus a Remote that talks to it as one person.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Remote } from './engine';
import type { RawRow } from '../db/store';

const DIR = new URL('../../../supabase/migrations/', import.meta.url);

const AUTH_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  create role authenticated;
`;

export async function testCloud(users: string[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB + users.map((u) => `insert into auth.users values ('${u}');`).join('\n'));
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, DIR), 'utf8'));
  }
  await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;
                 grant execute on all functions in schema public to authenticated;`);
  return db;
}

/** Runs one statement as the given user (RLS applies). Serialised, because the role is session state. */
let chain: Promise<unknown> = Promise.resolve();
export function as<T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
  const run = chain.then(async () => {
    await db.exec(`set role postgres; select set_config('test.uid', '${uid}', false); set role authenticated;`);
    return db.query<T>(sql, params);
  });
  chain = run.catch(() => undefined);
  return run;
}

export function pgRemote(db: PGlite, uid: string): Remote {
  return {
    async push(table: string, rows: RawRow[]) {
      for (const r of rows) {
        const cols = Object.keys(r);
        const sets = cols.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`);
        await as(db, uid,
          `insert into ${table} (${cols.map((c) => `"${c}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
           on conflict (id) do update set ${sets.join(', ')}`,
          cols.map((c) => r[c]));
      }
    },
    async pull(table: string, since: string | null, limit: number) {
      // timestamptz as text with microseconds, like PostgREST sends it, so the cursor loses nothing
      const res = await as<RawRow>(db, uid,
        `select t.*, to_char(t.synced_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sync_cursor
         from ${table} t where ($1::timestamptz is null or t.synced_at > $1::timestamptz) order by t.synced_at limit ${limit}`,
        [since]);
      return res.rows.map(({ sync_cursor, ...r }) => ({ ...r, synced_at: sync_cursor }));
    },
  };
}
