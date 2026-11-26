// Spoken shopping and food orders, on the device, without AI: a fixed set of German patterns.
// "Bestell bei gurkerl 2 Liter Milch, 6 Eier und Brot"
// "Jeden Freitag Wocheneinkauf bei gurkerl: Milch, Eier, Bananen"
// "Alle zwei Wochen bei Billa Waschmittel und Klopapier"
// "Bestell Pizza Margherita bei Lieferando"
// "Bestell das Übliche" / "Den Wocheneinkauf nochmal"
// The result only pre-fills the basket; the user sees it, hears it read back and confirms once.
import type { ShopKind } from '../model';
import type { Unit } from '../time/dates';
import { NUM, parseNumber, parseUnit, UNIT } from '../templates/when';
import { ALIAS_RE, ALIASES, platform } from './platforms';

export interface ShopItem { name: string; qty: number | null; unit: string | null }

export interface ShopIntent {
  kind: ShopKind;
  /** undefined: no platform said; null: a shop without delivery (list for the shop). */
  platformId?: string | null;
  /** Why the platform differs from what was said ("BILLA liefert über foodora."). */
  platformNote?: string;
  items: ShopItem[];
  /** Name for a recurring list ("Wocheneinkauf"). */
  name?: string;
  /** "Bestell das Übliche": find a saved list by this name instead of new items. */
  reuse?: string;
  everyN?: number;
  everyUnit?: Unit;
  weekday?: number;
}

const VERB = /\b(bestell\w*|einkauf\w*|einkaufsliste|kauf(?:e|en)?|besorg\w*|brauch(?:e|en)|liefern|wocheneinkauf|nachbestell\w*)\b/i;
const FOOD = /\b(pizza|sushi|burger|kebab|döner|curry|pho|ramen|nudelbox|schnitzel|pasta|thai|inder|indisch|chinesisch|asiatisch|mexikanisch|poke|bowl|essen bestellen|mittagessen|abendessen|lieferessen)\b/i;
const NOT_SHOPPING = /^\s*(erinner|wenn\s|schreib|sag\s|schick|ruf\s)/i;
const WEEKDAYS: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6 };
const WD = '(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)';
const REUSE = /^(?:bitte\s+)?(?:bestell\w*\s+)?(?:(?:das|den|die)\s+)?(übliche[n]?|wie immer|.+?)\s+(?:nochmal|noch einmal|wieder|wie letztes mal)$|^bestell\w*\s+(?:das\s+)?(übliche|wie immer)$|^bestell\w*\s+(?:den|die|das)\s+(\S+(?:einkauf|liste|korb|bestellung))$/i;

const UNITS = '(l|liter|ml|kg|kilo|g|gramm|dag|stück|stk|packung(?:en)?|pkg|pk|flasche(?:n)?|dose(?:n)?|becher|bund|gl(?:a|ä)s(?:er)?|sack|säcke|netz|tafel(?:n)?|rolle(?:n)?|karton(?:s)?|kiste(?:n)?)';

/** Is this a shopping/food order? Messages ("Schreib Anna …") and reminders ("Erinner mich, wenn ich bei Billa bin …") win. */
export function isShoppingIntent(text: string): boolean {
  const t = text.trim();
  if (!t || NOT_SHOPPING.test(t)) return false;
  if (REUSE.test(t) && /übliche|wie immer|einkauf|liste|korb|bestellung/i.test(t)) return true;
  return VERB.test(t) || new RegExp(`\\b(bei|über|von)\\s+(${ALIAS_RE})\\b`, 'i').test(t);
}

export function parseShopping(raw: string): ShopIntent | null {
  let s = raw.trim().replace(/[.!?]+$/, '');
  if (!isShoppingIntent(s)) return null;

  const reuse = s.match(REUSE);
  if (reuse && /übliche|wie immer|einkauf|liste|korb|bestellung/i.test(s)) {
    const name = (reuse[1] ?? reuse[2] ?? reuse[3]).trim();
    return { kind: 'grocery', items: [], reuse: /übliche|wie immer/i.test(name) ? 'übliche' : name.toLowerCase() };
  }

  const out: ShopIntent = { kind: 'grocery', items: [] };

  // Platform: "bei gurkerl", "über foodora", "von Billa"
  const plat = s.match(new RegExp(`\\b(?:bei|über|von|auf)\\s+(${ALIAS_RE})\\b`, 'i')) ?? s.match(new RegExp(`\\b(${ALIAS_RE})\\b`, 'i'));
  if (plat) {
    const a = ALIASES[plat[1].toLowerCase()];
    out.platformId = a.platformId;
    if (a.note) out.platformNote = a.note;
    s = s.replace(plat[0], ' ');
  }

  // Rhythm: "jeden Freitag", "alle zwei Wochen", "jede Woche", "alle 2 Wochen am Samstag"
  const every = s.match(new RegExp(`\\balle\\s+${NUM}\\s+${UNIT}\\b`, 'i'));
  if (every) { out.everyN = parseNumber(every[1]) ?? 1; out.everyUnit = parseUnit(every[2]); s = s.replace(every[0], ' '); }
  const each = s.match(/\bjede[nrs]?\s+(woche|monat|tag)\b/i);
  if (each) { out.everyN = 1; out.everyUnit = parseUnit(each[1]); s = s.replace(each[0], ' '); }
  const wd = s.match(new RegExp(`\\b(?:jeden|immer|am|an)\\s+${WD}s?\\b`, 'i')) ?? s.match(new RegExp(`\\b${WD}s\\b`, 'i'));
  if (wd) {
    out.weekday = WEEKDAYS[wd[1].toLowerCase()];
    if (!out.everyN) { out.everyN = 1; out.everyUnit = 'week'; }
    s = s.replace(wd[0], ' ');
  }

  // Name of a recurring list: "Wocheneinkauf", "Großeinkauf", "Drogerie"
  const name = s.match(/\b(\w*einkauf|drogerie\w*|getränke\w*|vorrat\w*)\b(?!sliste)/i);
  if (name && !/^einkauf$/i.test(name[1])) { out.name = cap(name[1]); s = s.replace(name[0], ' '); }

  // Strip the command words, keep the items.
  s = s
    .replace(/\b(bitte|mal|noch|uns|mir|für mich|für uns)\b/gi, ' ')
    .replace(/\b(bestell\w*|nachbestell\w*|kauf(?:e|en)?|besorg\w*|einkaufen|einkaufsliste|auf die liste|setz\w*|schreib\w*|wir brauchen|ich brauche|brauchen|brauche|liefern lassen|liefern|lassen|online|essen bestellen)\b/gi, ' ')
    .replace(/^[\s:,–-]+/, '');

  out.items = splitItems(s);
  const p = platform(out.platformId ?? undefined);
  if (p && p.kinds.length === 1) out.kind = p.kinds[0];
  else if (FOOD.test(raw)) out.kind = 'food';
  return out;
}

/** "2 Liter Milch, 6 Eier und Brot" → three items. */
export function splitItems(s: string): ShopItem[] {
  return s
    .split(/\s*(?:,|;|\n|\bund\b|\bsowie\b|\+)\s*/i)
    .map((x) => x.replace(/^[\s:–-]+|[\s.:–-]+$/g, '').trim())
    .filter((x) => x && !/^(bei|über|von|auf|am|an|für)$/i.test(x))
    .map(parseItem);
}

export function parseItem(x: string): ShopItem {
  const m = x.match(new RegExp(`^${NUM}\\s+(?:${UNITS}\\s+)?(.+)$`, 'i'));
  if (m) {
    const qty = parseNumber(m[1]);
    if (qty !== null) return { qty, unit: m[2] ? normUnit(m[2]) : null, name: cap(m[3].trim()) };
  }
  return { qty: null, unit: null, name: cap(x) };
}

function normUnit(u: string): string {
  const t = u.toLowerCase();
  if (t === 'liter') return 'l';
  if (t === 'kilo') return 'kg';
  if (t === 'gramm') return 'g';
  if (t === 'stück' || t === 'stk') return 'Stk.';
  if (t.startsWith('packung') || t === 'pkg' || t === 'pk') return 'Pkg.';
  return t.startsWith('fl') ? 'Fl.' : u;
}

export function formatItem(i: ShopItem): string {
  return [i.qty ?? '', i.unit ?? '', i.name].filter((x) => x !== '').join(' ');
}

export function itemsToText(items: ShopItem[]): string {
  return items.map(formatItem).join('\n');
}

export function textToItems(text: string): ShopItem[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map(parseItem);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
