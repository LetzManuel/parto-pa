// Runs the cloud migration in PGlite with a stub auth schema and checks that RLS keeps people apart.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(new URL('../../../supabase/migrations/0001_pa_schema.sql', import.meta.url), 'utf8');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create role authenticated;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await db.exec(SQL);
  await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;
                 grant execute on all functions in schema public to authenticated;`);
  return db;
}

async function as(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role postgres; select set_config('test.uid', '${uid}', false); set role authenticated;`);
  return db.query<Record<string, unknown>>(sql, params);
}

const row = (space: string, title: string) =>
  [crypto.randomUUID(), space, title, 'reminder', 'open', new Date().toISOString(), new Date().toISOString()];
const INSERT = `insert into pa_order (id, space_id, title, kind, state, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)`;

describe('cloud schema', () => {
  it('gives each person one personal space and keeps rows private', async () => {
    const db = await setup();
    const sa = (await as(db, A, 'select ensure_personal_space() as g')).rows[0].g as string;
    const again = (await as(db, A, 'select ensure_personal_space() as g')).rows[0].g;
    expect(again).toBe(sa);
    const sb = (await as(db, B, 'select ensure_personal_space() as g')).rows[0].g as string;
    expect(sb).not.toBe(sa);

    await as(db, A, INSERT, row(sa, 'A: Friseur'));
    await as(db, B, INSERT, row(sb, 'B: Pickerl'));
    expect((await as(db, A, 'select title from pa_order')).rows.map((r) => r.title)).toEqual(['A: Friseur']);
    expect((await as(db, B, 'select title from pa_order')).rows.map((r) => r.title)).toEqual(['B: Pickerl']);
    await expect(as(db, B, INSERT, row(sa, 'B schreibt bei A'))).rejects.toThrow(/row-level security/);
  });

  it('keeps memory out of family groups', async () => {
    const db = await setup();
    await as(db, A, 'select ensure_personal_space()');
    await db.exec(`set role postgres;
      insert into parto_group (id, kind, created_by) values ('11111111-1111-1111-1111-111111111111', 'family', '${A}');
      insert into group_member values ('11111111-1111-1111-1111-111111111111', '${A}', 'owner');`);
    const fam = '11111111-1111-1111-1111-111111111111';
    const mem = [crypto.randomUUID(), fam, 'Allergie', 'health', 'von Hand', new Date().toISOString(), new Date().toISOString()];
    await expect(as(db, A, 'insert into memory (id, space_id, text, category, source, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7)', mem))
      .rejects.toThrow(/row-level security/);
    await as(db, A, INSERT, row(fam, 'Familienauftrag')); // orders may live in the family group
  });
});
