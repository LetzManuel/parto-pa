import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createOrder, complete } from '../orders/flow';
import { createMemory } from '../memory/memory';
import { stamp } from '../model';
import { Store } from './store';

async function open(space = 'space-1') {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  const db = new SQL.Database();
  return { db, store: new Store(db, space) };
}

describe('store', () => {
  it('saves, updates and soft-deletes orders', async () => {
    const { store } = await open();
    const o = store.save('order', createOrder({ title: 'Friseur', kind: 'recurring', everyN: 6, everyUnit: 'week', lastDone: '2026-10-01' }));
    expect(store.list('order')[0]).toEqual(o);
    store.save('order', complete(o, '2026-11-22'));
    expect(store.get('order', o.id)?.lastDone).toBe('2026-11-22');
    store.remove('order', o.id);
    expect(store.list('order')).toEqual([]);
  });

  it('keeps booleans and keeps spaces apart', async () => {
    const { db, store } = await open('a');
    store.save('event', stamp({ title: 'Probe', date: '2026-11-23', start: '18:00', end: '19:00', tentative: true, orderId: null }));
    expect(store.list('event')[0].tentative).toBe(true);
    const other = new Store(db, 'b');
    expect(other.list('event')).toEqual([]);
  });

  it('forgets memory and memos at once', async () => {
    const { store } = await open();
    store.save('memory', createMemory('Nie vor 9', 'von Hand'));
    store.save('memo', stamp({ text: 'Test', result: null }));
    store.save('order', createOrder({ title: 'bleibt', kind: 'reminder' }));
    store.forgetAll();
    expect(store.list('memory')).toEqual([]);
    expect(store.list('memo')).toEqual([]);
    expect(store.list('order')).toHaveLength(1);
  });
});
