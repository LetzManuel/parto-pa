// Favourites: per kind (Friseur, Restaurant, Tickets, Ärzte, Babysitter) up to three places or people, checked in order.
// PA reads free slots where a system lets it, otherwise it prepares the handoff (booking page, call, WhatsApp/SMS).
// PA never books, buys or sends by itself: the person finishes every booking with one tap in the other app.
import type { Row } from '../model';
import type { ISODate } from '../time/dates';

export type FavKind = 'salon' | 'restaurant' | 'tickets' | 'doctor' | 'babysitter';

export const KIND_LABEL: Record<FavKind, string> = {
  salon: 'Friseur & Beauty', restaurant: 'Restaurant', tickets: 'Tickets', doctor: 'Ärzte', babysitter: 'Babysitter',
};
/** Short noun for titles and sentences ("Friseurtermin bei …"). */
export const KIND_NOUN: Record<FavKind, string> = {
  salon: 'Termin', restaurant: 'Tisch', tickets: 'Tickets', doctor: 'Arzttermin', babysitter: 'Babysitter',
};

export const MAX_PER_LIST = 3;

/** Booking systems PA knows. Some can be read (free slots), the others are linked only. */
export type SystemId =
  | 'manual' | 'demo'
  | 'resmio' | 'salonized' | 'ticketmaster'
  | 'treatwell' | 'shore' | 'fresha' | 'planity' | 'timify' | 'booksy' | 'studiolution'
  | 'opentable' | 'thefork' | 'quandoo'
  | 'oeticket' | 'eventim'
  | 'doctolib' | 'latido' | 'docfinder'
  | 'babysits' | 'betreut';

export interface Favourite extends Row {
  kind: FavKind;
  /** Which list inside the kind: doctors by field ("Zahnarzt"), salons by service ("Herrenschnitt"). Null = general. */
  topic: string | null;
  /** 1 = asked first. */
  priority: number;
  name: string;
  system: SystemId;
  /** The system's id for this place: resmio facility id, "subdomain:serviceId" for Salonized, venue id or search word for tickets. */
  systemRef: string | null;
  bookingUrl: string | null;
  phone: string | null;
  /** Usual length in minutes (salon, doctor), so a slot can be checked against the person's calendar. */
  durationMin: number | null;
  note: string | null;
}

/** What the person asked for, after on-device parsing and their own corrections on the form. */
export interface BookingRequest {
  kind: FavKind;
  topic: string | null;
  /** First and last day to look at (one day for most requests, a range for tickets). */
  dateFrom: ISODate;
  dateTo: ISODate;
  /** Time window, HH:MM. */
  from: string;
  to: string;
  /** Party size (restaurant), number of tickets. */
  people: number | null;
  /** Artist or event for tickets. */
  keyword: string | null;
  text: string;
}

export interface Slot {
  date: ISODate;
  start: string; // HH:MM
  end: string | null;
  /** Event name for tickets, staff name for salons, … */
  label: string | null;
  /** Deep link to finish the booking, if the system has one for this slot. */
  url: string | null;
}

export type CheckResult =
  | { status: 'slots'; slots: Slot[] }
  /** The system answered: nothing free in the window. */
  | { status: 'full' }
  /** PA cannot read this place: the person checks via link, call or message. */
  | { status: 'manual'; reason: string }
  /** Reading failed (offline, blocked, changed). Falls back to the handoff. */
  | { status: 'error'; reason: string };
