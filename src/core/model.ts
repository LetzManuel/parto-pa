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
  /** Where it takes place (address or place name). With a place PA works out when to leave. */
  location?: string | null;
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

export type ShopKind = 'grocery' | 'food';

/**
 * Einkaufsliste / Bestellkorb. PA prepares it (by voice, or on its rhythm), the user confirms once and orders
 * on the platform. PA never pays or sends an order itself.
 */
export interface ShopList extends Row {
  /** "Wocheneinkauf", "Pizza Freitag". Spoken names find it again ("Bestell den Wocheneinkauf"). */
  name: string;
  kind: ShopKind;
  /** Platform id from shopping/platforms (gurkerl, foodora, …), null = plain shopping list for the shop. */
  platformId: string | null;
  /** Saved store or restaurant page on the platform (favourite), opened instead of the platform's start page. */
  storeUrl: string | null;
  /** One item per line, e.g. "2 l Milch". Plain text so it stays readable everywhere. */
  items: string;
  /** Rhythm: every N units, optionally on a weekday (0 = Sunday). Null = one-off list. */
  everyN: number | null;
  everyUnit: Unit | null;
  weekday: number | null;
  /** Next delivery/order day of a recurring list. */
  nextDate: ISODate | null;
  /** Days before nextDate when PA puts the prepared basket in front of the user (default 1). */
  leadDays: number;
  /** Day the user last opened the platform from PA (asks "Bestellt?" afterwards). */
  handedOn: ISODate | null;
  lastOrdered: ISODate | null;
  state: 'active' | 'paused' | 'done';
}

/** One confirmed order: history for rhythms ("meist freitags bei gurkerl") and for "nochmal dasselbe". */
export interface ShopRun extends Row {
  listId: string | null;
  platformId: string | null;
  date: ISODate;
  items: string;
}

/** What a rhythm is about: an appointment to book, a person to be in touch with, or anything else. */
export type RhythmKind = 'booking' | 'contact' | 'task';
/** active: suggests; paused: kept but silent; dismissed: a learned rhythm the user said no to (not proposed again). */
export type RhythmStatus = 'active' | 'paused' | 'dismissed';
/** 'learned' = PA saw it in the history and the user confirmed it; 'manual' = entered by the user. */
export type RhythmOrigin = 'manual' | 'learned';
export type ContactChannel = 'call' | 'message';

/** "Friseur etwa alle 5 Wochen", "Mit Anna alle 3 Wochen telefonieren". */
export interface Rhythm extends Row {
  /** Stable subject key: 'friseur', 'person:anna', 'task:auto waschen'. One rhythm per key. */
  subject: string;
  /** Display name: "Friseur", "Anna". */
  label: string;
  kind: RhythmKind;
  status: RhythmStatus;
  origin: RhythmOrigin;
  everyN: number;
  everyUnit: Unit;
  /** Last time it happened (visit, call, meeting). Null = counting from createdAt. */
  lastDone: ISODate | null;
  /** No suggestion before this date ("Später"). */
  snoozedUntil: ISODate | null;
  providerId: string | null;
  /** Contact rhythms: number for "Anrufen" and how the user prefers to reach the person. */
  phone: string | null;
  channel: ContactChannel | null;
  note: string | null;
}

export type TouchSource = 'manual' | 'voice' | 'suggestion' | 'message' | 'booking' | 'calendar';

/** One time something happened ("mit Anna telefoniert", "war beim Friseur"). History for rhythms. */
export interface Touch extends Row {
  subject: string;
  kind: RhythmKind;
  date: ISODate;
  source: TouchSource;
  /** 'in' = the other person got in touch ("Anna hat angerufen"), 'out' = the user did. */
  direction: 'in' | 'out' | null;
}
