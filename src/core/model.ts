import type { ISODate, Unit } from './time/dates';

/** Every row lives in a space. In Phase 1 that is the person's own space (group of kind 'personal', one member). */
export interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderKind = 'reminder' | 'location' | 'followup' | 'conditional' | 'recurring' | 'birthday';
/** Concept states offen → angefragt/wartet → erledigt | abgebrochen. "angefragt" and "wartet auf Antwort" are one state here. */
export type OrderState = 'open' | 'waiting' | 'done' | 'cancelled';

/** An "Auftrag": anything PA keeps running until it is done. */
export interface Order extends Row {
  title: string;
  kind: OrderKind;
  state: OrderState;
  /** Date of the next step: reminder date, follow-up date, condition deadline, next suggestion for recurring. */
  dueDate: ISODate | null;
  /** Working days to wait for an answer before PA asks again (default 2). */
  waitDays: number;
  /** Who we are waiting for ("der Installateur"). */
  waitingFor: string | null;
  /** Plan B for conditional orders ("einen anderen suchen"). */
  fallback: string | null;
  /** Place for location reminders ("Billa"). Geofence runs on the device only. */
  place: string | null;
  everyN: number | null;
  everyUnit: Unit | null;
  /** Days before the next occurrence when PA suggests booking (recurring), default 14. */
  leadDays: number;
  lastDone: ISODate | null;
  providerId: string | null;
  /** Where it came from, e.g. "aus Memo vom 22.11." */
  source: string | null;
  note: string | null;
}

export type ProviderCategory = 'beauty' | 'trades' | 'other';
export type BookingWay = 'phone' | 'web' | 'email';

export interface Provider extends Row {
  name: string;
  category: ProviderCategory;
  /** Usual service ("Maniküre Gel"). */
  service: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bookingWay: BookingWay;
  everyN: number | null;
  everyUnit: Unit | null;
  lastVisit: ISODate | null;
  contactPerson: string | null;
  notes: string | null;
}

export type DeadlineKind = 'pickerl' | 'passport' | 'idcard' | 'warranty' | 'contract' | 'checkup' | 'other';

export interface Deadline extends Row {
  title: string;
  kind: DeadlineKind;
  dueDate: ISODate;
  leadDays: number;
  everyN: number | null;
  everyUnit: Unit | null;
  note: string | null;
}

export type MemoryCategory = 'preference' | 'person' | 'fact' | 'health';

/** "Was PA über mich weiß": every entry visible, editable, deletable, with its origin. */
export interface MemoryEntry extends Row {
  text: string;
  category: MemoryCategory;
  /** e.g. "von Hand", "aus Memo vom 22.11." */
  source: string;
}

export interface CalEvent extends Row {
  title: string;
  date: ISODate;
  start: string | null; // 'HH:MM', null = all day
  end: string | null;
  /** Held for a booking that is not confirmed yet. */
  tentative: boolean;
  orderId: string | null;
}

export interface Memo extends Row {
  text: string;
  /** What it became: 'order:<id>', 'memory:<id>', 'note' – or null while unprocessed. */
  result: string | null;
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function stamp<T extends object>(data: T, now = new Date()): T & Row {
  const t = now.toISOString();
  return { id: newId(), createdAt: t, updatedAt: t, ...data };
}
