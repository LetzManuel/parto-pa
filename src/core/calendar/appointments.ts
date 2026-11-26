// One way for every feature to put a confirmed appointment into PA's own calendar (booking via favourites, a basket
// delivery, a rhythm that was fixed). It also tells the rhythms that the next time is planned, so "Friseurtermin
// buchen?" stops until then, and leave-by reminders pick it up through upcomingTimed (same table).
import type { Store } from '../db/store';
import { stamp, type CalEvent } from '../model';
import { rhythmBySubject } from '../rhythms/touch';
import { subjectsInTitle } from '../rhythms/subjects';
import type { ISODate } from '../time/dates';

export interface NewAppointment {
  title: string;
  date: ISODate;
  start: string | null;
  end: string | null;
  location?: string | null;
  orderId?: string | null;
  /** Rhythm subject when the caller knows it ('friseur'); otherwise PA reads it from the title. */
  subject?: string | null;
}

export function addAppointment(store: Store, a: NewAppointment): CalEvent {
  const ev = store.save('event', stamp<Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'>>({
    title: a.title, date: a.date, start: a.start, end: a.end, tentative: false, orderId: a.orderId ?? null, location: a.location ?? null,
  }));
  const subjects = a.subject ? [a.subject] : subjectsInTitle(a.title, store.list('provider')).map((s) => s.key);
  for (const key of subjects) {
    const r = rhythmBySubject(store, key);
    if (r && (!r.snoozedUntil || r.snoozedUntil < a.date)) store.save('rhythm', { ...r, snoozedUntil: a.date, updatedAt: new Date().toISOString() });
  }
  return ev;
}
