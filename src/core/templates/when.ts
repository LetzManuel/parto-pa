// On-device parsing of German date phrases. No AI: a fixed set of patterns, the user confirms on a form.
import { addDays, addInterval, addMonths, fromISO, toISO, weekday, type ISODate, type Unit } from '../time/dates';

const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einem: 1, einen: 1, einer: 1, eins: 1,
  zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  vierzehn: 14, zwanzig: 20, dreißig: 30,
};

export function parseNumber(s: string): number | null {
  const t = s.toLowerCase().trim();
  if (/^\d+$/.test(t)) return Number(t);
  return NUMBER_WORDS[t] ?? null;
}

export const NUM = '(\\d+|ein(?:e[mnr]?|s)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|vierzehn|zwanzig|dreißig)';
export const UNIT = '(tag(?:e|en)?|woche(?:n)?|monat(?:e|en)?|jahr(?:e|en)?)';

export function parseUnit(s: string): Unit {
  const t = s.toLowerCase();
  if (t.startsWith('tag')) return 'day';
  if (t.startsWith('woche')) return 'week';
  if (t.startsWith('monat')) return 'month';
  return 'year';
}

const WEEKDAYS: Record<string, number> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
};
const MONTHS: Record<string, number> = {
  jänner: 1, januar: 1, jan: 1, februar: 2, feber: 2, feb: 2, märz: 3, mär: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10,
  november: 11, nov: 11, dezember: 12, dez: 12,
};
export const WEEKDAY_RE = '(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)';
export const MONTH_RE = '(jänner|januar|februar|feber|märz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept|sep|okt|nov|dez)\\.?';

/** Next date with this weekday, strictly after ref ("bis Freitag" said on a Friday means next Friday). */
export function nextWeekday(ref: ISODate, wd: number): ISODate {
  const diff = (wd - weekday(ref) + 7) % 7 || 7;
  return addDays(ref, diff);
}

/** Day and month without a year: this year, or next year if the date has passed. */
export function nextDayMonth(ref: ISODate, day: number, month: number, year?: number): ISODate | null {
  const y = year ?? Number(ref.slice(0, 4));
  const d = new Date(y, month - 1, day, 12);
  if (d.getMonth() !== month - 1) return null;
  const iso = toISO(d);
  if (year === undefined && iso < ref) return toISO(new Date(y + 1, month - 1, day, 12));
  return iso;
}

export interface WhenMatch {
  date: ISODate;
  /** The matched text, so callers can cut it out of the sentence. */
  text: string;
}

/** Finds the first date phrase in s. */
export function findWhen(s: string, ref: ISODate): WhenMatch | null {
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => ISODate | null]> = [
    [new RegExp(`\\bin\\s+${NUM}\\s+${UNIT}\\b`, 'i'), (m) => {
      const n = parseNumber(m[1]);
      return n ? addInterval(ref, n, parseUnit(m[2])) : null;
    }],
    [/(?<!\p{L})übermorgen\b/iu, () => addDays(ref, 2)],
    [/\bmorgen\b/i, () => addDays(ref, 1)],
    [/\bheute\b/i, () => ref],
    [/\bnächste(?:n|r)?\s+woche\b/i, () => nextWeekday(ref, 1)],
    [/\bnächste(?:n|r)?\s+monat\b/i, () => addMonths(ref.slice(0, 8) + '01', 1)],
    [/\bende\s+(?:des|vom)\s+monats?\b/i, () => {
      const d = fromISO(ref);
      return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
    }],
    [new RegExp(`\\b(?:am\\s+)?(\\d{1,2})\\.\\s*${MONTH_RE}(?:\\s+(\\d{4}))?`, 'i'), (m) =>
      nextDayMonth(ref, Number(m[1]), MONTHS[m[2].toLowerCase()], m[3] ? Number(m[3]) : undefined)],
    [/\b(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/i, (m) => {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
      return nextDayMonth(ref, Number(m[1]), Number(m[2]), y);
    }],
    [new RegExp(`\\b(?:am\\s+|bis\\s+|kommenden\\s+|nächsten\\s+)?${WEEKDAY_RE}\\b`, 'i'), (m) => nextWeekday(ref, WEEKDAYS[m[1].toLowerCase()])],
  ];
  let best: (WhenMatch & { index: number }) | null = null;
  for (const [re, fn] of patterns) {
    const m = s.match(re);
    if (!m || m.index === undefined) continue;
    const date = fn(m);
    if (date && (!best || m.index < best.index)) best = { date, text: m[0], index: m.index };
  }
  return best ? { date: best.date, text: best.text } : null;
}
