import type { Store } from '../core/db/store';
import type { Provider } from '../core/model';
import { complete, createOrder, isActive } from '../core/orders/flow';
import type { ISODate } from '../core/time/dates';

/** A provider with a rhythm ("Friseur alle 6 Wochen") keeps one recurring order, so the briefing can suggest it. */
export function syncProviderOrder(store: Store, p: Provider): void {
  const existing = store.list('order').find((o) => o.providerId === p.id && o.kind === 'recurring' && isActive(o));
  if (!p.everyN || !p.everyUnit) {
    if (existing) store.remove('order', existing.id);
    return;
  }
  const patch = { title: p.service ? `${p.service} (${p.name})` : p.name, everyN: p.everyN, everyUnit: p.everyUnit, lastDone: p.lastVisit };
  if (existing) store.save('order', { ...existing, ...patch, updatedAt: new Date().toISOString() });
  else store.save('order', createOrder({ ...patch, kind: 'recurring', providerId: p.id, source: 'aus Meine Dienstleister' }));
}

/** Visit happened: provider's last visit moves, its recurring order starts the next round. */
export function recordVisit(store: Store, p: Provider, today: ISODate): void {
  store.save('provider', { ...p, lastVisit: today, updatedAt: new Date().toISOString() });
  const o = store.list('order').find((x) => x.providerId === p.id && x.kind === 'recurring' && isActive(x));
  if (o) store.save('order', complete(o, today));
  for (const w of store.list('order').filter((x) => x.providerId === p.id && x.kind !== 'recurring' && isActive(x))) {
    store.save('order', complete(w, today));
  }
}
