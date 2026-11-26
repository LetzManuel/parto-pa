// Timed appointments in the next hours, own and imported, with their absolute start. Shared calendar access for
// reminders (leave-by times) and anything else that needs "what comes next" rather than a day list.
import type { Store } from '../db/store';
import { addDays } from '../time/dates';
import { importedEvents } from './feeds';
import { cleanLocation, localZone, wallClock, zonedMidnight } from './ics';

export interface Upcoming {
  /** Stable per occurrence: own event id, or the imported uid + start. */
  key: string;
  title: string;
  date: string;
  start: string;
  end: string | null;
  startMs: number;
  endMs: number;
  location: string | null;
  /** Label of the subscribed calendar; undefined for PA's own events. */
  feed?: string;
}

/** Epoch ms of a wall-clock date + 'HH:MM' in tz. */
export function atLocal(date: string, hhmm: string, tz = localZone()): number {
  const day = zonedMidnight(date, tz);
  const ms = day + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) * 60000;
  // On a DST change day the offset may differ between midnight and the time: correct once.
  const wall = wallClock(new Date(ms), tz);
  const drift = (Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16))) - (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));
  return wall.slice(0, 10) === date ? ms - drift * 60000 : ms;
}

/**
 * Timed events whose start lies in [nowMs - backMin, nowMs + hours]. All-day events are left out (the morning
 * briefing covers them), and so are imported events marked "free" only when they have no place.
 */
export function upcomingTimed(store: Store, nowMs: number, hours = 24, opts: { backMin?: number; tz?: string } = {}): Upcoming[] {
  const tz = opts.tz ?? localZone();
  const from = nowMs - (opts.backMin ?? 0) * 60000;
  const to = nowMs + hours * 3600000;
  const today = wallClock(new Date(nowMs), tz).slice(0, 10);
  const lastDay = addDays(today, Math.ceil(hours / 24) + 1);
  const out: Upcoming[] = [];

  for (const e of store.list('event')) {
    if (!e.start || e.date < addDays(today, -1) || e.date > lastDay) continue;
    const startMs = atLocal(e.date, e.start, tz);
    const endMs = e.end && e.end > e.start ? atLocal(e.date, e.end, tz) : startMs + 3600000;
    out.push({ key: e.id, title: e.title, date: e.date, start: e.start, end: e.end, startMs, endMs, location: cleanLocation(e.location) });
  }
  for (const e of importedEvents(store)) {
    if (!e.start || e.date < addDays(today, -1) || e.date > lastDay) continue;
    if (!e.busy && !e.location) continue;
    const startMs = atLocal(e.date, e.start, tz);
    const endMs = e.end ? atLocal(e.endDate, e.end, tz) : startMs + 3600000;
    out.push({ key: e.key, title: e.title, date: e.date, start: e.start, end: e.end, startMs, endMs, location: e.location ?? null, feed: e.feed });
  }
  return out.filter((u) => u.startMs >= from && u.startMs <= to).sort((a, b) => a.startMs - b.startMs);
}
