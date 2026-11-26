import { describe, expect, it } from 'vitest';
import { newEntry, newKeyword, shopEntry } from '../anbieter/lists';
import type { Favourite } from '../favourites/model';
import type { Recipient } from '../messages';
import { route, type RouteContext } from './route';

const today = '2026-11-26';
function favs(): Favourite[] {
  const all: Favourite[] = [];
  const push = (f: Favourite | null) => { if (f) all.push(f); };
  push(newEntry(all, { kind: 'salon', name: 'Haarwerk Neubau' }));
  push(newEntry(all, { kind: 'babysitter', name: 'Lena Huber', phone: '0664 1234567' }));
  push(shopEntry(all, 'grocery', 'gurkerl', null, 'gurkerl'));
  push(newEntry(all, { kind: 'grocery', name: 'Billa am Eck', system: 'shop', systemRef: 'foodora' }));
  push(newKeyword(all, 'salon', 'Spitzen'));
  return all;
}
const recipients: Recipient[] = [{ key: 'p1', name: 'Studio Nails', formal: true, email: 'hallo@studio-nails.at', phone: '+436641234567' }];
const ctx = (): RouteContext => ({ today, favourites: favs(), recipients });
const to = (s: string) => route(s, ctx()).to;

describe('one mic, one route', () => {
  it('sends each kind of sentence to its feature', () => {
    expect(to('gurkerl zuerst')).toBe('anbieter');
    expect(to('Neuer Friseur Salon Lisa')).toBe('anbieter');
    expect(to('Heute bin ich mit dem Auto unterwegs')).toBe('travel');
    expect(to('Schreib Studio Nails, dass ich morgen 10 Minuten später komme')).toBe('message');
    expect(to('Bestell bei gurkerl 2 Liter Milch und Eier')).toBe('shopping');
    expect(to('Jeden Freitag Wocheneinkauf bei gurkerl: Milch, Eier, Brot')).toBe('shopping');
    expect(to('Friseur alle 5 Wochen')).toBe('rhythm');
    expect(to('Hab gestern mit Anna telefoniert')).toBe('rhythm');
    expect(to('Friseur morgen zwischen 14 und 17 Uhr')).toBe('booking');
    expect(to('Babysitter Samstag ab 19 Uhr')).toBe('booking');
    expect(to('Tisch für 4 am Freitag um 19 Uhr')).toBe('booking');
    expect(to('Erinner mich morgen an die Steuer')).toBe('memo');
    expect(to('PA, erledige den Friseurtermin')).toBe('doit');
    expect(to('Kümmer dich um die Steuer')).toBe('doit');
  });

  it('uses own words: a keyword finds the list, a shop name makes it an order', () => {
    const r = route('Spitzen Samstag Vormittag', ctx());
    expect(r).toMatchObject({ to: 'booking', req: { kind: 'salon' } });
    const s = route('Billa am Eck Milch und Brot', ctx());
    expect(s.to).toBe('shopping');
  });

  it('keeps reminders as memos even when they name a shop or salon', () => {
    expect(to('Erinner mich, wenn ich bei Billa bin, Milch zu kaufen')).toBe('memo');
    expect(to('Wenn der Friseur bis Freitag nicht zurückruft, such einen anderen')).toBe('memo');
  });
});
