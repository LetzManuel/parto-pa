import type { Store } from '../core/db/store';
import { createDeadline } from '../core/deadlines/deadlines';
import { createMemory } from '../core/memory/memory';
import { stamp, type Provider } from '../core/model';
import { createOrder, markRequested } from '../core/orders/flow';
import { addDays, addMonths, today as todayISO } from '../core/time/dates';
import { syncProviderOrder } from './providers';
import { listFromIntent } from '../core/shopping/lists';
import { parseShopping } from '../core/shopping/parse';

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
  // Wocheneinkauf ready for tomorrow (prepared a day ahead), and a saved pizza order.
  const week = listFromIntent(parseShopping('Jeden Samstag Wocheneinkauf bei gurkerl: 2 l Milch, 10 Eier, Bananen, Vollkornbrot, Butter, Joghurt')!, ref);
  store.save('shopList', { ...week, weekday: null, nextDate: addDays(ref, 1) });
  store.save('shopList', { ...listFromIntent(parseShopping('Pizza Freitag bei Lieferando: Pizza Margherita, Pizza Diavola')!, ref), name: 'Pizza Freitag', state: 'active', nextDate: null });
  store.save('event', stamp({ title: 'Team-Meeting', date: ref, start: '09:30', end: '10:30', tentative: false, orderId: null }));
  store.save('event', stamp({ title: 'Laufen mit Ben', date: ref, start: '18:00', end: '19:00', tentative: false, orderId: null }));
  store.save('event', stamp({ title: 'Elternabend', date: addDays(ref, 1), start: '18:30', end: '20:00', tentative: false, orderId: null }));
}
