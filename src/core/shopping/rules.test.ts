import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { Store } from '../db/store';
import { parseAnbieterCommand, applyAnbieterCommand } from '../anbieter/voice';
import { choices, plan, placeLabel, shopEntries } from './choose';
import { parseShopping } from './parse';
import { applyShopRule, parseShopRule } from './rules';

async function open() {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  return new Store(new SQL.Database(), 'space-1');
}
const THU = '2026-11-26', SAT = '2026-11-28';
const say = (store: Store, text: string) => {
  const r = parseShopRule(text, store.list('favourite'));
  if (!r) throw new Error(`not understood: ${text}`);
  return { confirm: r.confirm, done: applyShopRule(store, r) };
};
const input = (store: Store, text: string, date = THU) => {
  const i = parseShopping(text)!;
  return { kind: i.kind, explicit: i.platformId, text, items: i.items, date, favourites: store.list('favourite'), fallback: 'gurkerl' };
};

describe('order rules by voice', () => {
  it('sends alcohol to Alfies and splits the basket', async () => {
    const store = await open();
    expect(say(store, 'Alkohol bestelle ich bei Alfies').confirm).toBe('Alkohol immer zuerst bei Alfies?');
    const parts = plan(input(store, 'Bestell Milch, 6 Eier und 2 Flaschen Rotwein'));
    expect(parts.map((p) => [p.choice.platformId, p.items.map((x) => x.name)])).toEqual([
      ['gurkerl', ['Milch', 'Eier']],
      ['alfies', ['Rotwein']],
    ]);
    expect(parts[1].choice.reason).toBe('deine Regel für Alkohol');
    // Said aloud wins: no split.
    expect(plan(input(store, 'Bestell bei gurkerl Milch und Bier'))).toHaveLength(1);
  });

  it('uses foodora on weekends', async () => {
    const store = await open();
    expect(say(store, 'Am Wochenende bestelle ich bei foodora').confirm).toBe('Am Wochenende Essen und Einkauf immer zuerst bei foodora?');
    expect(choices(input(store, 'Bestell Milch und Brot', SAT))[0]).toMatchObject({ platformId: 'foodora', reason: 'am Wochenende' });
    expect(choices(input(store, 'Bestell Milch und Brot', THU))[0].platformId).toBe('gurkerl');
    say(store, 'Unter der Woche bei gurkerl');
    expect(choices(input(store, 'Bestell Milch', THU))[0]).toMatchObject({ platformId: 'gurkerl', reason: 'unter der Woche' });
  });

  it('keeps a ranking of restaurants per cuisine and offers the next one', async () => {
    const store = await open();
    expect(say(store, 'Italienisch: Riva, Da Mario und Bella Napoli über Lieferando').confirm)
      .toBe('Italienisch: 1. Riva, 2. Da Mario, 3. Bella Napoli. Speichern?');
    say(store, 'Sushi Yu für Japanisch über Wolt');
    const c = choices(input(store, 'Bestell Pizza Margherita'));
    expect(c.map(placeLabel).slice(0, 3)).toEqual(['Riva über Lieferando', 'Da Mario über Lieferando', 'Bella Napoli über Lieferando']);
    expect(c[0].reason).toBe('deine Nummer 1 für Italienisch');
    expect(placeLabel(choices(input(store, 'Bestell Sushi'))[0])).toBe('Sushi Yu über Wolt');
  });

  it('re-ranks after an order: super, schlecht, nie wieder', async () => {
    const store = await open();
    say(store, 'Italienisch: Riva, Da Mario, Bella Napoli');
    const names = () => shopEntries(store.list('favourite'), 'food', 'Italienisch').map((f) => f.name);
    expect(say(store, 'Da Mario war super').done).toBe('Da Mario ist jetzt deine Nummer 1 für Italienisch.');
    expect(names()).toEqual(['Da Mario', 'Riva', 'Bella Napoli']);
    expect(say(store, 'Da Mario war leider kalt').confirm).toBe('Da Mario bei Italienisch auf Platz 2 zurückreihen?');
    expect(names()).toEqual(['Riva', 'Da Mario', 'Bella Napoli']);
    say(store, 'Nie wieder Bella Napoli');
    expect(names()).toEqual(['Riva', 'Da Mario']);
    // Without a name: the last restaurant ordered from.
    const last = { run: { id: 'r', listId: 'l', platformId: 'lieferando', date: THU, items: '', createdAt: '', updatedAt: '' }, name: 'Da Mario' };
    expect(parseShopRule('war super', store.list('favourite'), last)).toMatchObject({ type: 'rate', name: 'Da Mario', mood: 'up' });
  });

  it('reaches the same rules through the one microphone', async () => {
    const store = await open();
    const c = parseAnbieterCommand('Wein immer über Alfies', store.list('favourite'))!;
    expect(c).toMatchObject({ type: 'shop', kind: 'grocery' });
    applyAnbieterCommand(store, c);
    expect(shopEntries(store.list('favourite'), 'grocery', 'Alkohol')[0].systemRef).toBe('alfies');
    // The general "gurkerl zuerst" still belongs to Meine Anbieter.
    expect(parseAnbieterCommand('gurkerl zuerst', store.list('favourite'))).toMatchObject({ type: 'move' });
  });
});
