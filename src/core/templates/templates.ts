// "Memo wird Auftrag" in Phase 1, without AI: fixed templates, suggested by simple rules on the device.
// The suggestion only pre-fills a form; nothing is saved until the user confirms it.
import type { OrderKind } from '../model';
import type { ISODate, Unit } from '../time/dates';
import { capitalize } from '../orders/flow';
import { findWhen, NUM, parseNumber, parseUnit, UNIT, MONTH_RE, nextDayMonth } from './when';

export type TemplateId = 'remind' | 'location' | 'followup' | 'conditional' | 'recurring' | 'birthday';

export interface TemplateInfo {
  id: TemplateId;
  kind: OrderKind;
  label: string;
  /** Pattern shown to the user as a hint. */
  pattern: string;
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'remind', kind: 'reminder', label: 'Erinnerung', pattern: 'Erinner mich in … an …' },
  { id: 'location', kind: 'location', label: 'Erinnerung am Ort', pattern: 'Erinner mich, wenn ich bei … bin, an …' },
  { id: 'followup', kind: 'followup', label: 'Nachfassen', pattern: 'In … nachfragen, ob …' },
  { id: 'conditional', kind: 'conditional', label: 'Wenn-dann', pattern: 'Wenn … bis … nicht antwortet, dann …' },
  { id: 'recurring', kind: 'recurring', label: 'Wiederkehrend', pattern: 'Alle … Wochen: …' },
  { id: 'birthday', kind: 'birthday', label: 'Geburtstag', pattern: '… hat am … Geburtstag' },
];

export interface Suggestion {
  template: TemplateId;
  title: string;
  dueDate: ISODate | null;
  place?: string;
  waitingFor?: string;
  fallback?: string;
  everyN?: number;
  everyUnit?: Unit;
  person?: string;
  /** Extra fact for "Was PA über mich weiß" (e.g. "Anna mag Orchideen"), only suggested. */
  memory?: string;
  /** 0..1: how sure the rule is. Below 0.5 the form opens with the template picker. */
  confidence: number;
}

const clean = (s: string) => capitalize(s.replace(/\s+/g, ' ').replace(/^[\s,:;–-]+|[\s,.;:!–-]+$/g, '').trim());

function stripWhen(s: string, when: { text: string } | null): string {
  return when ? s.replace(when.text, ' ') : s;
}

const ANSWER_VERBS = '(?:antwortet|zurückruft|anruft|sich meldet|meldet|zurückschreibt|bestätigt|reagiert)';

export function suggest(raw: string, ref: ISODate): Suggestion[] {
  const s = raw.trim();
  const out: Suggestion[] = [];

  // Birthday: "Anna hat am 3. März Geburtstag, sie mag Orchideen"
  const bday = s.match(new RegExp(`^(.+?)\\s+hat\\s+am\\s+(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.|${MONTH_RE})\\s*Geburtstag(?:[,;.]\\s*(.*))?$`, 'i'));
  if (bday) {
    const person = clean(bday[1]);
    const monthNum = bday[3] ? Number(bday[3]) : monthIndex(bday[4]);
    const date = monthNum ? nextDayMonth(ref, Number(bday[2]), monthNum) : null;
    const extra = bday[5] ? clean(bday[5].replace(/^(sie|er)\s+/i, `${person} `)) : undefined;
    out.push({ template: 'birthday', title: `Geburtstag ${person}`, dueDate: date, person, memory: extra, confidence: date ? 0.95 : 0.6 });
  }

  // Conditional: "Wenn der Installateur bis Freitag nicht zurückruft, such einen anderen"
  const cond = s.match(new RegExp(`^wenn\\s+(.+?)\\s+(bis\\s+.+?)\\s+(?:nicht|kein(?:e)?\\s+\\w+)\\s+${ANSWER_VERBS}\\s*[,;]?\\s*(?:dann\\s+)?(.+)$`, 'i'));
  if (cond) {
    const when = findWhen(cond[2], ref);
    const who = cond[1].trim();
    out.push({
      template: 'conditional',
      title: `Antwort: ${capitalize(who.replace(/^(der|die|das|den|dem|mein(?:e|en)?|unser(?:e|en)?)\s+/i, ''))}`,
      waitingFor: who,
      fallback: clean(cond[3]).replace(/^Such\b/, 'Suche'),
      dueDate: when?.date ?? null,
      confidence: when ? 0.9 : 0.6,
    });
  }

  // Location: "Erinner mich, wenn ich beim Billa bin, an Batterien"
  const loc = s.match(/erinner(?:e|ung)?\s*(?:mich)?\s*,?\s*wenn\s+ich\s+(?:beim|bei|im|in|am|zum)\s+(.+?)\s+bin\s*,?\s*(?:an\s+)?(.+)$/i);
  if (loc) out.push({ template: 'location', title: clean(loc[2]), place: clean(loc[1]), dueDate: null, confidence: 0.9 });

  // Follow-up: "In drei Wochen nachfragen, ob die Versicherung gezahlt hat"
  const fu = s.match(/^(.*?)\s*nach(?:fragen|haken|fassen)\s*,?\s*(?:ob\s+)?(.+)$/i);
  if (fu && !cond) {
    const when = findWhen(fu[1], ref) ?? findWhen(fu[2], ref);
    const what = clean(stripWhen(fu[2], when));
    out.push({ template: 'followup', title: `Nachfragen: ${what.charAt(0).toLowerCase() + what.slice(1)}`, dueDate: when?.date ?? null, confidence: when ? 0.85 : 0.55 });
  }

  // Recurring: "Alle 6 Wochen Friseur", "Friseur alle sechs Wochen", "jährlich Pickerl"
  const rec = s.match(new RegExp(`\\balle\\s+${NUM}?\\s*${UNIT}\\b`, 'i'));
  const adverb = s.match(/\b(wöchentlich|monatlich|jährlich|halbjährlich|vierteljährlich)\b/i);
  if (rec || adverb) {
    let n = 1;
    let unit: Unit = 'week';
    let text = '';
    if (rec) {
      n = rec[1] ? parseNumber(rec[1]) ?? 1 : 1;
      unit = parseUnit(rec[2]);
      text = rec[0];
    } else if (adverb) {
      const a = adverb[1].toLowerCase();
      [n, unit] = a === 'wöchentlich' ? [1, 'week'] : a === 'monatlich' ? [1, 'month'] : a === 'vierteljährlich' ? [3, 'month'] : a === 'halbjährlich' ? [6, 'month'] : [1, 'year'];
      text = adverb[0];
    }
    const title = clean(s.replace(text, ' ').replace(/^(?:erinner(?:e)?\s+mich\s+)?(?:an\s+)?/i, ''));
    out.push({ template: 'recurring', title, everyN: n, everyUnit: unit, dueDate: null, confidence: title ? 0.85 : 0.5 });
  }

  // Plain reminder: "Erinner mich in zwei Wochen an die Steuer", "Morgen Paket abholen"
  if (!loc) {
    const when = findWhen(s, ref);
    const rem = s.match(/^erinner(?:e|ung)?\s*(?:mich)?\s*(.*)$/i);
    if (rem || (when && !out.length)) {
      let body = stripWhen(rem ? rem[1] : s, when);
      body = body.replace(/^\s*,?\s*(?:bitte\s+)?(?:daran\s*,?\s*(?:dass)?|an)\s+/i, '');
      out.push({ template: 'remind', title: clean(body), dueDate: when?.date ?? null, confidence: rem && when ? 0.9 : when ? 0.6 : 0.5 });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function monthIndex(name: string | undefined): number | null {
  if (!name) return null;
  const re = new RegExp(`^${MONTH_RE}$`, 'i');
  if (!re.test(name)) return null;
  const order = ['jän', 'jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'];
  const k = name.toLowerCase().slice(0, 3);
  const i = order.indexOf(k);
  return i <= 1 ? 1 : i;
}
