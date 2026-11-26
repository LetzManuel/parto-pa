// How the person gets around, and how early PA reminds. Kept on this device (the home address is private), set in
// Ich › Wege & Erinnerungen or by voice ("Heute bin ich mit dem Auto unterwegs").
import type { Store } from '../db/store';
import type { ISODate } from '../time/dates';

export type Mode = 'car' | 'transit' | 'walk' | 'bike';
export type NavApp = 'google' | 'apple';

export const MODES: Mode[] = ['transit', 'car', 'walk', 'bike'];
export const MODE_LABEL: Record<Mode, string> = { car: 'Auto', transit: 'Öffis', walk: 'Zu Fuß', bike: 'Rad' };
export const MODE_WITH: Record<Mode, string> = { car: 'mit dem Auto', transit: 'mit den Öffis', walk: 'zu Fuß', bike: 'mit dem Rad' };

export interface TravelPrefs {
  /** Usual way of getting around. */
  mode: Mode;
  /** Start when PA does not know where the person is (and no appointment comes right before). */
  home: string;
  /** Extra minutes to arrive early (finding the door, parking). */
  bufferMin: number;
  /** Heads-up before it is time to leave; 0 = only "Jetzt los". */
  preMin: number;
  /** Reminder before appointments without a place (calls, meetings in the same building). */
  plainMin: number;
  navApp: NavApp;
  /** Read reminders out loud while the app is open. */
  speak: boolean;
  /** "Heute mit dem Auto": one day differs from the usual mode. */
  dayModes: Record<ISODate, Mode>;
  /** "Zum Zahnarzt zu Fuß": one appointment differs (key of the occurrence). */
  eventModes: Record<string, Mode>;
}

export const DEFAULT_PREFS: TravelPrefs = {
  mode: 'transit', home: '', bufferMin: 5, preMin: 10, plainMin: 15, navApp: 'google', speak: false, dayModes: {}, eventModes: {},
};

const KEY = 'travelPrefs';

export function getPrefs(store: Store): TravelPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(store.getMeta(KEY) ?? '{}') as Partial<TravelPrefs>) };
  } catch { return { ...DEFAULT_PREFS }; }
}

/** Saves a change; day choices of past days are dropped on the way. */
export function setPrefs(store: Store, patch: Partial<TravelPrefs>, today: ISODate): TravelPrefs {
  const next = { ...getPrefs(store), ...patch };
  next.dayModes = Object.fromEntries(Object.entries(next.dayModes).filter(([d]) => d >= today));
  const keys = Object.keys(next.eventModes);
  if (keys.length > 200) next.eventModes = Object.fromEntries(keys.slice(-200).map((k) => [k, next.eventModes[k]]));
  store.setMeta(KEY, JSON.stringify(next));
  return next;
}

/** Mode for one appointment: its own choice, else the day's, else the usual one. */
export function modeFor(p: TravelPrefs, ev: { key: string; date: ISODate }): Mode {
  return p.eventModes[ev.key] ?? p.dayModes[ev.date] ?? p.mode;
}
