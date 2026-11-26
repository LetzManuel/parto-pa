// Calendar dates as 'YYYY-MM-DD' strings in the user's local time. No time zones, no Date drift.

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon: safe across DST changes
}

export function today(now = new Date()): ISODate {
  return toISO(now);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Adds months; the 31st becomes the last day of a shorter month. */
export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

export type Unit = 'day' | 'week' | 'month' | 'year';

export function addInterval(s: ISODate, n: number, unit: Unit): ISODate {
  switch (unit) {
    case 'day': return addDays(s, n);
    case 'week': return addDays(s, 7 * n);
    case 'month': return addMonths(s, n);
    case 'year': return addMonths(s, 12 * n);
  }
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000);
}

export function weekday(s: ISODate): number {
  return fromISO(s).getDay(); // 0 = Sunday
}

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easter(year: number): ISODate {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const cache = new Map<number, Set<ISODate>>();

/** Austrian public holidays (gesetzliche Feiertage). */
export function holidaysAT(year: number): Set<ISODate> {
  let set = cache.get(year);
  if (set) return set;
  const e = easter(year);
  const fixed = ['01-01', '01-06', '05-01', '08-15', '10-26', '11-01', '12-08', '12-25', '12-26'].map((md) => `${year}-${md}`);
  set = new Set([...fixed, addDays(e, 1), addDays(e, 39), addDays(e, 50), addDays(e, 60)]);
  cache.set(year, set);
  return set;
}

export function isWorkday(s: ISODate): boolean {
  const wd = weekday(s);
  return wd !== 0 && wd !== 6 && !holidaysAT(Number(s.slice(0, 4))).has(s);
}

/** n working days after s (Mon–Fri, without Austrian holidays). */
export function addWorkdays(s: ISODate, n: number): ISODate {
  let d = s;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkday(d)) left--;
  }
  return d;
}

export function workdaysBetween(a: ISODate, b: ISODate): number {
  let n = 0;
  for (let d = a; d < b; ) {
    d = addDays(d, 1);
    if (isWorkday(d)) n++;
  }
  return n;
}

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** "Fr., 27.11." or "heute", "morgen" relative to ref. */
export function formatShort(s: ISODate, ref?: ISODate): string {
  if (ref) {
    const d = diffDays(ref, s);
    if (d === 0) return 'heute';
    if (d === 1) return 'morgen';
    if (d === -1) return 'gestern';
  }
  const dt = fromISO(s);
  return `${DAYS[dt.getDay()].slice(0, 2)}., ${dt.getDate()}.${dt.getMonth() + 1}.`;
}

export function formatLong(s: ISODate): string {
  const dt = fromISO(s);
  return `${dt.getDate()}. ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

export const WEEKDAY_NAMES = DAYS;
export const MONTH_NAMES = MONTHS;
