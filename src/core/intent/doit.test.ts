import { describe, expect, it } from 'vitest';
import { newEntry, shopEntry } from '../anbieter/lists';
import type { Favourite } from '../favourites/model';
import type { Recipient } from '../messages';
import { createOrder } from '../orders/flow';
import { answer, startDoIt, type DoItContext } from './doit';

const today = '2026-11-26';
function ctx(): DoItContext {
  const favs: Favourite[] = [];
  favs.push(newEntry(favs, { kind: 'salon', name: 'Haarwerk Neubau' }));
  favs.push(newEntry(favs, { kind: 'babysitter', name: 'Lena Huber', phone: '0664 1234567' }));
  favs.push(shopEntry(favs, 'grocery', 'gurkerl'));
  const recipients: Recipient[] = [{ key: 'provider:1', name: 'Installateur Wagner', formal: true, phone: '+43 660 1112223', email: 'office@wagner.at' }];
  return { today, favourites: favs, providers: [], recipients };
}
const order = (title: string, extra: Parameters<typeof createOrder>[0] extends infer T ? Partial<T> : never = {}) =>
  createOrder({ title, kind: 'reminder', ...extra } as Parameters<typeof createOrder>[0]);

describe('PA, erledige das', () => {
  it('books: asks when if no time was given, then hands over to the check', () => {
    const c = ctx();
    let s = startDoIt(order('Friseurtermin ausmachen'), null, c);
    expect(s.job).toBe('book');
    expect(s.question?.field).toBe('when');
    s = answer(s, 'morgen ab 14 Uhr', c);
    expect(s.ready).toMatchObject({ to: 'book', req: { kind: 'salon', from: '14:00' } });
    expect(s.confirm).toBe('Friseur bei deinen Anbietern prüfen?');
  });

  it('asks what kind of appointment when the to-do does not say', () => {
    const c = ctx();
    let s = startDoIt(order('Termin ausmachen nächste Woche'), null, c);
    expect(s.question?.field).toBe('kind');
    s = answer(s, 'Kosmetik', c);
    expect(s.ready).toMatchObject({ to: 'book', req: { kind: 'beauty' } });
  });

  it('follows up with the person PA is waiting for, by message', () => {
    const c = ctx();
    const s = startDoIt(createOrder({ title: 'Angebot Therme', kind: 'followup', waitingFor: 'Installateur Wagner' }), null, c);
    expect(s.ready).toMatchObject({ to: 'message', template: 'followup', recipient: { name: 'Installateur Wagner' } });
  });

  it('call: finds the number on Meine Anbieter or asks for it', () => {
    const c = ctx();
    expect(startDoIt(order('Anrufen: Lena Huber'), null, c).ready).toEqual({ to: 'call', name: 'Lena Huber', phone: '0664 1234567' });
    let s = startDoIt(order('Hausverwaltung anrufen'), null, c);
    expect(s.question).toMatchObject({ field: 'phone', ask: 'Welche Nummer hat Hausverwaltung?' });
    s = answer(s, '01 234 56 78', c);
    expect(s.ready).toEqual({ to: 'call', name: 'Hausverwaltung', phone: '01 234 56 78' });
  });

  it('order: asks for the items when the to-do has none', () => {
    const c = ctx();
    let s = startDoIt(order('Bei gurkerl bestellen'), null, c);
    expect(s.question?.field).toBe('items');
    s = answer(s, 'Milch, Eier und Brot', c);
    expect(s.ready?.to).toBe('order');
    expect(s.ready && s.ready.to === 'order' && s.ready.intent.items.map((i) => i.name)).toEqual(['Milch', 'Eier', 'Brot']);
  });

  it('message without text asks for it; unknown job asks how; "abbrechen" stops', () => {
    const c = ctx();
    let s = startDoIt(order('Steuer erledigen'), null, c);
    expect(s.question?.field).toBe('job');
    s = answer(s, 'Nachricht schreiben', c);
    expect(s.question?.field).toBe('recipient');
    s = answer(s, 'Installateur Wagner', c);
    expect(s.question?.field).toBe('body');
    s = answer(s, 'Bitte um Rückruf wegen der Rechnung', c);
    expect(s.ready).toMatchObject({ to: 'message', body: 'Bitte um Rückruf wegen der Rechnung' });
    expect(answer(startDoIt(order('Steuer erledigen'), null, c), 'abbrechen', c).cancelled).toBe(true);
  });
});
