// Where an order goes, by the person's own rules on "Meine Anbieter" (favourite table, kind grocery/food):
//   topic = category for groceries ("Alkohol" → Alfies), cuisine for food ("Italienisch" → Riva, Da Mario, …),
//   or a time condition ("Wochenende" → foodora, "Werktags" → gurkerl). No topic = the general order.
// Order of decision: platform said aloud › category/cuisine › time condition › general order › platforms switched on.
// A basket with items of a category that has its own rule is split ("Wein geht an Alfies").
import { entries } from '../anbieter/lists';
import type { Favourite } from '../favourites/model';
import type { ShopKind } from '../model';
import { weekday, type ISODate } from '../time/dates';
import type { ShopItem } from './parse';
import { platform } from './platforms';

export const WEEKEND = 'Wochenende';
export const WORKDAYS = 'Werktags';
export const TIME_TOPICS = [WEEKEND, WORKDAYS];

/** Grocery categories a rule can name. Matched on item names, on the device. */
export const CATEGORIES: Array<[string, RegExp]> = [
  ['Alkohol', /(wein|sekt|prosecco|champagner|bier|radler|cider|gin\b|rum\b|wodka|vodka|whisk|schnaps|likör|aperol|spritz|campari|jägermeister|obstler|grappa|portwein|lillet|alkohol|spirituose)/i],
  ['Getränke', /(mineral|wasser|saft|cola|limo|eistee|almdudler|soda|getränk)/i],
  ['Drogerie', /(waschmittel|klopapier|toilettenpapier|zahnpasta|zahnbürste|shampoo|duschgel|deo|windeln|taschentücher|spülmittel|geschirrtabs|weichspüler|seife|rasier|drogerie)/i],
  ['Tierbedarf', /(katzenfutter|hundefutter|katzenstreu|tierfutter|leckerli)/i],
];

/** Cuisines for food orders. The words also find the cuisine in "Bestell Pizza". */
export const CUISINES: Array<[string, RegExp]> = [
  ['Italienisch', /(italien|italiener|pizza|pasta|lasagne|risotto|spaghetti|gnocchi|tiramisu)/i],
  ['Japanisch', /(japan|sushi|ramen|maki|udon|japaner)/i],
  ['Indisch', /(indisch|inder|curry|tandoori|naan|biryani)/i],
  ['Asiatisch', /(asiat|thai|pho|vietnam|chinesisch|chinese|wok|dim sum|nudelbox)/i],
  ['Orientalisch', /(döner|kebab|falafel|libanes|türkisch|orientalisch|hummus|levant)/i],
  ['Burger', /(burger)/i],
  ['Mexikanisch', /(mexikan|burrito|taco|nachos|quesadilla)/i],
  ['Österreichisch', /(schnitzel|gulasch|wirtshaus|österreichisch|knödel|backhendl)/i],
  ['Poke & Bowls', /(poke|bowl)/i],
];

export function categoryOf(text: string): string | null {
  return CATEGORIES.find(([, re]) => re.test(text))?.[0] ?? null;
}

export function cuisineOf(text: string): string | null {
  return CUISINES.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** Topic name as the person said it, matched to a known category, cuisine or time topic. */
export function normalizeTopic(word: string): string {
  const w = word.trim();
  if (/^(am\s+)?wochenende|^samstags?|^sonntags?/i.test(w)) return WEEKEND;
  if (/^(unter der woche|werktags?|wochentags?)/i.test(w)) return WORKDAYS;
  return cuisineOf(w) ?? categoryOf(w) ?? cap(w);
}

export function isWeekend(d: ISODate): boolean {
  const wd = weekday(d);
  return wd === 0 || wd === 6;
}

export interface Choice {
  platformId: string | null;
  storeUrl: string | null;
  /** Restaurant (food with a cuisine list) or the entry's own name; null = platform only. */
  name: string | null;
  topic: string | null;
  entryId: string | null;
  /** Spoken reason, e.g. "deine Nummer 1 für Italienisch", "am Wochenende". Null = general order. */
  reason: string | null;
}

/** Shop entries of one list and topic, in the person's order. */
export function shopEntries(all: Favourite[], kind: ShopKind, topic: string | null): Favourite[] {
  return entries(all, kind).filter((f) => f.system === 'shop' && !!f.systemRef && !!platform(f.systemRef) && (f.topic ?? '') === (topic ?? ''));
}

const fromEntry = (f: Favourite, reason: string | null): Choice => ({
  platformId: f.systemRef, storeUrl: f.bookingUrl, name: f.topic && !TIME_TOPICS.includes(f.topic) && f.name !== platform(f.systemRef)?.name ? f.name : null,
  topic: f.topic, entryId: f.id, reason,
});

export interface ChooseInput {
  kind: ShopKind;
  /** Platform said aloud: id, null = a shop without delivery, undefined = none said. */
  explicit?: string | null;
  /** The whole sentence (for the cuisine) and the items (for the category). */
  text: string;
  items: ShopItem[];
  date: ISODate;
  favourites: Favourite[];
  /** Platform when no rule applies (first platform switched on). */
  fallback?: string;
}

/** All candidates in order: the first is PA's pick, the rest answer "nächstes". */
export function choices(i: ChooseInput): Choice[] {
  if (i.explicit === null) return [{ platformId: null, storeUrl: null, name: null, topic: null, entryId: null, reason: null }];
  const tiers: Array<{ topic: string | null; reason: (n: number) => string | null }> = [];
  if (i.kind === 'food') {
    const c = cuisineOf(i.text);
    if (c) tiers.push({ topic: c, reason: (n) => `deine Nummer ${n} für ${c}` });
  } else {
    const cats = new Set(i.items.map((x) => categoryOf(x.name)));
    const [only] = [...cats];
    if (cats.size === 1 && only) tiers.push({ topic: only, reason: () => `deine Regel für ${only}` });
  }
  const time = isWeekend(i.date) ? WEEKEND : WORKDAYS;
  tiers.push({ topic: time, reason: () => (time === WEEKEND ? 'am Wochenende' : 'unter der Woche') });
  tiers.push({ topic: null, reason: () => null });

  const out: Choice[] = [];
  const seen = new Set<string>();
  for (const t of tiers) {
    shopEntries(i.favourites, i.kind, t.topic).forEach((f, n) => {
      const key = `${f.systemRef}|${f.bookingUrl ?? ''}|${f.topic && !TIME_TOPICS.includes(f.topic) ? f.name : ''}`;
      if (i.explicit && f.systemRef !== i.explicit) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(fromEntry(f, t.reason(n + 1)));
    });
  }
  const plain = i.explicit ?? i.fallback ?? null;
  if (plain && !out.some((c) => c.platformId === plain)) out.push({ platformId: plain, storeUrl: null, name: null, topic: null, entryId: null, reason: null });
  return out.length ? out : [{ platformId: null, storeUrl: null, name: null, topic: null, entryId: null, reason: null }];
}

export interface BasketPart { items: ShopItem[]; choice: Choice; alternatives: Choice[] }

/**
 * Splits a grocery basket by category rules: "Milch, Eier, 2 Flaschen Wein" with "Alkohol → Alfies" becomes
 * gurkerl (Milch, Eier) + Alfies (Wein). Food and baskets with a platform said aloud are not split.
 */
export function plan(i: ChooseInput): BasketPart[] {
  if (i.kind === 'grocery' && i.explicit === undefined && i.items.length > 1) {
    const groups = new Map<string, ShopItem[]>();
    const rest: ShopItem[] = [];
    for (const it of i.items) {
      const cat = categoryOf(it.name);
      if (cat && shopEntries(i.favourites, 'grocery', cat).length) groups.set(cat, [...(groups.get(cat) ?? []), it]);
      else rest.push(it);
    }
    if (groups.size && rest.length) {
      const parts: BasketPart[] = [];
      const main = choices({ ...i, items: rest });
      parts.push({ items: rest, choice: main[0], alternatives: main.slice(1) });
      for (const [, items] of groups) {
        const c = choices({ ...i, items });
        // Same place as the main basket: keep it in one basket.
        if (c[0].platformId === main[0].platformId && c[0].storeUrl === main[0].storeUrl) parts[0].items.push(...items);
        else parts.push({ items, choice: c[0], alternatives: c.slice(1) });
      }
      return parts;
    }
  }
  const c = choices(i);
  return [{ items: i.items, choice: c[0], alternatives: c.slice(1) }];
}

/** "gurkerl" / "Riva über Lieferando" for read-back. */
export function placeLabel(c: Choice): string {
  const p = platform(c.platformId)?.name;
  if (c.name && p) return `${c.name} über ${p}`;
  return c.name ?? p ?? 'Liste fürs Geschäft';
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
