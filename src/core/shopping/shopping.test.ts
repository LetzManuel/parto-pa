import { describe, expect, it } from 'vitest';
import { isShoppingIntent, parseShopping } from './parse';
import { applyCommand, dueLists, findList, handoff, listFromIntent, markHanded, markOrdered, parseBasketCommand, readBack, rhythmLabel, skip } from './lists';
import { platform } from './platforms';

const TODAY = '2026-11-26'; // Thursday

describe('spoken orders', () => {
  it('reads platform and items with amounts', () => {
    const i = parseShopping('Bestell bei gurkerl 2 Liter Milch, 6 Eier und Brot')!;
    expect(i.platformId).toBe('gurkerl');
    expect(i.kind).toBe('grocery');
    expect(i.items).toEqual([
      { qty: 2, unit: 'l', name: 'Milch' },
      { qty: 6, unit: null, name: 'Eier' },
      { qty: null, unit: null, name: 'Brot' },
    ]);
  });

  it('knows that BILLA delivers via foodora and SPAR not at all', () => {
    const b = parseShopping('Bestell bei Billa Bananen und zwei Packungen Nudeln')!;
    expect(b.platformId).toBe('foodora');
    expect(b.platformNote).toMatch(/foodora/);
    expect(b.items[1]).toEqual({ qty: 2, unit: 'Pkg.', name: 'Nudeln' });
    expect(parseShopping('Kauf bei Interspar Kaffee')!.platformId).toBeNull();
  });

  it('turns a rhythm into a recurring basket', () => {
    const i = parseShopping('Jeden Freitag Wocheneinkauf bei gurkerl: Milch, Eier, Bananen')!;
    expect(i).toMatchObject({ name: 'Wocheneinkauf', everyN: 1, everyUnit: 'week', weekday: 5, platformId: 'gurkerl' });
    expect(i.items.map((x) => x.name)).toEqual(['Milch', 'Eier', 'Bananen']);
    const l = listFromIntent(i, TODAY);
    expect(l.nextDate).toBe('2026-11-27');
    expect(rhythmLabel(l)).toBe('jeden Freitag');

    const two = parseShopping('Alle zwei Wochen bei Billa Waschmittel und Klopapier')!;
    expect(two).toMatchObject({ everyN: 2, everyUnit: 'week' });
    expect(two.items.map((x) => x.name)).toEqual(['Waschmittel', 'Klopapier']);
  });

  it('detects food orders', () => {
    const i = parseShopping('Bestell Pizza Margherita bei Lieferando')!;
    expect(i).toMatchObject({ kind: 'food', platformId: 'lieferando' });
    expect(i.items[0].name).toBe('Pizza Margherita');
    expect(parseShopping('Bestell Sushi über foodora')!.kind).toBe('food');
  });

  it('finds saved baskets again', () => {
    expect(parseShopping('Bestell das Übliche')).toMatchObject({ reuse: 'übliche' });
    expect(parseShopping('Den Wocheneinkauf nochmal')).toMatchObject({ reuse: 'wocheneinkauf' });
    const week = listFromIntent(parseShopping('Jeden Freitag Wocheneinkauf bei gurkerl: Milch')!, TODAY);
    const pizza = listFromIntent(parseShopping('Bestell Pizza bei Lieferando')!, TODAY);
    expect(findList([pizza, week], 'wocheneinkauf')?.id).toBe(week.id);
    expect(findList([pizza, week], 'übliche')?.id).toBe(week.id);
  });

  it('leaves messages and place reminders alone', () => {
    expect(isShoppingIntent('Erinner mich, wenn ich bei Billa bin, an Batterien')).toBe(false);
    expect(isShoppingIntent('Schreib Anna, dass ich Milch kaufe')).toBe(false);
    expect(isShoppingIntent('Steuerausgleich bis Freitag')).toBe(false);
    expect(isShoppingIntent('Wir brauchen Klopapier')).toBe(true);
  });
});

describe('semi-automatic baskets', () => {
  const week = () => listFromIntent(parseShopping('Jeden Freitag Wocheneinkauf bei gurkerl: Milch, 6 Eier, Bananen, Brot, Butter')!, TODAY);

  it('is ready a day ahead and asks once', () => {
    const l = week();
    expect(dueLists([l], '2026-11-25')).toEqual([]);
    expect(dueLists([l], TODAY)).toHaveLength(1);
    expect(readBack(l, platform(l.platformId))).toBe('Wocheneinkauf bei gurkerl: 5 Artikel, Milch, 6 Eier, Bananen und 2 weitere. Soll ich gurkerl öffnen?');
  });

  it('opens the platform with the list, never orders itself', () => {
    const h = handoff(week());
    expect(h.url).toBe('https://www.gurkerl.at');
    expect(h.itemLinks[1]).toEqual({ item: '6 Eier', url: 'https://www.gurkerl.at/suche?q=Eier' });
    expect(h.text).toContain('- 6 Eier');
  });

  it('moves to the next round after "bestellt" and keeps history', () => {
    const handed = markHanded(week(), TODAY);
    expect(dueLists([handed], '2026-11-28')).toHaveLength(1); // still asks "Bestellt?"
    const { list, run } = markOrdered(handed, TODAY);
    expect(list).toMatchObject({ nextDate: '2026-12-04', lastOrdered: TODAY, handedOn: null, state: 'active' });
    expect(run).toMatchObject({ listId: list.id, platformId: 'gurkerl', date: TODAY });
    expect(dueLists([list], '2026-11-30')).toEqual([]);
    expect(skip(list, '2026-12-03').nextDate).toBe('2026-12-11');
  });

  it('closes a one-off basket after ordering', () => {
    const l = listFromIntent(parseShopping('Bestell Pizza bei Lieferando')!, TODAY);
    expect(dueLists([l], TODAY)).toHaveLength(1);
    expect(markOrdered(l, TODAY).list.state).toBe('done');
  });

  it('understands short spoken edits', () => {
    expect(parseBasketCommand('Ja')).toEqual({ type: 'confirm' });
    expect(parseBasketCommand('bestellt')).toEqual({ type: 'ordered' });
    expect(parseBasketCommand('diesmal nicht')).toEqual({ type: 'skip' });
    const add = parseBasketCommand('noch Butter und 2 Joghurt dazu')!;
    const rm = parseBasketCommand('ohne Eier')!;
    let items = 'Milch\n6 Eier';
    items = applyCommand(items, add);
    items = applyCommand(items, rm);
    expect(items).toBe('Milch\nButter\n2 Joghurt');
  });
});

describe('rhythms → recurring orders', () => {
  it('proposes a weekly basket after four Friday orders and keeps a no', async () => {
    const { basketProposals, acceptProposal } = await import('./rhythm');
    const { stamp } = await import('../model');
    const list = { ...listFromIntent(parseShopping('Pizza bei Lieferando: Pizza Margherita')!, '2026-10-30'), name: 'Pizza Freitag', state: 'done' as const };
    const runs = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-10-30'].map((date) => stamp({ listId: list.id, platformId: 'lieferando', date, items: list.items }));
    const [p] = basketProposals([list], runs, '2026-11-26');
    expect(p).toMatchObject({ everyN: 1, everyUnit: 'week', weekday: 5, count: 4 });
    expect(acceptProposal(p, '2026-11-26')).toMatchObject({ everyN: 1, weekday: 5, nextDate: '2026-11-27', state: 'active' });
    expect(basketProposals([list], runs, '2026-11-26', new Set([list.id]))).toEqual([]);
  });
});
