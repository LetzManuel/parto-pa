// Rhythms and touches sync like memory: personal space only, never into a family group.
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { Store } from '../db/store';
import { sync } from '../sync/engine';
import { as, pgRemote, testCloud } from '../sync/cloud.testutil';
import { createRhythm } from './engine';
import { createTouch } from './history';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const FAM = '11111111-1111-1111-1111-111111111111';

async function device(space: string) {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  return new Store(new SQL.Database(), space);
}

describe('rhythm sync', () => {
  it('round-trips rhythms and touches and keeps them out of family groups', async () => {
    const cloud = await testCloud([A, B]);
    const space = (await as<{ g: string }>(cloud, A, 'select ensure_personal_space() as g')).rows[0].g;
    await as(cloud, B, 'select ensure_personal_space()');

    const phone = await device(space);
    const r = phone.save('rhythm', createRhythm({ subject: 'person:anna', label: 'Anna', kind: 'contact', everyN: 3, everyUnit: 'week', lastDone: '2026-11-01', phone: '+43 660 1' }));
    const t = phone.save('touch', createTouch({ subject: 'person:anna', kind: 'contact', date: '2026-11-20', source: 'voice', direction: 'in' }));
    expect((await sync(phone, pgRemote(cloud, A))).pushed).toBe(2);

    const laptop = await device(space);
    await sync(laptop, pgRemote(cloud, A));
    expect(laptop.get('rhythm', r.id)).toEqual(r);
    expect(laptop.get('touch', t.id)).toEqual(t);
    expect((await as(cloud, B, 'select * from rhythm')).rows).toEqual([]);

    await cloud.exec(`set role postgres;
      insert into groups (id, kind, name, created_by) values ('${FAM}', 'family', 'Familie', '${A}');
      insert into group_members (group_id, user_id, first_name, role) values ('${FAM}', '${A}', 'Anna', 'parent'), ('${FAM}', '${B}', 'Ben', 'parent');`);
    const now = new Date().toISOString();
    await expect(as(cloud, A, `insert into touch (id, space_id, subject, kind, date, source, created_at, updated_at)
      values ($1, $2, 'person:x', 'contact', '2026-11-20', 'manual', $3, $3)`, [crypto.randomUUID(), FAM, now])).rejects.toThrow(/row-level security/);
  });
});
