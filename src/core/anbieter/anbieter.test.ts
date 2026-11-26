import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { Store } from '../db/store';
import { listFor } from '../favourites/check';
import { detectKind, parseRequest } from '../favourites/request';
import { entries, kindWords, keywords, moveTo, newEntry, newKeyword, shopEntry, shopOrder } from './lists';
import { applyAnbieterCommand, parseAnbieterCommand } from './voice';

async function open() {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  return new Store(new SQL.Database(), 'space-1');
}

async function seeded() {
  const store = await open();
  const add = (d: Parameters<typeof newEntry>[1]) => store.save('favourite', newEntry(store.list('favourite'), d));
  add({ kind: 'salon', name: 'Haarwerk Neubau' });
  add({ kind: 'salon', name: 'Salon Haarmonie' });
  add({ kind: 'salon', name: 'Barber Joe' });
  store.save('favourite', shopEntry(store.list('favourite'), 'grocery', 'foodora'));
  return store;
}

describe('Meine Anbieter lists', () => {
  it('numbers new entries per list and moves one to the front', async () => {
    const store = await seeded();
    const salons = entries(store.list('favourite'), 'salon');
    expect(salons.map((x) => [x.name, x.priority])).toEqual([['Haarwerk Neubau', 1], ['Salon Haarmonie', 2], ['Barber Joe', 3]]);
    const changed = moveTo(salons, salons[2].id, 0);
    expect(changed.map((x) => [x.name, x.priority])).toEqual([['Barber Joe', 1], ['Haarwerk Neubau', 2], ['Salon Haarmonie', 3]]);
  });

  it('keeps keywords out of the checked list but uses them to find the list', async () => {
    const store = await seeded();
    store.save('favourite', newKeyword(store.list('favourite'), 'beauty', 'Gellack')!);
    expect(newKeyword(store.list('favourite'), 'beauty', 'gellack')).toBeNull();
    const all = store.list('favourite');
    expect(listFor(all, { kind: 'beauty', topic: null })).toEqual([]);
    expect(keywords(all, 'beauty').map((k) => k.name)).toEqual(['Gellack']);
    expect(detectKind('Gellack am Samstag', kindWords(all))).toBe('beauty');
    expect(detectKind('Termin bei Barber Joe morgen', kindWords(all))).toBe('salon');
    expect(parseRequest('Gellack Samstag ab 10 Uhr', '2026-11-26', undefined, kindWords(all))?.kind).toBe('beauty');
  });

  it('splits salon and beauty in the built-in words', () => {
    expect(detectKind('Maniküre morgen')).toBe('beauty');
    expect(detectKind('Haare schneiden morgen')).toBe('salon');
  });

  it('gives the shop order for the shopping module', async () => {
    const store = await seeded();
    store.save('favourite', shopEntry(store.list('favourite'), 'grocery', 'gurkerl'));
    expect(shopOrder(store.list('favourite'), 'grocery').map((x) => x.platformId)).toEqual(['foodora', 'gurkerl']);
  });
});

describe('Meine Anbieter by voice', () => {
  it('"gurkerl zuerst" puts gurkerl first, adding it when it is not listed yet', async () => {
    const store = await seeded();
    const c = parseAnbieterCommand('gurkerl zuerst', store.list('favourite'))!;
    expect(c).toMatchObject({ type: 'move', kind: 'grocery', platformId: 'gurkerl', to: 1 });
    expect(c.confirm).toBe('gurkerl an die erste Stelle bei Lebensmittel?');
    applyAnbieterCommand(store, c);
    expect(shopOrder(store.list('favourite'), 'grocery').map((x) => x.platformId)).toEqual(['gurkerl', 'foodora']);
  });

  it('moves a salon by part of its name', async () => {
    const store = await seeded();
    const c = parseAnbieterCommand('Barber Joe an erster Stelle', store.list('favourite'))!;
    applyAnbieterCommand(store, c);
    expect(entries(store.list('favourite'), 'salon').map((x) => x.name)).toEqual(['Barber Joe', 'Haarwerk Neubau', 'Salon Haarmonie']);
    applyAnbieterCommand(store, parseAnbieterCommand('Haarwerk auf Platz 3', store.list('favourite'))!);
    expect(entries(store.list('favourite'), 'salon').map((x) => x.name)).toEqual(['Barber Joe', 'Salon Haarmonie', 'Haarwerk Neubau']);
  });

  it('adds a new entry with phone, a doctor with field, and a shop', async () => {
    const store = await seeded();
    const c = parseAnbieterCommand('Neue Kosmetikerin Studio Nails 0664 123 45 67', store.list('favourite'))!;
    expect(c).toMatchObject({ type: 'add', kind: 'beauty', name: 'Studio Nails', phone: '0664 123 45 67' });
    applyAnbieterCommand(store, c);
    const d = parseAnbieterCommand('Neue Zahnärztin Dr. Berger', store.list('favourite'))!;
    expect(d).toMatchObject({ type: 'add', kind: 'doctor', topic: 'Zahnarzt', name: 'Dr. Berger' });
    const w = parseAnbieterCommand('Füge Wolt als Lieferdienst hinzu', store.list('favourite'))!;
    expect(w).toMatchObject({ type: 'add', kind: 'food', platformId: 'wolt' });
    applyAnbieterCommand(store, w);
    expect(shopOrder(store.list('favourite'), 'food').map((x) => x.platformId)).toEqual(['wolt']);
  });

  it('removes and renumbers', async () => {
    const store = await seeded();
    applyAnbieterCommand(store, parseAnbieterCommand('Haarwerk löschen', store.list('favourite'))!);
    expect(entries(store.list('favourite'), 'salon').map((x) => [x.name, x.priority])).toEqual([['Salon Haarmonie', 1], ['Barber Joe', 2]]);
  });

  it('learns keywords by voice', async () => {
    const store = await seeded();
    const c = parseAnbieterCommand('Stichwort Spitzen für Friseur', store.list('favourite'))!;
    expect(c).toMatchObject({ type: 'keyword', kind: 'salon', word: 'Spitzen' });
    applyAnbieterCommand(store, c);
    expect(parseAnbieterCommand('Wimpern gehört zu Kosmetik', store.list('favourite'))).toMatchObject({ type: 'keyword', kind: 'beauty', word: 'Wimpern' });
    expect(detectKind('Spitzen morgen', kindWords(store.list('favourite')))).toBe('salon');
  });

  it('leaves other sentences alone', async () => {
    const store = await seeded();
    for (const s of ['Friseur morgen 14 bis 17 Uhr', 'Bestell bei gurkerl Milch', 'Schreib Anna, dass ich später komme', 'Erinner mich morgen an die Steuer']) {
      expect(parseAnbieterCommand(s, store.list('favourite'))).toBeNull();
    }
  });
});
