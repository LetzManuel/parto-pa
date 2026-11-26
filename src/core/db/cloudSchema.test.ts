// PA's cloud migrations on top of the shared private core, in PGlite: RLS keeps people and memory apart.
import { describe, expect, it } from 'vitest';
import { as, testCloud } from '../sync/cloud.testutil';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const FAM = '11111111-1111-1111-1111-111111111111';

const now = () => new Date().toISOString();
const order = (space: string, title: string) => [crypto.randomUUID(), space, title, 'reminder', 'open', now(), now()];
const INSERT = 'insert into pa_order (id, space_id, title, kind, state, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)';
const MEMORY = 'insert into memory (id, space_id, text, category, source, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)';

async function space(db: Awaited<ReturnType<typeof testCloud>>, uid: string) {
  return (await as<{ g: string }>(db, uid, 'select ensure_personal_space() as g')).rows[0].g;
}

describe('cloud schema on the shared core', () => {
  it('gives each person one personal space and keeps rows private', async () => {
    const db = await testCloud([A, B]);
    const sa = await space(db, A);
    expect(await space(db, A)).toBe(sa);
    const sb = await space(db, B);
    expect(sb).not.toBe(sa);
    expect((await as(db, A, 'select kind, name from groups')).rows).toEqual([{ kind: 'personal', name: 'Ich' }]);

    await as(db, A, INSERT, order(sa, 'A: Friseur'));
    await as(db, B, INSERT, order(sb, 'B: Pickerl'));
    expect((await as(db, A, 'select title from pa_order')).rows.map((r) => r.title)).toEqual(['A: Friseur']);
    expect((await as(db, B, 'select title from pa_order')).rows.map((r) => r.title)).toEqual(['B: Pickerl']);
    await expect(as(db, B, INSERT, order(sa, 'B schreibt bei A'))).rejects.toThrow(/row-level security/);
  });

  it('keeps memory out of family groups, orders may be shared there', async () => {
    const db = await testCloud([A, B]);
    await space(db, A);
    await space(db, B);
    await db.exec(`set role postgres;
      insert into groups (id, kind, name, created_by) values ('${FAM}', 'family', 'Familie', '${A}');
      insert into group_members (group_id, user_id, first_name, role) values ('${FAM}', '${A}', 'Anna', 'parent'), ('${FAM}', '${B}', 'Ben', 'parent');`);
    await expect(as(db, A, MEMORY, [crypto.randomUUID(), FAM, 'Allergie', 'health', 'von Hand', now(), now()]))
      .rejects.toThrow(/row-level security/);
    await as(db, A, INSERT, order(FAM, 'Familienauftrag'));
    expect((await as(db, B, 'select title from pa_order')).rows.map((r) => r.title)).toEqual(['Familienauftrag']);
  });

  it('needs PA turned on for the person', async () => {
    const db = await testCloud([A]);
    const sa = await space(db, A);
    await db.exec(`set role postgres; delete from user_app where user_id = '${A}';`);
    await expect(as(db, A, INSERT, order(sa, 'ohne PA'))).rejects.toThrow(/row-level security/);
  });

  it('keeps shopping lists, order history and favourites (doctors!) in the personal space only', async () => {
    const db = await testCloud([A, B]);
    const sa = await space(db, A);
    await space(db, B);
    await db.exec(`set role postgres;
      insert into groups (id, kind, name, created_by) values ('${FAM}', 'family', 'Familie', '${A}');
      insert into group_members (group_id, user_id, first_name, role) values ('${FAM}', '${A}', 'Anna', 'parent'), ('${FAM}', '${B}', 'Ben', 'parent');`);
    const LIST = 'insert into shop_list (id, space_id, name, kind, items, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)';
    await as(db, A, LIST, [crypto.randomUUID(), sa, 'Wocheneinkauf', 'grocery', 'Milch', now(), now()]);
    await expect(as(db, A, LIST, [crypto.randomUUID(), FAM, 'Familie', 'grocery', 'Milch', now(), now()])).rejects.toThrow(/row-level security/);
    await as(db, A, 'insert into shop_run (id, space_id, date, items, created_at, updated_at) values ($1, $2, $3, $4, $5, $6)', [crypto.randomUUID(), sa, '2026-11-26', 'Milch', now(), now()]);
    expect((await as(db, B, 'select name from shop_list')).rows).toEqual([]);
    expect((await as(db, B, 'select id from shop_run')).rows).toEqual([]);
    expect((await as(db, A, 'select name from shop_list')).rows).toEqual([{ name: 'Wocheneinkauf' }]);
    const FAV = 'insert into favourite (id, space_id, kind, topic, priority, name, system, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
    await as(db, A, FAV, [crypto.randomUUID(), sa, 'doctor', 'Zahnarzt', 1, 'Dr. Zahn', 'doctolib', now(), now()]);
    await expect(as(db, A, FAV, [crypto.randomUUID(), FAM, 'doctor', 'Zahnarzt', 1, 'Dr. Familie', 'manual', now(), now()])).rejects.toThrow(/row-level security/);
    expect((await as(db, A, 'select name from favourite')).rows.map((r) => r.name)).toEqual(['Dr. Zahn']);
    expect((await as(db, B, 'select name from favourite')).rows).toEqual([]);
  });
});
