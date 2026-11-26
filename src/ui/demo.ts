import type { Store } from '../core/db/store';
import { createDeadline } from '../core/deadlines/deadlines';
import { createMemory } from '../core/memory/memory';
import { stamp, type Provider } from '../core/model';
import { createOrder, markRequested } from '../core/orders/flow';
import { addDays, addMonths, today as todayISO } from '../core/time/dates';
import { syncProviderOrder } from './providers';
import { createRhythm } from '../core/rhythms/engine';
import { createTouch } from '../core/rhythms/history';

/** Sample data for pilot demos, relative to today. */
export function loadDemo(store: Store, ref = todayISO()): void {
  const prov = (p: Partial<Provider> & { name: string; category: Provider['category'] }) =>
    store.save('provider', stamp<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>({
      service: null, phone: null, email: null, website: null, bookingWay: 'phone', everyN: null, everyUnit: null,
      lastVisit: null, contactPerson: null, notes: null, ...p,
    }));
  const hair = prov({ name: 'Salon Haarmonie', category: 'beauty', service: 'Haarschnitt', phone: '+43 1 234 56 78', email: 'termin@haarmonie.example', everyN: 6, everyUnit: 'week', lastVisit: addDays(ref, -44), contactPerson: 'Frau Berger' });
  const nails = prov({ name: 'Studio Nails', category: 'beauty', service: 'Maniküre Gel', website: 'fresha.com/studio-nails', bookingWay: 'web', everyN: 4, everyUnit: 'week', lastVisit: addDays(ref, -10) });
  const plumber = prov({ name: 'Installateur Wagner', category: 'trades', service: 'Therme warten', phone: '+43 664 123 45 67', bookingWay: 'phone' });
  for (const p of [hair, nails, plumber]) syncProviderOrder(store, p);

  store.save('order', createOrder({ title: 'Rückruf Installateur Wagner', kind: 'conditional', waitingFor: 'Installateur Wagner', fallback: 'Einen anderen Installateur suchen', dueDate: addDays(ref, -1), providerId: plumber.id, source: 'aus Memo' }));
  store.save('order', markRequested(createOrder({ title: 'Versicherung: Erstattung Brille', kind: 'followup', source: 'aus Memo' }), addDays(ref, -1)));
  store.save('order', createOrder({ title: 'Batterien kaufen', kind: 'location', place: 'Billa' }));
  store.save('order', createOrder({ title: 'Steuerausgleich einreichen', kind: 'reminder', dueDate: ref }));
  store.save('order', createOrder({ title: 'Geburtstag Anna', kind: 'birthday', dueDate: addDays(ref, 3) }));
  store.save('memory', createMemory('Anna mag Orchideen', 'aus Memo'));
  store.save('memory', createMemory('Nie vor 9 Uhr', 'von Hand'));
  store.save('memory', createMemory('Maniküre maximal 60 €', 'von Hand'));
  store.save('memory', createMemory('Allergie gegen Gel-Lack mit HEMA', 'von Hand'));
  store.save('deadline', createDeadline({ kind: 'pickerl', title: '§57a-Pickerl Golf', dueDate: addDays(ref, 20) }));
  store.save('deadline', createDeadline({ kind: 'passport', dueDate: addMonths(ref, 5) }));
  store.save('deadline', createDeadline({ kind: 'contract', title: 'Fitnessstudio kündbar bis', dueDate: addDays(ref, 45) }));
  store.save('event', stamp({ title: 'Team-Meeting', date: ref, start: '09:30', end: '10:30', tentative: false, orderId: null }));
  store.save('event', stamp({ title: 'Laufen mit Ben', date: ref, start: '18:00', end: '19:00', tentative: false, orderId: null }));
  // Rhythms: Anna is overdue (call), Mama is fine; "Kaffee mit Lisa" every two weeks in the calendar is a learned proposal.
  store.save('rhythm', createRhythm({ subject: 'person:anna', label: 'Anna', kind: 'contact', everyN: 3, everyUnit: 'week', lastDone: addDays(ref, -36), phone: '+43 660 765 43 21' }));
  store.save('rhythm', createRhythm({ subject: 'person:mama', label: 'Mama', kind: 'contact', everyN: 1, everyUnit: 'week', channel: 'message' }));
  store.save('touch', createTouch({ subject: 'person:mama', kind: 'contact', date: addDays(ref, -3), source: 'voice', direction: 'in' }));
  store.save('rhythm', createRhythm({ subject: 'massage', label: 'Massage', kind: 'booking', everyN: 2, everyUnit: 'month', lastDone: addDays(ref, -40) }));
  for (const d of [-44, -30, -16, -3]) {
    store.save('event', stamp({ title: 'Kaffee mit Lisa', date: addDays(ref, d), start: '08:15', end: '09:00', tentative: false, orderId: null }));
  }
  store.save('event', stamp({ title: 'Elternabend', date: addDays(ref, 1), start: '18:30', end: '20:00', tentative: false, orderId: null }));
}
