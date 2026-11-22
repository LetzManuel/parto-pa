import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { Store } from '../db/store';
import { createOrder, complete } from '../orders/flow';
import { createMemory } from '../memory/memory';
import { stamp } from '../model';
import { sync } from './engine';
import { as, pgRemote, testCloud } from './cloud.testutil';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

async function device(space: string) {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  return new Store(new SQL.Database(), space);
}

async function personalSpace(db: Awaited<ReturnType<typeof testCloud>>, uid: string) {
  return (await as<{ g: string }>(db, uid, 'select ensure_personal_space() as g')).rows[0].g;
}

describe('sync', () => {
  it('moves offline data into the cloud space and on to a second device', async () => {
    const cloud = await testCloud([A]);
    const space = await personalSpace(cloud, A);

    const phone = await device('local-only');
    const o = phone.save('order', createOrder({ title: 'Friseur', kind: 'recurring', everyN: 6, everyUnit: 'week', lastDone: '2026-10-01' }));
    phone.save('event', stamp({ title: 'Probe', date: '2026-11-23', start: '18:00', end: null, tentative: true, orderId: null }));
    phone.adoptSpace(space);
    const first = await sync(phone, pgRemote(cloud, A));
    expect(first.pushed).toBe(2);
    expect(await sync(phone, pgRemote(cloud, A))).toEqual({ pushed: 0, pulled: 0 });

    const laptop = await device(space);
    await sync(laptop, pgRemote(cloud, A));
    expect(laptop.get('order', o.id)).toEqual(o);
    expect(laptop.list('event')[0].tentative).toBe(true);

    // change on the laptop, deletion on the phone
    laptop.save('order', complete(o, '2026-11-22'));
    await sync(laptop, pgRemote(cloud, A));
    await sync(phone, pgRemote(cloud, A));
    expect(phone.get('order', o.id)?.lastDone).toBe('2026-11-22');
    phone.remove('event', phone.list('event')[0].id);
    await sync(phone, pgRemote(cloud, A));
    await sync(laptop, pgRemote(cloud, A));
    expect(laptop.list('event')).toEqual([]);
  });

  it('keeps the newer change when two devices edit the same row', async () => {
    const cloud = await testCloud([A]);
    const space = await personalSpace(cloud, A);
    const one = await device(space);
    const two = await device(space);
    const m = one.save('memory', createMemory('Nie vor 9', 'von Hand', undefined, new Date('2026-11-22T10:00:00Z')));
    await sync(one, pgRemote(cloud, A));
    await sync(two, pgRemote(cloud, A));
    two.save('memory', { ...m, text: 'Nie vor 10', updatedAt: '2026-11-22T12:00:00.000Z' });
    one.save('memory', { ...m, text: 'Nie vor 8', updatedAt: '2026-11-22T11:00:00.000Z' });
    await sync(two, pgRemote(cloud, A));
    await sync(one, pgRemote(cloud, A)); // older change: the cloud keeps "Nie vor 10"
    await sync(one, pgRemote(cloud, A));
    expect(one.get('memory', m.id)?.text).toBe('Nie vor 10');
  });

  it("never pulls another person's rows", async () => {
    const cloud = await testCloud([A, B]);
    const sa = await personalSpace(cloud, A);
    const sb = await personalSpace(cloud, B);
    const a = await device(sa);
    const b = await device(sb);
    a.save('memory', createMemory('Geheim A', 'von Hand'));
    await sync(a, pgRemote(cloud, A));
    expect((await sync(b, pgRemote(cloud, B))).pulled).toBe(0);
    expect(b.list('memory')).toEqual([]);
  });
});
