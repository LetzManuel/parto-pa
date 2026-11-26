// One microphone for everything: a spoken sentence goes to the one feature it belongs to. On the device, without AI,
// by the fixed patterns each feature already has. The order matters: the most specific patterns ask first, the memo
// templates take whatever is left. Every route ends in one confirm (spoken "ja" or one tap), never in an action.
//
//   1. "gurkerl zuerst", "Neuer Friseur …", "Stichwort … für …"          → Meine Anbieter
//   2. "Heute bin ich mit dem Auto unterwegs"                              → Wege (travel preferences)
//   3. "Schreib Anna, dass …", "Absage an Studio Nails per WhatsApp: …"   → Nachricht
//   4. "Bestell bei gurkerl Milch", "Jeden Freitag Wocheneinkauf: …"       → Einkauf & Essen
//   5. "Friseur alle 5 Wochen", "Hab gestern mit Anna telefoniert"         → Rhythmus
//   6. "Friseur morgen 14 bis 17 Uhr", "Babysitter Samstag ab 19 Uhr"      → Bei Anbietern prüfen
//   7. anything else                                                       → Memo → Auftrag (templates)
import { parseAnbieterCommand, type AnbieterCommand } from '../anbieter/voice';
import { kindWords, shopWords } from '../anbieter/lists';
import type { Favourite, BookingRequest } from '../favourites/model';
import { mentions, parseRequest as parseBooking } from '../favourites/request';
import { isMessageIntent, parseRequest as parseMessage, type MessageRequest, type Recipient } from '../messages';
import { parseRhythmSentence, type RhythmCommand } from '../rhythms/say';
import { isShoppingIntent, parseShopping, type ShopIntent } from '../shopping/parse';
import { suggest, type Suggestion } from '../templates/templates';
import type { ISODate } from '../time/dates';
import type { Upcoming } from '../calendar/upcoming';
import { parseTravelCommand, type TravelCommand } from '../travel/voice';

export type Route =
  | { to: 'anbieter'; cmd: AnbieterCommand }
  | { to: 'travel'; cmd: TravelCommand }
  | { to: 'message'; req: MessageRequest }
  | { to: 'shopping'; intent: ShopIntent }
  | { to: 'rhythm'; cmd: RhythmCommand }
  | { to: 'booking'; req: BookingRequest }
  | { to: 'memo'; best: Suggestion | null };

export interface RouteContext {
  today: ISODate;
  favourites: Favourite[];
  recipients: Recipient[];
  upcoming?: Upcoming[];
}

/** A reminder ("Erinner mich …", "Wenn … dann …") always stays a memo, even if it mentions a shop or a salon. */
const REMINDER = /^\s*(erinner\w*|vergiss nicht|nicht vergessen|wenn\s|falls\s|merk dir|notier\w*)/i;
/** Asking for a slot: a time word or a want/need verb next to the list word. */
const WHEN_WORDS = /\b(heute|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|wochenende|nächste[nr]? woche|uhr|ab\s+\d|zwischen|vormittag|nachmittag|abend|mittag|termin|tisch|reservier\w*|karten|tickets?|brauch\w*|such\w*|buch\w*|frei)\b/i;

export function route(raw: string, ctx: RouteContext): Route {
  const said = raw.trim();
  const best = suggest(said, ctx.today)[0] ?? null;
  if (!said) return { to: 'memo', best: null };

  const anbieter = parseAnbieterCommand(said, ctx.favourites);
  if (anbieter) return { to: 'anbieter', cmd: anbieter };

  const travel = parseTravelCommand(said, ctx.today, ctx.upcoming ?? []);
  if (travel) return { to: 'travel', cmd: travel };

  if (isMessageIntent(said)) return { to: 'message', req: parseMessage(said, ctx.recipients, ctx.today) };

  if (!REMINDER.test(said)) {
    const shop = shopping(said, ctx.favourites);
    if (shop) return { to: 'shopping', intent: shop };

    const rhythm = parseRhythmSentence(said, ctx.today);
    if (rhythm) return { to: 'rhythm', cmd: rhythm };

    const req = parseBooking(said, ctx.today, undefined, kindWords(ctx.favourites));
    if (req && (WHEN_WORDS.test(said) || !best || best.confidence < 0.85)) return { to: 'booking', req };
  }

  return { to: 'memo', best };
}

/** Shopping, also when only an own shop name or keyword says so ("Billa am Eck: Milch und Brot"). */
function shopping(said: string, favs: Favourite[]): ShopIntent | null {
  if (isShoppingIntent(said)) return parseShopping(said);
  const own = shopWords(favs);
  if (mentions(said, own.grocery) || mentions(said, own.food)) {
    const i = parseShopping(`Bestell ${said}`);
    if (i) return { ...i, kind: mentions(said, own.food) && !mentions(said, own.grocery) ? 'food' : i.kind };
  }
  return null;
}
