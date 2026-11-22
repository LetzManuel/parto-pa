// Imported calendars (ICS links from Google, Outlook, Apple). Parsing only; fetching lives in src/platform/calendar.ts.
// Adapted from Parto Projects (src/core/calendar/sources.ts): series expanded in the window, changed and cancelled
// occurrences respected, times converted to the person's zone.
import ICAL from 'ical.js';
import type { ISODate } from '../time/dates';

export interface ImportedEvent {
  /** Stable per occurrence: uid + start. */
  key: string;
  title: string;
  date: ISODate;
  start: string | null; // 'HH:MM', null = all day
  end: string | null;
  /** Ends on a later day (or all-day over several days): the end date. */
  endDate: ISODate;
  /** Counts as busy for free windows (not "free"/transparent, not cancelled). */
  busy: boolean;
}

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';

/** Absolute time → 'YYYY-MM-DDTHH:MM' wall clock in tz. */
export function wallClock(d: Date, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const addDay = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms of local midnight of date in tz (two passes handle DST changes). */
export function zonedMidnight(date: string, tz: string): number {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const l = wallClock(new Date(t), tz);
    t += guess - Date.UTC(+l.slice(0, 4), +l.slice(5, 7) - 1, +l.slice(8, 10), +l.slice(11, 13), +l.slice(14, 16));
  }
  return t;
}

function toEpoch(t: ICAL.Time, tz: string): number {
  if (t.isDate) return zonedMidnight(`${t.year}-${pad(t.month)}-${pad(t.day)}`, tz);
  const zone = t.zone?.tzid;
  if (!zone || zone === 'floating') {
    return zonedMidnight(`${t.year}-${pad(t.month)}-${pad(t.day)}`, tz) + (t.hour * 60 + t.minute) * 60000;
  }
  return t.toUnixTime() * 1000;
}

const CANCELLED = /^\s*(abgesagt|canceled|cancelled)\s*:/i;

export function parseIcs(text: string, from: ISODate, to: ISODate, tz = localZone()): ImportedEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const vtz of comp.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(vtz); } catch { /* invalid zone: times fall back to floating */ }
  }
  const winStart = zonedMidnight(from, tz);
  const winEnd = zonedMidnight(addDay(to), tz);
  const exceptions = new Map<string, ICAL.Component[]>();
  const masters: ICAL.Component[] = [];
  for (const v of comp.getAllSubcomponents('vevent')) {
    if (v.hasProperty('recurrence-id')) {
      const uid = String(v.getFirstPropertyValue('uid'));
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), v]);
    } else masters.push(v);
  }

  const out: ImportedEvent[] = [];
  const push = (v: ICAL.Component, s: ICAL.Time, e: ICAL.Time) => {
    const sMs = toEpoch(s, tz);
    const eMs = Math.max(toEpoch(e, tz), sMs);
    if (eMs <= winStart || sMs >= winEnd) return;
    const title = String(v.getFirstPropertyValue('summary') ?? '');
    const status = String(v.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'CANCELLED' || CANCELLED.test(title)) return;
    const msBusy = String(v.getFirstPropertyValue('x-microsoft-cdo-busystatus') ?? '').toUpperCase();
    const transp = String(v.getFirstPropertyValue('transp') ?? '').toUpperCase();
    const free = msBusy === 'FREE' || (!msBusy && transp === 'TRANSPARENT');
    const allDay = s.isDate;
    const ls = wallClock(new Date(sMs), tz);
    // An all-day event ends at midnight of the next day: its last day is the day before.
    const le = wallClock(new Date(allDay ? eMs - 1 : eMs), tz);
    out.push({
      key: `${String(v.getFirstPropertyValue('uid') ?? title)}|${ls}`,
      title,
      date: ls.slice(0, 10),
      start: allDay ? null : ls.slice(11),
      end: allDay ? null : le.slice(11),
      endDate: le.slice(0, 10),
      busy: !free,
    });
  };

  for (const v of masters) {
    const ev = new ICAL.Event(v);
    for (const ex of exceptions.get(ev.uid) ?? []) {
      try { ev.relateException(ex); } catch { /* exception of another series */ }
    }
    if (!ev.isRecurring()) {
      if (ev.startDate && ev.endDate) push(v, ev.startDate, ev.endDate);
      continue;
    }
    const it = ev.iterator();
    let next: ICAL.Time | null;
    let guard = 0;
    while ((next = it.next()) && guard++ < 20000) {
      if (toEpoch(next, tz) >= winEnd) break;
      const occ = ev.getOccurrenceDetails(next);
      push(occ.item.component, occ.startDate, occ.endDate);
    }
  }
  return out.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
}

/** webcal:// links are plain https underneath. */
export const normaliseIcsUrl = (u: string): string => u.trim().replace(/^webcals?:\/\//i, 'https://');
