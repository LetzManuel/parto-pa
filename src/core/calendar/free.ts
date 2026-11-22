import type { CalEvent } from '../model';
import { addDays, formatShort, type ISODate } from '../time/dates';

export interface Window {
  date: ISODate;
  from: string; // HH:MM
  to: string;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Free windows in the calendar, e.g. "after 17:00 on the next 7 days". Only times, never the content of other
 * appointments: this is what may later be handed to the assistant or shown on the call cheat sheet.
 */
export function freeWindows(
  events: CalEvent[],
  opts: { from: ISODate; days: number; dayStart: string; dayEnd: string; minMinutes: number; skipWeekends?: boolean },
): Window[] {
  const out: Window[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    const wd = new Date(date + 'T12:00').getDay();
    if (opts.skipWeekends && (wd === 0 || wd === 6)) continue;
    const today = events.filter((e) => e.date === date);
    if (today.some((e) => !e.start)) continue; // all-day event: treat the day as busy
    const busy = today
      .map((e) => [toMin(e.start!), toMin(e.end ?? e.start!) || toMin(e.start!) + 60] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    let cursor = toMin(opts.dayStart);
    const end = toMin(opts.dayEnd);
    for (const [s, e] of busy) {
      if (s - cursor >= opts.minMinutes && s <= end) out.push({ date, from: toTime(cursor), to: toTime(Math.min(s, end)) });
      cursor = Math.max(cursor, e);
    }
    if (end - cursor >= opts.minMinutes) out.push({ date, from: toTime(cursor), to: toTime(end) });
  }
  return out;
}

export function describeWindows(ws: Window[], ref: ISODate, max = 3): string {
  return ws.slice(0, max).map((w) => `${formatShort(w.date, ref)} ${w.from}–${w.to}`).join(', ');
}
