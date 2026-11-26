import { describe, expect, it } from 'vitest';
import { stamp, type CalEvent } from '../model';
import { resmio, salonized, ticketmaster, viennaLocal, type AdapterContext } from './adapters';
import { checkInOrder, freeForMe, listFor, proposal, spokenSummary } from './check';
import { handoffActions, requestText } from './handoff';
import type { Favourite } from './model';
import { parseRequest } from './request';
import { detectSystem, findBookingLinks, refFromUrl } from './systems';

const REF = '2026-11-26'; // Thursday

function fav(p: Partial<Favourite> & Pick<Favourite, 'name'>): Favourite {
  return stamp({ kind: 'salon', topic: null, priority: 1, system: 'manual', systemRef: null, bookingUrl: null, phone: null, durationMin: null, note: null, ...p }) as Favourite;
}

function ctx(routes: Record<string, unknown>, calls: string[] = []): AdapterContext {
  return {
    today: REF, ticketmasterKey: 'k',
    fetch: async (url) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => routes[key] };
    },
  };
}

describe('parseRequest', () => {
  it('reads Manuel\'s salon sentence', () => {
    const r = parseRequest('Ich brauche einen Friseurtermin morgen zwischen 14:00 und 17:00 Uhr', REF)!;
    expect(r).toMatchObject({ kind: 'salon', dateFrom: '2026-11-27', dateTo: '2026-11-27', from: '14:00', to: '17:00' });
  });

  it('reads short spoken forms', () => {
    expect(parseRequest('friseur morgen 14 bis 17 uhr', REF)).toMatchObject({ from: '14:00', to: '17:00' });
    expect(parseRequest('Haare schneiden Samstag vormittag', REF)).toMatchObject({ dateFrom: '2026-11-28', from: '08:00', to: '12:00' });
    expect(parseRequest('Friseur nächste Woche', REF)).toMatchObject({ dateFrom: '2026-11-30', dateTo: '2026-11-30' });
  });

  it('reads restaurant tables with party size', () => {
    expect(parseRequest('Tisch für 4 am Freitag um 19 Uhr', REF)).toMatchObject({ kind: 'restaurant', people: 4, dateFrom: '2026-11-27', from: '18:30', to: '19:30' });
    expect(parseRequest('heute abend essen gehen zu zweit', REF)).toMatchObject({ kind: 'restaurant', people: 2, dateFrom: REF, from: '18:00' });
  });

  it('reads tickets with keyword and month', () => {
    const r = parseRequest('2 Karten für Bilderbuch im März', REF)!;
    expect(r).toMatchObject({ kind: 'tickets', people: 2, keyword: 'Bilderbuch', dateFrom: '2027-03-01', dateTo: '2027-03-31' });
    expect(parseRequest('Konzerttickets Wanda', REF)).toMatchObject({ kind: 'tickets', keyword: 'Wanda', dateTo: '2027-02-23' });
  });

  it('reads doctors by field and babysitters', () => {
    expect(parseRequest('Zahnarzttermin nächste Woche vormittags', REF)).toMatchObject({ kind: 'doctor', topic: 'Zahnarzt', from: '08:00', to: '12:00' });
    expect(parseRequest('Babysitter Samstag ab 19 Uhr', REF)).toMatchObject({ kind: 'babysitter', dateFrom: '2026-11-28', from: '19:00', to: '23:59' });
  });

  it('returns null without a kind', () => {
    expect(parseRequest('morgen um 3', REF)).toBeNull();
  });
});

describe('systems', () => {
  it('recognises booking platforms and ids', () => {
    expect(detectSystem('https://www.treatwell.at/ort/salon-x/')?.id).toBe('treatwell');
    expect(detectSystem('doctolib.at/zahnarzt/wien/dr-x')?.id).toBe('doctolib');
    expect(detectSystem('https://salon-x.at')).toBeNull();
    expect(refFromUrl('resmio', 'https://the-fish.resmio.com')).toBe('the-fish');
    expect(refFromUrl('resmio', 'https://app.resmio.com/the-fish/widget')).toBe('the-fish');
    expect(refFromUrl('salonized', 'https://salon-x.salonized.com/widget_bookings/new')).toBe('salon-x');
  });

  it('finds an online-booking button on a doctor\'s website', () => {
    const html = '<a href="/team">Team</a><a class="btn" href="https://www.doctolib.at/zahnarzt/wien/dr-muster">Online-Termin</a>';
    expect(findBookingLinks(html, 'https://dr-muster.at')).toEqual([{ system: expect.objectContaining({ id: 'doctolib' }), url: 'https://www.doctolib.at/zahnarzt/wien/dr-muster' }]);
  });
});

describe('adapters', () => {
  const salonReq = parseRequest('Friseur morgen zwischen 14 und 17 Uhr', REF)!;

  it('resmio: free seats in the window, Vienna time', async () => {
    expect(viennaLocal('2026-11-27T18:00:00Z')).toEqual({ date: '2026-11-27', time: '19:00' });
    const req = parseRequest('Tisch für 4 morgen um 19 Uhr', REF)!;
    const r = await resmio.check(fav({ name: 'Fisch', kind: 'restaurant', system: 'resmio', systemRef: 'the-fish', bookingUrl: 'the-fish.resmio.com' }), req,
      ctx({ '/facility/the-fish/availability?date__gte=2026-11-27': { objects: [
        { date: '2026-11-27T17:30:00Z', available: 6 }, { date: '2026-11-27T18:00:00Z', available: 2 }, { date: '2026-11-27T18:15:00Z', available: 8 },
      ] } }));
    expect(r).toEqual({ status: 'slots', slots: [
      { date: '2026-11-27', start: '18:30', end: null, label: null, url: 'https://the-fish.resmio.com' },
      { date: '2026-11-27', start: '19:15', end: null, label: null, url: 'https://the-fish.resmio.com' },
    ] });
  });

  it('salonized: timeslots per day', async () => {
    const r = await salonized.check(fav({ name: 'Salon X', system: 'salonized', systemRef: 'salon-x:42' }), salonReq,
      ctx({ 'salon-x.salonized.com/bookings/timeslots?service_ids=42&date=2026-11-27': [{ date: '2026-11-27', time: '09:00' }, { date: '2026-11-27', time: '15:30' }] }));
    expect(r).toMatchObject({ status: 'slots', slots: [{ start: '15:30', url: 'https://salon-x.salonized.com/widget_bookings/new' }] });
  });

  it('ticketmaster: on-sale events in Austria', async () => {
    const calls: string[] = [];
    const req = parseRequest('2 Tickets Bilderbuch im März', REF)!;
    const r = await ticketmaster.check(fav({ name: 'Ticketmaster', kind: 'tickets', system: 'ticketmaster' }), req, ctx({ 'discovery/v2/events.json': { _embedded: { events: [
      { name: 'Bilderbuch', url: 'https://www.ticketmaster.at/event/1', dates: { start: { localDate: '2027-03-12', localTime: '20:00:00' }, status: { code: 'onsale' } } },
      { name: 'Bilderbuch', url: 'https://www.ticketmaster.at/event/2', dates: { start: { localDate: '2027-03-13' }, status: { code: 'canceled' } } },
    ] } } }, calls));
    expect(calls[0]).toContain('countryCode=AT');
    expect(calls[0]).toContain('keyword=Bilderbuch');
    expect(r).toEqual({ status: 'slots', slots: [{ date: '2027-03-12', start: '20:00', end: null, label: 'Bilderbuch', url: 'https://www.ticketmaster.at/event/1' }] });
  });

  it('errors and missing ids fall back to the handoff', async () => {
    expect(await resmio.check(fav({ name: 'X', kind: 'restaurant', system: 'resmio' }), salonReq, ctx({}))).toMatchObject({ status: 'manual' });
    expect(await resmio.check(fav({ name: 'X', kind: 'restaurant', system: 'resmio', systemRef: 'x' }), salonReq, ctx({}))).toMatchObject({ status: 'error' });
    expect(await ticketmaster.check(fav({ name: 'T', kind: 'tickets', system: 'ticketmaster' }), salonReq, { ...ctx({}), ticketmasterKey: null })).toMatchObject({ status: 'manual' });
  });
});

describe('checkInOrder', () => {
  const req = parseRequest('Friseurtermin morgen zwischen 14 und 17 Uhr', REF)!;
  const a = fav({ name: 'Salon A', priority: 1, system: 'salonized', systemRef: 'a:1' });
  const b = fav({ name: 'Salon B', priority: 2, system: 'salonized', systemRef: 'b:1' });
  const c = fav({ name: 'Salon C', priority: 3, system: 'treatwell', bookingUrl: 'https://www.treatwell.at/ort/c/' });
  const routes = {
    'a.salonized.com': [],
    'b.salonized.com': [{ date: '2026-11-27', time: '14:00' }, { date: '2026-11-27', time: '16:00' }],
  };

  it('goes down the list and stops at the first free slot', async () => {
    const calls: string[] = [];
    const out = await checkInOrder(listFor([c, b, a], req), req, ctx(routes, calls));
    expect(out.map((o) => [o.fav.name, o.result.status])).toEqual([['Salon A', 'full'], ['Salon B', 'slots']]);
    expect(proposal(out)).toMatchObject({ fav: { name: 'Salon B' }, slot: { start: '14:00' } });
    expect(spokenSummary(out, req, REF)).toBe('Salon A hat nichts frei. Salon B hat morgen um 14:00 frei. Auch 16:00. Zum Buchen tippen.');
  });

  it('skips slots that clash with my calendar', async () => {
    const busy = [stamp({ title: 'Meeting', date: '2026-11-27', start: '13:30', end: '15:00', tentative: false, orderId: null }) as CalEvent];
    expect(freeForMe([{ date: '2026-11-27', start: '14:00', end: null, label: null, url: null }, { date: '2026-11-27', start: '16:00', end: null, label: null, url: null }], b, busy).map((s) => s.start)).toEqual(['16:00']);
    const out = await checkInOrder([a, b], req, ctx(routes), { busy });
    expect(proposal(out)?.slot?.start).toBe('16:00');
  });

  it('proposes the handoff where nothing can be read', async () => {
    const out = await checkInOrder([a, c], req, ctx(routes));
    expect(out[1].result.status).toBe('manual');
    expect(proposal(out)).toMatchObject({ fav: { name: 'Salon C' }, slot: null });
    expect(spokenSummary(out, req, REF)).toBe('Salon A hat nichts frei. Bei Salon C kann ich nicht nachsehen. Buchungsseite öffnen?');
  });

  it('picks the doctor list by field', () => {
    const z = fav({ name: 'Dr. Zahn', kind: 'doctor', topic: 'Zahnarzt' });
    const h = fav({ name: 'Dr. Haus', kind: 'doctor', topic: 'Hausarzt' });
    expect(listFor([z, h], { kind: 'doctor', topic: 'Zahnarzt' }).map((f) => f.name)).toEqual(['Dr. Zahn']);
  });
});

describe('handoff', () => {
  it('prepares WhatsApp, SMS and call for a babysitter', () => {
    const req = parseRequest('Babysitter Samstag ab 19 Uhr', REF)!;
    const f = fav({ name: 'Lena Huber', kind: 'babysitter', phone: '0664 123 45 67' });
    const text = requestText(f, req, REF, 'Manuel Letz');
    expect(text).toContain('hättest du übermorgen ab 19:00 Uhr Zeit? Es geht ums Babysitten.');
    const links = handoffActions(f, req, REF, null, 'Manuel Letz');
    expect(links.map((a) => a.kind)).toEqual(['whatsapp', 'sms', 'call']);
    expect(links[0].url).toBe(`https://wa.me/436641234567?text=${encodeURIComponent(text)}`);
  });

  it('links a doctor\'s booking platform, else the call', () => {
    const req = parseRequest('Zahnarzt nächste Woche', REF)!;
    const d = fav({ name: 'Dr. Zahn', kind: 'doctor', system: 'doctolib', bookingUrl: 'doctolib.at/x', phone: '01 234' });
    expect(handoffActions(d, req, REF)).toEqual([
      { kind: 'web', label: 'Auf Doctolib ansehen', url: 'https://doctolib.at/x' },
      { kind: 'call', label: 'Anrufen', url: 'tel:01234' },
    ]);
  });
});
