import type { Order, OrderKind } from '../model';
import { stamp } from '../model';
import { addDays, addInterval, addWorkdays, type ISODate } from '../time/dates';

export const DEFAULT_WAIT_DAYS = 2;
export const DEFAULT_LEAD_DAYS = 14;

export type OrderDraft = Partial<Omit<Order, 'id' | 'createdAt' | 'updatedAt'>> & { title: string; kind: OrderKind };

export function createOrder(d: OrderDraft, now = new Date()): Order {
  return stamp<Omit<Order, 'id' | 'createdAt' | 'updatedAt'>>({
    state: d.kind === 'conditional' || d.kind === 'followup' ? 'waiting' : 'open',
    dueDate: null,
    waitDays: DEFAULT_WAIT_DAYS,
    waitingFor: null,
    fallback: null,
    place: null,
    everyN: null,
    everyUnit: null,
    leadDays: d.kind === 'birthday' ? 5 : DEFAULT_LEAD_DAYS,
    lastDone: null,
    providerId: null,
    source: null,
    note: null,
    ...d,
  }, now);
}

const touch = (o: Order, patch: Partial<Order>): Order => ({ ...o, ...patch, updatedAt: new Date().toISOString() });

/** Next occurrence of a recurring order (last done + interval), or null without a rhythm. */
export function nextOccurrence(o: Pick<Order, 'everyN' | 'everyUnit' | 'lastDone'>): ISODate | null {
  if (!o.everyN || !o.everyUnit || !o.lastDone) return null;
  return addInterval(o.lastDone, o.everyN, o.everyUnit);
}

/** Date from which PA suggests booking the next occurrence. */
export function suggestFrom(o: Order): ISODate | null {
  const next = nextOccurrence(o);
  return next ? addDays(next, -o.leadDays) : o.dueDate;
}

/** The user asked someone (call, mail, booking page): PA now waits for the answer. */
export function markRequested(o: Order, today: ISODate, waitingFor?: string): Order {
  return touch(o, { state: 'waiting', dueDate: addWorkdays(today, o.waitDays), waitingFor: waitingFor ?? o.waitingFor });
}

/** Keep waiting: ask again after another waiting period. */
export function waitLonger(o: Order, today: ISODate): Order {
  return touch(o, { dueDate: addWorkdays(today, o.waitDays) });
}

export function snooze(o: Order, today: ISODate, days: number): Order {
  return touch(o, { dueDate: addDays(today, days) });
}

/**
 * Done. A recurring order (or birthday) starts its next round instead of closing:
 * lastDone moves on and the next suggestion date is computed from the rhythm.
 */
export function complete(o: Order, today: ISODate): Order {
  if (o.kind === 'recurring' && o.everyN && o.everyUnit) {
    const next = addInterval(today, o.everyN, o.everyUnit);
    return touch(o, { state: 'open', lastDone: today, dueDate: addDays(next, -o.leadDays), waitingFor: null });
  }
  if (o.kind === 'birthday' && o.dueDate) {
    return touch(o, { state: 'open', lastDone: today, dueDate: addInterval(o.dueDate, 1, 'year') });
  }
  return touch(o, { state: 'done', lastDone: today });
}

export function cancel(o: Order): Order {
  return touch(o, { state: 'cancelled' });
}

/**
 * Conditional order whose deadline passed without an answer: switch to plan B.
 * The order stays open with plan B as its new title, the condition is resolved.
 */
export function runFallback(o: Order, today: ISODate): Order {
  return touch(o, {
    kind: 'reminder',
    state: 'open',
    title: o.fallback ? capitalize(o.fallback) : o.title,
    note: `Plan B, weil ${o.waitingFor ?? 'niemand'} nicht geantwortet hat (${o.title})`,
    fallback: null,
    dueDate: today,
  });
}

export function isActive(o: Order): boolean {
  return o.state === 'open' || o.state === 'waiting';
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
