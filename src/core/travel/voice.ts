// Travel preferences by voice (or typed), on the device, no AI: a fixed set of German sentences.
//   "Ich fahre normalerweise mit den Öffis"            → usual mode
//   "Heute bin ich mit dem Auto unterwegs"              → today only
//   "Morgen fahre ich mit dem Rad"                      → tomorrow only
//   "Zum Zahnarzt gehe ich zu Fuß"                      → that appointment only
//   "Ich wohne in der Mariahilfer Straße 1, 1060 Wien"  → start address
//   "Erinnere mich 20 Minuten vor dem Losgehen"         → heads-up
//   "Plane 10 Minuten Puffer ein"                       → buffer
import type { Upcoming } from '../calendar/upcoming';
import { NUM, parseNumber } from '../templates/when';
import { addDays, type ISODate } from '../time/dates';
import { MODE_WITH, type Mode, type TravelPrefs } from './prefs';

export interface TravelCommand {
  patch: Partial<TravelPrefs>;
  /** What PA will do, shown on the confirm card and read out. */
  confirm: string;
}

/** Whole words, also for umlauts (\b in JS regex only knows ASCII letters). */
const word = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, 'iu');

const MODE_RULES: Array<[Mode, RegExp]> = [
  ['car', word('auto|wagen|pkw')],
  ['bike', word('rad|fahrrad|bike|radl|citybike')],
  ['transit', word('öffis?|oeffis?|öffentlich\\p{L}*|u-?bahn|bim|straßenbahn|strassenbahn|bus|zug|s-?bahn|wiener linien')],
  ['walk', word('zu fuß|zu fuss|zufuß|gehe|geh|laufe|spazier\\p{L}*')],
];

export function findMode(s: string): Mode | null {
  for (const [m, re] of MODE_RULES) if (re.test(s)) return m;
  return null;
}

const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** The next appointment whose title or place contains every word said ("zum Zahnarzt" → "Zahnarzt Dr. Huber"). */
export function matchEvent(target: string, events: Upcoming[]): Upcoming | null {
  const words = norm(target).split(' ').filter((w) => w.length > 2 && !['dem', 'der', 'den', 'die', 'das', 'termin'].includes(w));
  if (!words.length) return null;
  return events.find((e) => {
    const hay = norm(`${e.title} ${e.location ?? ''}`);
    return words.every((w) => hay.includes(w) || (w.length > 4 && hay.includes(w.slice(0, -1))));
  }) ?? null;
}

export function parseTravelCommand(raw: string, today: ISODate, events: Upcoming[] = []): TravelCommand | null {
  const s = raw.trim().replace(/[.!]+$/, '');
  if (!s) return null;

  // Home address
  const home = s.match(/^(?:ich wohne|mein zuhause ist|mein zu hause ist|meine adresse ist|zu ?hause ist|ich starte (?:meistens )?(?:von|in|bei))\s+(?:jetzt\s+)?(?:in der|in den|in|am|an der|auf der|bei)?\s*(.+)$/i);
  if (home && /\d|straße|strasse|gasse|platz|weg|wien|graz|linz|salzburg|innsbruck/i.test(home[1])) {
    const address = home[1].trim();
    return { patch: { home: address }, confirm: `Ich rechne Wege ab „${address}“, wenn ich nicht weiß, wo du bist.` };
  }

  // Buffer: "10 Minuten Puffer"
  const buf = s.match(new RegExp(`${NUM}\\s*min(?:uten)?\\s+(?:puffer|früher (?:da|dort|ankommen))`, 'i'))
    ?? s.match(new RegExp(`puffer\\s+(?:von\\s+)?${NUM}\\s*min`, 'i'));
  if (buf) {
    const n = parseNumber(buf[1]);
    if (n !== null && n <= 120) return { patch: { bufferMin: n }, confirm: `Ich plane ${n} Minuten Puffer ein.` };
  }

  // Heads-up: "Erinnere mich 20 Minuten vor dem Losgehen / vorher"
  const pre = s.match(new RegExp(`erinner\\w*\\s+(?:mich\\s+)?${NUM}\\s*min(?:uten)?\\s+(vor dem los\\w*|vorher|früher|bevor ich los\\w*)`, 'i'));
  if (pre) {
    const n = parseNumber(pre[1]);
    if (n !== null && n <= 120) {
      return /los/i.test(pre[2])
        ? { patch: { preMin: n }, confirm: `Ich erinnere dich ${n} Minuten, bevor du los musst, und dann noch einmal zum Losgehen.` }
        : { patch: { plainMin: n, preMin: n }, confirm: `Ich erinnere dich ${n} Minuten vor Terminen und ${n} Minuten vor dem Losgehen.` };
    }
  }

  const mode = findMode(s);
  if (!mode) return null;
  // A travel sentence needs a verb of getting around, so "Auto zum Service bringen" stays an order.
  if (!/\b(fahr\w*|bin\b|komm\w*|geh\w*|lauf\w*|nehm\w*|unterwegs|mit (?:dem|den|der)|zu fu(?:ß|ss)|plane?|rechne)/i.test(s)) return null;

  const when = s.match(/\b(heute|morgen|übermorgen)\b/i)?.[1].toLowerCase();
  if (when) {
    const date = addDays(today, when === 'heute' ? 0 : when === 'morgen' ? 1 : 2);
    return { patch: { dayModes: { [date]: mode } }, confirm: `${capital(when)} plane ich alle Wege ${MODE_WITH[mode]}.` };
  }

  const target = s.match(/^(?:zu[mr]?|ins?|für (?:den|die|das)?|nach)\s+(.+?)\s+(?:fahr\w*|geh\w*|komm\w*|nehm\w*|bin|lauf\w*)\b/i)
    ?? s.match(/\b(?:zu[mr]?|ins?|nach)\s+(?:dem termin\s+)?(.+?)\s*$/i);
  if (target) {
    const ev = matchEvent(target[1].replace(/\s+(?:mit|zu fu(?:ß|ss)).*$/i, ''), events);
    if (ev) return { patch: { eventModes: { [ev.key]: mode } }, confirm: `Zu „${ev.title}“ plane ich ${MODE_WITH[mode]}.` };
  }

  return { patch: { mode }, confirm: `Ab jetzt plane ich deine Wege ${MODE_WITH[mode]}.` };
}

/** Day and appointment choices add to the existing ones instead of replacing them. */
export function applyCommand(prefs: TravelPrefs, cmd: TravelCommand): Partial<TravelPrefs> {
  const p = { ...cmd.patch };
  if (p.dayModes) p.dayModes = { ...prefs.dayModes, ...p.dayModes };
  if (p.eventModes) p.eventModes = { ...prefs.eventModes, ...p.eventModes };
  return p;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
