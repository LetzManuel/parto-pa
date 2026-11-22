import type { Store } from '../core/db/store';
import type { ActionId, Hint } from '../core/briefing/briefing';
import { renew } from '../core/deadlines/deadlines';
import { createOrder, complete, cancel, markRequested, runFallback, snooze, waitLonger } from '../core/orders/flow';
import type { ISODate } from '../core/time/dates';

/** Runs a hint action. Everything here only changes the user's own data; nothing is sent anywhere. */
export function runAction(store: Store, hint: Hint, action: ActionId, today: ISODate): void {
  if (hint.target.type === 'deadline') {
    const d = store.get('deadline', hint.target.id);
    if (!d) return;
    if (action === 'renew') {
      const next = renew(d);
      if (next) store.save('deadline', next);
      else store.remove('deadline', d.id);
    } else if (action === 'plan') {
      store.save('order', createOrder({ title: `Termin für ${d.title} ausmachen`, kind: 'reminder', dueDate: today, source: `aus Frist ${d.title}` }));
      store.save('deadline', { ...d, leadDays: Math.max(0, d.leadDays - 7), updatedAt: new Date().toISOString() });
    } else if (action === 'snooze') {
      store.save('deadline', { ...d, leadDays: Math.max(0, d.leadDays - 7), updatedAt: new Date().toISOString() });
    }
    return;
  }
  const o = store.get('order', hint.target.id);
  if (!o) return;
  switch (action) {
    case 'done': store.save('order', complete(o, today)); break;
    case 'snooze': store.save('order', snooze(o, today, 7)); break;
    case 'wait': store.save('order', waitLonger(o, today)); break;
    case 'requested': store.save('order', markRequested(o, today)); break;
    case 'fallback': store.save('order', runFallback(o, today)); break;
    case 'cancel': store.save('order', cancel(o)); break;
    default: break;
  }
}
