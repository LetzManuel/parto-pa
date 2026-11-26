// Spoken (or typed) rhythm sentences, parsed on the device without AI. The result is shown as one confirm line;
// nothing is saved before the user says or taps "ja".
//   "Friseur alle 5 Wochen"                      → set booking rhythm
//   "Mit Anna alle drei Wochen telefonieren"     → set contact rhythm (call)
//   "Ich will Ben jeden Monat schreiben"         → set contact rhythm (message)
//   "Friseur lieber alle 6 Wochen"               → change the existing rhythm (same key)
//   "Hab gestern mit Anna telefoniert"           → log a touch
//   "Anna hat sich gemeldet" / "War beim Friseur" → log a touch
//   "Friseur pausieren" / "Anna nicht mehr erinnern" → pause; "Rhythmus Anna löschen" → delete
import type { ContactChannel, RhythmKind } from '../model';
import { addDays, addInterval, type ISODate, type Unit } from '../time/dates';
import { findWhen, NUM, parseNumber, parseUnit, UNIT } from '../templates/when';
import { capitalize } from '../orders/flow';
import { displayName, FAMILY_RE, findService, isPlausibleName, personKey, taskKey } from './subjects';

export type RhythmCommand =
  | { type: 'set'; subject: string; label: string; kind: RhythmKind; everyN: number; everyUnit: Unit; channel: ContactChannel | null; lastDone: ISODate | null }
  | { type: 'log'; subject: string; label: string; kind: RhythmKind; date: ISODate; direction: 'in' | 'out' | null }
  | { type: 'pause' | 'resume' | 'delete'; subject: string; label: string };

interface Interval { everyN: number; everyUnit: Unit; text: string }

/** "alle 5 Wochen", "alle paar Wochen", "jede Woche", "jeden Monat", "einmal im Monat", "zweimal im Monat", "monatlich". */
export function findInterval(s: string): Interval | null {
  let m = s.match(new RegExp(`\\balle\\s+${NUM}\\s*${UNIT}`, 'i'));
  if (m) return { everyN: parseNumber(m[1]) ?? 1, everyUnit: parseUnit(m[2]), text: m[0] };
  m = s.match(new RegExp(`\\balle\\s+(?:paar|par)\\s*${UNIT}`, 'i'));
  if (m) return { everyN: parseUnit(m[1]) === 'week' ? 3 : 2, everyUnit: parseUnit(m[1]), text: m[0] };
  m = s.match(new RegExp(`\\b(?:alle|jede[nrs]?)\\s*${UNIT}`, 'i'));
  if (m) return { everyN: 1, everyUnit: parseUnit(m[1]), text: m[0] };
  m = s.match(/\b(einmal|zweimal|dreimal|1x|2x|3x|ein mal|zwei mal)\s+(?:in\s+der|im|die|pro)\s+(woche|monat|jahr)\b/i);
  if (m) {
    const times = /^(zwei|2)/i.test(m[1]) ? 2 : /^(drei|3)/i.test(m[1]) ? 3 : 1;
    const unit = parseUnit(m[2]);
    if (times === 1) return { everyN: 1, everyUnit: unit, text: m[0] };
    if (unit === 'month') return { everyN: times === 2 ? 2 : 10, everyUnit: times === 2 ? 'week' : 'day', text: m[0] };
    if (unit === 'year') return { everyN: 12 / times, everyUnit: 'month', text: m[0] };
    return { everyN: Math.round(7 / times), everyUnit: 'day', text: m[0] };
  }
  m = s.match(/\b(täglich|wöchentlich|monatlich|vierteljährlich|halbjährlich|jährlich)\b/i);
  if (m) {
    const a = m[1].toLowerCase();
    const [n, u]: [number, Unit] = a === 'täglich' ? [1, 'day'] : a === 'wöchentlich' ? [1, 'week'] : a === 'monatlich' ? [1, 'month']
      : a === 'vierteljährlich' ? [3, 'month'] : a === 'halbjährlich' ? [6, 'month'] : [1, 'year'];
    return { everyN: n, everyUnit: u, text: m[0] };
  }
  return null;
}

const CONTACT_VERBS = /(telefonier|anruf|anrufen|ruf\w*\s+.*\ban\b|melde|melden|meld\b|treffen|treff|sprechen|reden|hören|schreib|nachricht|besuch|sehen)/i;
const MESSAGE_VERBS = /(schreib|nachricht|sms|whatsapp|texten)/i;
const NAME = `(\\p{Lu}[\\p{Ll}-]+|${FAMILY_RE})`;

/** The person a sentence is about. */
export function findPerson(s: string): string | null {
  const pats = [
    new RegExp(`\\b(?:mit|bei|von)\\s+(?:der\\s+|dem\\s+|meiner\\s+|meinem\\s+)?${NAME}`, 'giu'),
    new RegExp(`\\bruf\\w*\\s+(?:die\\s+|den\\s+)?${NAME}(?:\\s+\\S+){0,4}?\\s+an\\b`, 'giu'),
    new RegExp(`\\b${NAME}(?=\\s+(?:\\S+\\s+){0,4}?(?:anrufen|treffen|besuchen|schreiben|sehen|sprechen|hören|angerufen|getroffen|geschrieben|besucht|gesehen|gesprochen|gehört)\\b)`, 'giu'),
    new RegExp(`^${NAME}\\s+(?:hat|ruft|meldet|schreibt)\\b`, 'giu'),
    new RegExp(`\\b(?:will|möchte|sollte|muss)\\s+${NAME}\\b`, 'giu'),
  ];
  for (const re of pats) {
    for (const m of s.matchAll(re)) {
      if (isPlausibleName(m[1])) return displayName(m[1]);
    }
  }
  return null;
}

/** Any capitalised word that could be a name ("Anna nicht mehr erinnern"). */
function anyName(s: string): string | null {
  for (const m of s.matchAll(new RegExp(NAME, 'gu'))) if (isPlausibleName(m[1])) return displayName(m[1]);
  return null;
}

/** "zuletzt vor 3 Wochen", "letztes Mal vor einem Monat", "war zuletzt am 2.11." */
function findLast(s: string, today: ISODate): { date: ISODate; text: string } | null {
  const m = s.match(new RegExp(`(?:zuletzt|letztes\\s+mal|das\\s+letzte\\s+mal)\\s+vor\\s+${NUM}\\s+${UNIT}`, 'i'));
  if (m) return { date: addInterval(today, -(parseNumber(m[1]) ?? 1), parseUnit(m[2])), text: m[0] };
  const m2 = s.match(/(?:zuletzt|letztes\s+mal|das\s+letzte\s+mal)\s+(am\s+[^,]+|letzte\s+woche|gestern|vorgestern)/i);
  if (m2) {
    if (/letzte\s+woche/i.test(m2[1])) return { date: addDays(today, -7), text: m2[0] };
    const d = relativePast(m2[1], today);
    if (d) return { date: d, text: m2[0] };
  }
  return null;
}

/** Past dates: "gestern", "vorgestern", "am Montag" (the last one), "am 2.11." (this year or last). */
function relativePast(s: string, today: ISODate): ISODate | null {
  if (/\bvorgestern\b/i.test(s)) return addDays(today, -2);
  if (/\bgestern\b/i.test(s)) return addDays(today, -1);
  if (/\bheute\b/i.test(s)) return today;
  if (/\bletzte\s+woche\b/i.test(s)) return addDays(today, -7);
  const w = findWhen(s, today);
  if (!w) return null;
  // findWhen looks forward; for things that already happened take the same weekday/date one step back.
  if (w.date <= today) return w.date;
  if (/\d{1,2}\./.test(w.text)) return addInterval(w.date, -1, 'year');
  return addDays(w.date, -7);
}

const LOG_RE = /\b(hab|habe|hatte|war|waren|bin|ist|hat)\b.*\b(telefoniert|gesprochen|getroffen|gesehen|geschrieben|besucht|angerufen|gemeldet|zurückgerufen|gehört|geredet)\b|\b(war|waren)\s+(?:heute\s+|gestern\s+|vorgestern\s+)?(?:beim|bei\s+der|bei|im|in\s+der)\b|\berledigt\b|\bgemacht\b/i;

export function parseRhythmSentence(raw: string, today: ISODate): RhythmCommand | null {
  const s = raw.trim().replace(/(?<!\d)[.!?]+$/, '').replace(/[!?]+$/, '');
  if (!s) return null;
  const person = findPerson(s);
  const svc = findService(s);

  // Pause / delete / resume
  const stop = /\b(pausier\w*|pause|nicht\s+mehr\s+erinnern|keine\s+erinnerung\w*|stopp\w*|aussetzen)\b/i.test(s);
  const del = /\b(lösch\w*|entfern\w*|weg\s*damit)\b/i.test(s);
  const resume = /\b(wieder\s+erinnern|wieder\s+aktiv|fortsetzen)\b/i.test(s);
  if (stop || del || resume) {
    const name = person ?? (svc ? null : anyName(s));
    const target = name ? { subject: personKey(name), label: name } : svc ? { subject: svc.key, label: svc.label } : null;
    if (target) return { type: resume ? 'resume' : del ? 'delete' : 'pause', ...target };
  }

  const interval = findInterval(s);

  // Log: something happened ("Hab gestern mit Anna telefoniert", "War heute beim Friseur", "Anna hat angerufen")
  if (!interval && LOG_RE.test(s)) {
    const date = relativePast(s, today) ?? today;
    if (person) {
      const inbound = new RegExp(`^${NAME}\\s+(?:hat|ist)\\b`, 'iu').test(s) || /\bhat\s+(?:sich\s+)?(?:gemeldet|angerufen|geschrieben|zurückgerufen)/i.test(s);
      return { type: 'log', subject: personKey(person), label: person, kind: 'contact', date, direction: inbound ? 'in' : 'out' };
    }
    if (svc) return { type: 'log', subject: svc.key, label: svc.label, kind: 'booking', date, direction: null };
    return null;
  }

  if (!interval) return null;
  const last = findLast(s, today);

  if (person && (CONTACT_VERBS.test(s) || !svc)) {
    return { type: 'set', subject: personKey(person), label: person, kind: 'contact', everyN: interval.everyN, everyUnit: interval.everyUnit,
      channel: MESSAGE_VERBS.test(s) ? 'message' : 'call', lastDone: last?.date ?? null };
  }
  if (svc) {
    return { type: 'set', subject: svc.key, label: svc.label, kind: 'booking', everyN: interval.everyN, everyUnit: interval.everyUnit, channel: null, lastDone: last?.date ?? null };
  }
  // Anything else: "Auto waschen alle 4 Wochen", "Alle 2 Wochen Pflanzen gießen"
  let label = s.replace(interval.text, ' ');
  if (last) label = label.replace(last.text, ' ');
  label = label.replace(/^\s*(?:ich\s+(?:will|möchte|sollte|muss)\s+)?(?:erinner\w*\s+mich\s+)?(?:an\s+)?/i, '')
    .replace(/\b(lieber|etwa|ungefähr|so|bitte|rhythmus)\b/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s,:;–-]+|[\s,.;:!–-]+$/g, '').trim();
  if (!label) return null;
  label = capitalize(label);
  return { type: 'set', subject: taskKey(label), label, kind: 'task', everyN: interval.everyN, everyUnit: interval.everyUnit, channel: null, lastDone: last?.date ?? null };
}

/** The confirm line PA shows (and could read out): "Mit Anna etwa alle 3 Wochen telefonieren. Speichern?" */
export function describeCommand(c: RhythmCommand, intervalText: (n: number, u: Unit) => string, formatDate: (d: ISODate) => string): string {
  return sentence(describe(c, intervalText, formatDate));
}

const sentence = (s: string) => s.replace(/\.+$/, '') + '.';

function describe(c: RhythmCommand, intervalText: (n: number, u: Unit) => string, formatDate: (d: ISODate) => string): string {
  switch (c.type) {
    case 'set': {
      const every = intervalText(c.everyN, c.everyUnit);
      const last = c.lastDone ? `, zuletzt ${formatDate(c.lastDone)}` : '';
      if (c.kind === 'contact') return `${c.label} etwa ${every} ${c.channel === 'message' ? 'schreiben' : 'anrufen'}${last}.`;
      if (c.kind === 'booking') return `${c.label} etwa ${every}${last}.`;
      return `${c.label}: etwa ${every}${last}.`;
    }
    case 'log':
      if (c.kind === 'contact') return c.direction === 'in' ? `${c.label} hat sich ${formatDate(c.date)} gemeldet.` : `Kontakt mit ${c.label} ${formatDate(c.date)}.`;
      return `${c.label} ${formatDate(c.date)} erledigt.`;
    case 'pause': return `${c.label} pausieren, keine Vorschläge mehr.`;
    case 'resume': return `${c.label} wieder vorschlagen.`;
    case 'delete': return `Rhythmus ${c.label} löschen.`;
  }
}
