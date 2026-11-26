// History for rhythms: when did something happen? Sources in the pilot:
//  1. touches the user logged (by voice, by a tap on a suggestion, by the message or booking flow),
//  2. calendar entries (own and subscribed ICS calendars): "Friseur", "Kaffee mit Lisa", "Anna anrufen",
//  3. a provider's "zuletzt dort".
// Not available in the pilot: the phone's call log, SMS/WhatsApp history, e-mail (see README).
import type { CalEvent, Provider, RhythmKind, Touch } from '../model';
import { stamp } from '../model';
import type { ISODate } from '../time/dates';
import { providerKey, serviceByKey, subjectsInTitle } from './subjects';

export interface Occurrence {
  key: string;
  label: string;
  kind: RhythmKind;
  date: ISODate;
  from: 'touch' | 'calendar' | 'provider';
}

export function occurrences(
  input: { touches: Touch[]; events: Pick<CalEvent, 'title' | 'date'>[]; providers: Provider[] },
  today: ISODate,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const t of input.touches) {
    if (t.date <= today) out.push({ key: t.subject, label: '', kind: t.kind, date: t.date, from: 'touch' });
  }
  for (const e of input.events) {
    if (e.date > today) continue; // planned, not happened yet
    for (const s of subjectsInTitle(e.title, input.providers)) out.push({ ...s, date: e.date, from: 'calendar' });
  }
  for (const p of input.providers) {
    if (p.lastVisit && p.lastVisit <= today) {
      const key = providerKey(p);
      out.push({ key, label: serviceByKey(key)?.label ?? p.name, kind: 'booking', date: p.lastVisit, from: 'provider' });
    }
  }
  return out;
}

/** Distinct days per key, oldest first. Several calendar entries on one day count once. */
export function byKey(list: Occurrence[]): Map<string, Occurrence[]> {
  const map = new Map<string, Map<ISODate, Occurrence>>();
  for (const o of list) {
    const days = map.get(o.key) ?? new Map<ISODate, Occurrence>();
    const prev = days.get(o.date);
    if (!prev || (!prev.label && o.label)) days.set(o.date, o);
    map.set(o.key, days);
  }
  const out = new Map<string, Occurrence[]>();
  for (const [k, days] of map) out.set(k, [...days.values()].sort((a, b) => a.date.localeCompare(b.date)));
  return out;
}

export function lastOccurrence(list: Occurrence[], key: string): ISODate | null {
  let last: ISODate | null = null;
  for (const o of list) if (o.key === key && (!last || o.date > last)) last = o.date;
  return last;
}

export function createTouch(d: { subject: string; kind: RhythmKind; date: ISODate; source: Touch['source']; direction?: Touch['direction'] }, now = new Date()): Touch {
  return stamp({ subject: d.subject, kind: d.kind, date: d.date, source: d.source, direction: d.direction ?? null }, now);
}
