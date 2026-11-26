// On-device parsing of a spoken or typed request ("Friseurtermin morgen zwischen 14 und 17 Uhr",
// "Tisch für 4 am Freitag um 19 Uhr", "2 Karten für Bilderbuch im März", "Babysitter Samstag ab 19 Uhr").
// No AI: fixed patterns. The person sees the result on a form and can correct it before PA checks anything.
import { findWhen, MONTH_RE, NUM, parseNumber } from '../templates/when';
import { addDays, toISO, type ISODate } from '../time/dates';
import type { BookingRequest, FavKind } from './model';

const KIND_WORDS: Array<[FavKind, RegExp]> = [
  ['babysitter', /babysitt|kinderbetreuung|auf die kinder|aufpassen/i],
  ['doctor', /(?:ärzt|arzt|doktor|ordination|praxis|zahn|dermatolog|gynäkolog|orthopäd|kinderärzt|physio)/i],
  ['tickets', /ticket|karten?\b|konzert|kabarett|theater|oper\b|musical|festival/i],
  ['restaurant', /restaurant|tisch|reservier|essen gehen|abendessen|mittagessen|brunch|lokal|wirtshaus|heurigen/i],
  ['beauty', /maniküre|pediküre|nägel|nagelstudio|kosmetik|massage|wimpern|augenbrauen|gesichtsbehandlung|waxing/i],
  ['salon', /friseur|frisör|haare|haarschnitt|schneiden|färben|barber/i],
];

/** Doctors by field: the word in the request picks the list ("Zahnarzt" → the Zahnarzt favourites). */
const DOCTOR_TOPICS: Array<[string, RegExp]> = [
  ['Zahnarzt', /zahn/i], ['Hausarzt', /hausarzt|allgemeinmedizin/i], ['Hautarzt', /haut|dermatolog/i],
  ['Frauenarzt', /frauen|gynäkolog/i], ['Augenarzt', /augen/i], ['Kinderarzt', /kinderarzt|kinderärzt/i],
  ['Orthopäde', /orthopäd/i], ['HNO', /\bhno\b|hals.?nasen/i], ['Physiotherapie', /physio/i],
];

const DEFAULT_WINDOW: Record<FavKind, [string, string]> = {
  salon: ['08:00', '19:00'], beauty: ['08:00', '19:00'], restaurant: ['18:00', '21:00'], tickets: ['00:00', '23:59'],
  doctor: ['08:00', '17:00'], babysitter: ['18:00', '23:00'],
};
/** How many days PA looks ahead when no day was said. */
const DEFAULT_DAYS: Record<FavKind, number> = { salon: 7, beauty: 7, restaurant: 1, tickets: 90, doctor: 14, babysitter: 1 };

const pad = (n: number) => String(n).padStart(2, '0');
function time(h: string, m?: string): string | null {
  const hh = Number(h), mm = m ? Number(m) : 0;
  return hh >= 0 && hh <= 24 && mm >= 0 && mm < 60 ? `${pad(Math.min(hh, 23))}:${pad(hh === 24 ? 59 : mm)}` : null;
}
const T = '(\\d{1,2})(?:[:.](\\d{2}))?';
const plus = (t: string, min: number) => {
  const v = Math.max(0, Math.min(23 * 60 + 59, Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + min));
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
};

/** Own words per list ("Haare", "Barber", "Studio Nails"), maintained on "Meine Anbieter". They win over the built-in words. */
export type KindWords = Partial<Record<FavKind, string[]>>;

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, case-insensitive match of any of the words. */
export function mentions(s: string, words: string[] | undefined): boolean {
  const list = (words ?? []).map((w) => w.trim()).filter((w) => w.length > 1);
  return list.length > 0 && new RegExp(`(?<![\\p{L}\\d])(?:${list.map(esc).join('|')})(?![\\p{L}\\d])`, 'iu').test(s);
}

export function detectKind(s: string, own: KindWords = {}): FavKind | null {
  const mine = (Object.keys(own) as FavKind[]).find((k) => mentions(s, own[k]));
  return mine ?? KIND_WORDS.find(([, re]) => re.test(s))?.[0] ?? null;
}

export function findWindow(s: string, kind: FavKind): { from: string; to: string } | null {
  let m = s.match(new RegExp(`(?:zwischen|von)\\s+${T}(?:\\s*uhr)?\\s+(?:und|bis)\\s+${T}`, 'i'))
    ?? s.match(new RegExp(`\\b${T}\\s*(?:uhr)?\\s*(?:[-–]|bis)\\s*${T}\\s*uhr`, 'i'));
  if (m) {
    const a = time(m[1], m[2]), b = time(m[3], m[4]);
    if (a && b) return { from: a, to: b };
  }
  m = s.match(new RegExp(`\\b(?:ab|nach)\\s+${T}(?:\\s*uhr)?`, 'i'));
  if (m) { const a = time(m[1], m[2]); if (a) return { from: a, to: kind === 'babysitter' ? '23:59' : DEFAULT_WINDOW[kind][1] > a ? DEFAULT_WINDOW[kind][1] : plus(a, 180) }; }
  m = s.match(new RegExp(`\\b(?:bis|vor)\\s+${T}\\s*uhr`, 'i'));
  if (m) { const b = time(m[1], m[2]); if (b) return { from: DEFAULT_WINDOW[kind][0] < b ? DEFAULT_WINDOW[kind][0] : '06:00', to: b }; }
  m = s.match(new RegExp(`\\b(?:um|gegen)\\s+${T}(?:\\s*uhr)?`, 'i')) ?? s.match(new RegExp(`\\b${T}\\s*uhr`, 'i'));
  if (m) { const a = time(m[1], m[2]); if (a) return kind === 'babysitter' ? { from: a, to: '23:59' } : { from: plus(a, -30), to: plus(a, 30) }; }
  if (/vormittag|in der früh/i.test(s)) return { from: '08:00', to: '12:00' };
  if (/nachmittag/i.test(s)) return { from: '13:00', to: '18:00' };
  if (/mittag/i.test(s)) return { from: '11:30', to: '14:00' };
  if (/abend/i.test(s)) return { from: '18:00', to: kind === 'babysitter' ? '23:59' : '21:30' };
  return null;
}

const COUNT_WORDS: Record<string, number> = { zweit: 2, dritt: 3, viert: 4, fünft: 5, sechst: 6 };

export function findPeople(s: string): number | null {
  let m = s.match(new RegExp(`\\b${NUM}\\s+(?:tickets?|karten|personen|leute|erwachsene|plätze)\\b`, 'i'));
  if (m) return parseNumber(m[1]);
  m = s.match(new RegExp(`\\bfür\\s+${NUM}(?!\\s*(?:uhr|[:.]\\d))\\b`, 'i'));
  if (m) return parseNumber(m[1]);
  m = s.match(/\bzu\s+(zweit|dritt|viert|fünft|sechst)\b/i);
  return m ? COUNT_WORDS[m[1].toLowerCase()] : null;
}

/** "im März" / "im Dezember": the whole month (this year, or next year if it has passed). */
function findMonth(s: string, ref: ISODate): { from: ISODate; to: ISODate; text: string } | null {
  const m = s.match(new RegExp(`\\b(?:im|ende|anfang)\\s+${MONTH_RE}`, 'i'));
  if (!m) return null;
  const k = m[1].toLowerCase().slice(0, 3);
  const month = ['jän', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'].indexOf(k === 'jan' ? 'jän' : k) + 1;
  if (!month) return null;
  let y = Number(ref.slice(0, 4));
  if (month < Number(ref.slice(5, 7))) y++;
  const from = toISO(new Date(y, month - 1, 1, 12));
  const to = toISO(new Date(y, month, 0, 12));
  return { from: from < ref ? ref : from, to, text: m[0] };
}

/** What is left for tickets: the artist or event ("Bilderbuch", "Wiener Philharmoniker"). */
function ticketKeyword(s: string, cut: string[]): string | null {
  let t = s;
  for (const c of cut) if (c) t = t.replace(c, ' ');
  t = t
    .replace(/\b(ich\s+)?(brauche|hätte gern|möchte|will|suche|bitte|kauf(?:en)?|besorg(?:en)?)\b/gi, ' ')
    .replace(new RegExp(`\\b${NUM}\\s+(tickets?|karten)\\b`, 'gi'), ' ')
    .replace(/(?<!\p{L})\p{L}*(?:tickets?|karten)(?!\p{L})/giu, ' ')
    .replace(/\b(konzert|für|fürs|vom|von|das|die|den|der|ein|eine|einen|im|am|zum|in|nach)\b/gi, ' ')
    .replace(/[,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

/** Parses a request. Returns null when no kind is recognised (the person picks one on the form). */
export function parseRequest(text: string, ref: ISODate, forceKind?: FavKind, own: KindWords = {}): BookingRequest | null {
  const s = text.trim();
  const kind = forceKind ?? detectKind(s, own);
  if (!kind) return null;
  const month = findMonth(s, ref);
  const when = month ? null : findWhen(s, ref);
  const dateFrom = month?.from ?? when?.date ?? (kind === 'restaurant' || kind === 'babysitter' ? ref : addDays(ref, kind === 'tickets' ? 0 : 1));
  const dateTo = month?.to ?? (when ? when.date : addDays(dateFrom, DEFAULT_DAYS[kind] - 1));
  const win = findWindow(s, kind) ?? { from: DEFAULT_WINDOW[kind][0], to: DEFAULT_WINDOW[kind][1] };
  const topic = kind === 'doctor' ? DOCTOR_TOPICS.find(([, re]) => re.test(s))?.[0] ?? null : null;
  const people = findPeople(s) ?? (kind === 'restaurant' ? 2 : kind === 'tickets' ? 1 : null);
  const keyword = kind === 'tickets' ? ticketKeyword(s, [month?.text ?? '', when?.text ?? '']) : null;
  return { kind, topic, dateFrom, dateTo, from: win.from, to: win.to, people, keyword, text: s };
}
