// Provider adapters: one per readable booking system, all behind the same check(). Anything PA cannot read goes to
// the manual adapter, which only prepares the handoff. New systems (partner APIs from Phase 3) plug in here.
import { addDays, type ISODate } from '../time/dates';
import type { BookingRequest, CheckResult, Favourite, Slot, SystemId } from './model';
import { normalizeUrl } from './systems';

export interface AdapterContext {
  /** Injected so tests, the web relay and the phone shell (native HTTP, no CORS) can each bring their own. */
  fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** Ticketmaster Discovery API key (free developer key). Without it ticket checks fall back to the link. */
  ticketmasterKey?: string | null;
  /** Today in the person's time zone, for "demo" and for ranges. */
  today: ISODate;
}

export interface Adapter {
  system: SystemId;
  check(fav: Favourite, req: BookingRequest, ctx: AdapterContext): Promise<CheckResult>;
}

const TZ = 'Europe/Vienna';
const inWindow = (t: string, req: BookingRequest) => t >= req.from && t <= req.to;
const inDays = (d: ISODate, req: BookingRequest) => d >= req.dateFrom && d <= req.dateTo;

/** A UTC timestamp as local date and time in Vienna. */
export function viennaLocal(iso: string): { date: ISODate; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function days(req: BookingRequest, max: number): ISODate[] {
  const out: ISODate[] = [];
  for (let d = req.dateFrom; d <= req.dateTo && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

const fail = (e: unknown): CheckResult => ({ status: 'error', reason: String((e as Error)?.message ?? e).slice(0, 120) });
const found = (slots: Slot[]): CheckResult => (slots.length ? { status: 'slots', slots } : { status: 'full' });

/**
 * resmio (restaurants): public availability per facility, GET /v1/facility/{id}/availability?date__gte=YYYY-MM-DD.
 * Each entry is one bookable time with the number of free seats in "available".
 */
export const resmio: Adapter = {
  system: 'resmio',
  async check(fav, req, ctx) {
    if (!fav.systemRef) return { status: 'manual', reason: 'resmio-Kennung fehlt' };
    try {
      const url = `https://api.resmio.com/v1/facility/${encodeURIComponent(fav.systemRef)}/availability?date__gte=${req.dateFrom}`;
      const res = await ctx.fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return fail(`HTTP ${res.status}`);
      const body = (await res.json()) as { objects?: Array<{ date: string; available: number }> } | Array<{ date: string; available: number }>;
      const rows = Array.isArray(body) ? body : body.objects ?? [];
      const need = req.people ?? 2;
      const slots: Slot[] = [];
      for (const r of rows) {
        if (!r?.date || !(r.available >= need)) continue;
        const l = viennaLocal(r.date);
        if (inDays(l.date, req) && inWindow(l.time, req)) slots.push({ date: l.date, start: l.time, end: null, label: null, url: normalizeUrl(fav.bookingUrl) });
      }
      return found(slots);
    } catch (e) { return fail(e); }
  },
};

/**
 * Salonized (salons): the salon's own booking page serves time slots,
 * GET https://{salon}.salonized.com/bookings/timeslots?service_ids=…&date=YYYY-MM-DD. systemRef = "salon:serviceId".
 */
export const salonized: Adapter = {
  system: 'salonized',
  async check(fav, req, ctx) {
    const [sub, service] = (fav.systemRef ?? '').split(':');
    if (!sub || !service) return { status: 'manual', reason: 'Salonized-Salon oder Leistung fehlt' };
    try {
      const slots: Slot[] = [];
      for (const date of days(req, 7)) {
        const res = await ctx.fetch(`https://${encodeURIComponent(sub)}.salonized.com/bookings/timeslots?service_ids=${encodeURIComponent(service)}&date=${date}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return fail(`HTTP ${res.status}`);
        const rows = (await res.json()) as Array<{ date?: string; time?: string; full_date?: string }>;
        for (const r of Array.isArray(rows) ? rows : []) {
          const d = r.date ?? r.full_date?.slice(0, 10) ?? date;
          const t = (r.time ?? '').slice(0, 5);
          if (t && inDays(d, req) && inWindow(t, req)) slots.push({ date: d, start: t, end: null, label: null, url: normalizeUrl(fav.bookingUrl) ?? `https://${sub}.salonized.com/widget_bookings/new` });
        }
        if (slots.length >= 6) break;
      }
      return found(slots);
    } catch (e) { return fail(e); }
  },
};

/**
 * Ticketmaster Discovery API (tickets): events in Austria for the keyword in the date range, with sale status.
 * systemRef can pin a venue id; otherwise the request keyword (or the favourite's name) is searched.
 */
export const ticketmaster: Adapter = {
  system: 'ticketmaster',
  async check(fav, req, ctx) {
    if (!ctx.ticketmasterKey) return { status: 'manual', reason: 'Ticketmaster-Schlüssel fehlt' };
    const keyword = req.keyword ?? '';
    if (!keyword && !fav.systemRef) return { status: 'manual', reason: 'Kein Künstler oder Event angegeben' };
    try {
      const p = new URLSearchParams({ apikey: ctx.ticketmasterKey, countryCode: 'AT', locale: '*', size: '20', sort: 'date,asc',
        startDateTime: `${req.dateFrom}T00:00:00Z`, endDateTime: `${req.dateTo}T23:59:59Z` });
      if (keyword) p.set('keyword', keyword);
      if (fav.systemRef) p.set('venueId', fav.systemRef);
      const res = await ctx.fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${p}`);
      if (!res.ok) return fail(`HTTP ${res.status}`);
      const body = (await res.json()) as { _embedded?: { events?: Array<{ name: string; url?: string; dates?: { start?: { localDate?: string; localTime?: string }; status?: { code?: string } } }> } };
      const slots: Slot[] = [];
      for (const e of body._embedded?.events ?? []) {
        const d = e.dates?.start?.localDate;
        const code = e.dates?.status?.code ?? 'onsale';
        if (!d || !['onsale', 'rescheduled'].includes(code)) continue;
        slots.push({ date: d, start: (e.dates?.start?.localTime ?? '').slice(0, 5) || '00:00', end: null, label: e.name, url: e.url ?? normalizeUrl(fav.bookingUrl) });
      }
      return found(slots);
    } catch (e) { return fail(e); }
  },
};

/** Example data for the preview and tests: a fixed pattern of free times, no network. */
export const demo: Adapter = {
  system: 'demo',
  async check(fav, req) {
    const step = fav.kind === 'restaurant' ? 30 : 45;
    const seed = [...fav.name].reduce((a, c) => a + c.charCodeAt(0), 0);
    if (seed % 3 === 0) return { status: 'full' };
    const slots: Slot[] = [];
    if (fav.kind === 'tickets') {
      for (let d = req.dateFrom, i = 0; d <= req.dateTo && slots.length < 3; d = addDays(d, 1), i++) {
        if ((seed + i) % 9 === 4) slots.push({ date: d, start: '20:00', end: null, label: `${req.keyword ?? fav.name} live`, url: normalizeUrl(fav.bookingUrl) });
      }
      return found(slots);
    }
    for (const date of days(req, 3)) {
      let m = Number(req.from.slice(0, 2)) * 60 + Number(req.from.slice(3)) + (seed % 2) * 15;
      const end = Number(req.to.slice(0, 2)) * 60 + Number(req.to.slice(3));
      for (let i = 0; m <= end && slots.length < 4; i++, m += step) {
        if ((seed + i) % 2 === 0) slots.push({ date, start: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, end: null,
          label: null, url: normalizeUrl(fav.bookingUrl) });
      }
      if (slots.length) break;
    }
    return found(slots);
  },
};

export const ADAPTERS: Partial<Record<SystemId, Adapter>> = { resmio, salonized, ticketmaster, demo };

export function adapterFor(system: SystemId): Adapter | null {
  return ADAPTERS[system] ?? null;
}
