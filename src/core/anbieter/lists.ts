// "Meine Anbieter": the person keeps their own lists (shops, salons, beauty, doctors, restaurants, tickets, babysitters)
// in their own order. The order decides where PA looks first when it checks slots or opens a shop.
// Everything lives in the favourite table (cloud: personal space only), so it syncs without a new table:
//   - an entry:   kind = list, priority 1..n, system = booking system or 'shop' (systemRef = platform id)
//   - a keyword:  kind = list, system = 'keyword', name = the word ("Haare", "Barber"), priority 0
// Keywords help the on-device recogniser and the router map speech to the right list.
import type { Store } from '../db/store';
import { isFavKind, LIST_LABEL, type FavKind, type Favourite, type ListKind } from '../favourites/model';
import type { KindWords } from '../favourites/request';
import { stamp } from '../model';
import { PLATFORMS, platform } from '../shopping/platforms';

/** Order on the screen: shopping first (most frequent on the go), then appointments. */
export const LIST_KINDS: ListKind[] = ['grocery', 'food', 'salon', 'beauty', 'doctor', 'restaurant', 'tickets', 'babysitter'];

export const KEYWORD_HINT: Record<ListKind, string> = {
  grocery: 'Wocheneinkauf, Milch, Drogerie', food: 'Pizza, Sushi, Mittagessen', salon: 'Haare, Schneiden, Barber',
  beauty: 'Nägel, Wimpern, Gesicht', doctor: 'Zähne, Rücken, Kontrolle', restaurant: 'Tisch, Heuriger, Brunch',
  tickets: 'Konzert, Kabarett, Oper', babysitter: 'Aufpassen, Kinder',
};

export const isKeyword = (f: Pick<Favourite, 'system'>) => f.system === 'keyword';

export function entries(all: Favourite[], kind: ListKind): Favourite[] {
  return all.filter((f) => f.kind === kind && !isKeyword(f)).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/** Entries grouped by topic (doctors by field), each group in priority order. '' = no topic. */
export function groups(all: Favourite[], kind: ListKind): Array<{ topic: string; list: Favourite[] }> {
  const mine = entries(all, kind);
  const topics = [...new Set(mine.map((x) => x.topic ?? ''))].sort();
  return topics.map((topic) => ({ topic, list: mine.filter((x) => (x.topic ?? '') === topic) }));
}

export function keywords(all: Favourite[], kind: ListKind): Favourite[] {
  return all.filter((f) => f.kind === kind && isKeyword(f)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/** New keyword row, or null if the list already has it. */
export function newKeyword(all: Favourite[], kind: ListKind, word: string): Favourite | null {
  const w = norm(word).replace(/^[„"']|[“"']$/g, '');
  if (w.length < 2 || keywords(all, kind).some((k) => k.name.toLowerCase() === w.toLowerCase())) return null;
  return stamp<Omit<Favourite, 'id' | 'createdAt' | 'updatedAt'>>({
    kind, topic: null, priority: 0, name: w, system: 'keyword', systemRef: null, bookingUrl: null, phone: null, durationMin: null, note: null,
  });
}

/** Rows whose priority changes when `id` moves to position `to` (0-based) inside `list`. */
export function moveTo(list: Favourite[], id: string, to: number, now = new Date()): Favourite[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return [];
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  const t = now.toISOString();
  return next.flatMap((x, k) => (x.priority !== k + 1 ? [{ ...x, priority: k + 1, updatedAt: t }] : []));
}

export function applyMove(store: Store, list: Favourite[], id: string, to: number): void {
  for (const r of moveTo(list, id, to)) store.save('favourite', r);
}

export function removeEntry(store: Store, all: Favourite[], x: Favourite): void {
  store.remove('favourite', x.id);
  const rest = entries(all, x.kind).filter((y) => y.id !== x.id && (y.topic ?? '') === (x.topic ?? ''));
  const t = new Date().toISOString();
  rest.forEach((y, k) => { if (y.priority !== k + 1) store.save('favourite', { ...y, priority: k + 1, updatedAt: t }); });
}

export function newEntry(all: Favourite[], d: Partial<Favourite> & Pick<Favourite, 'kind' | 'name'>): Favourite {
  const topic = d.topic ?? null;
  const prio = entries(all, d.kind).filter((x) => (x.topic ?? '') === (topic ?? '')).length + 1;
  return stamp<Omit<Favourite, 'id' | 'createdAt' | 'updatedAt'>>({
    topic, priority: prio, system: 'manual', systemRef: null, bookingUrl: null, phone: null, durationMin: null, note: null, ...d, kind: d.kind, name: norm(d.name),
  });
}

/** A shop entry for a platform (gurkerl, foodora, …). */
export function shopEntry(all: Favourite[], kind: 'grocery' | 'food', platformId: string, storeUrl: string | null = null, name?: string): Favourite {
  return newEntry(all, { kind, name: name ?? platform(platformId)?.name ?? platformId, system: 'shop', systemRef: platformId, bookingUrl: storeUrl });
}

/** Words that point to a booking list: own keywords and the names of the entries themselves ("Haarwerk" → Friseur). */
export function kindWords(all: Favourite[]): KindWords {
  const out: KindWords = {};
  for (const f of all) {
    if (!isFavKind(f.kind)) continue;
    const k: FavKind = f.kind;
    (out[k] ??= []).push(f.name);
  }
  return out;
}

/** Own words for shopping lists: a spoken sentence with one of them is an order even without "bestell". */
export function shopWords(all: Favourite[]): Record<'grocery' | 'food', string[]> {
  return {
    grocery: all.filter((f) => f.kind === 'grocery').map((f) => f.name),
    food: all.filter((f) => f.kind === 'food').map((f) => f.name),
  };
}

/**
 * Platform order for a kind as the person set it on "Meine Anbieter". Empty = not set, the shopping module then
 * uses its default (platforms switched on in Ich › Bestellen).
 */
export function shopOrder(all: Favourite[], kind: 'grocery' | 'food'): Array<{ platformId: string; storeUrl: string | null }> {
  return entries(all, kind).filter((f) => f.system === 'shop' && f.systemRef && platform(f.systemRef))
    .map((f) => ({ platformId: f.systemRef!, storeUrl: f.bookingUrl }));
}

/** Phrases for speech recognisers that accept hints (names and keywords the person uses). */
export function speechPhrases(all: Favourite[]): string[] {
  const set = new Set<string>(PLATFORMS.map((p) => p.name));
  for (const f of all) if (f.name.trim().length > 1) set.add(f.name.trim());
  return [...set].slice(0, 200);
}

export const listLabel = (k: ListKind) => LIST_LABEL[k];
