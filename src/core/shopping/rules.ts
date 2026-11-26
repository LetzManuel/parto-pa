// Spoken rules and rankings for ordering, stored on "Meine Anbieter" (favourite table). Fixed patterns, no AI.
// Each command comes back with one sentence to confirm; nothing changes before "ja".
//   "Alkohol bestelle ich bei Alfies"            → grocery, topic Alkohol: Alfies first
//   "Am Wochenende bestelle ich bei foodora"     → topic Wochenende: foodora first (food and groceries)
//   "Italienisch: Riva, Da Mario, Bella Napoli"  → food, topic Italienisch, in this order
//   "Riva für Italienisch über Lieferando"       → adds Riva to Italienisch
//   "Riva war super" / "war schlecht" / "Riva nie wieder"  → one place up / down / removed (after an order)
import type { Store } from '../db/store';
import { applyMove, entries, removeEntry, shopEntry } from '../anbieter/lists';
import type { Favourite } from '../favourites/model';
import type { ShopKind, ShopRun } from '../model';
import { CATEGORIES, CUISINES, normalizeTopic, shopEntries, TIME_TOPICS, WEEKEND } from './choose';
import { ALIAS_RE, ALIASES, PLATFORMS, platform } from './platforms';

export type ShopRule =
  /** Platform first for a topic (category or time). */
  | { type: 'platform'; kinds: ShopKind[]; topic: string; platformId: string; confirm: string }
  /** Restaurants for a cuisine, in this order (missing ones are added on the given or default platform). */
  | { type: 'ranking'; topic: string; names: string[]; platformId: string | null; confirm: string }
  | { type: 'rate'; entryId: string; name: string; topic: string | null; mood: 'up' | 'down' | 'never'; confirm: string };

const PLAT = `(${ALIAS_RE}|${PLATFORMS.map((p) => p.name.toLowerCase()).join('|')})`;
const CAT_WORDS = '(alkohol|wein|bier|getränke|drogerie\\w*|tierbedarf|tierfutter|\\w*futter)';
const TIME_WORDS = '(am wochenende|wochenends|samstags?|sonntags?|unter der woche|werktags|wochentags)';
const CUISINE_WORDS = CUISINES.map(([name]) => name.toLowerCase().replace(/ & /, ' und ')).join('|');
const lc = (s: string) => s.toLowerCase().trim();
const clean = (s: string) => s.trim().replace(/^(?:der|die|das|den|beim|bei)\s+/i, '').replace(/[.!?,]+$/, '').trim();

function platformId(word: string): string | null {
  const w = lc(word);
  return PLATFORMS.find((p) => lc(p.name) === w)?.id ?? ALIASES[w]?.platformId ?? null;
}

/** Restaurant entry by spoken name. */
function findRestaurant(all: Favourite[], name: string): Favourite | null {
  const n = lc(clean(name));
  const pool = entries(all, 'food').filter((f) => f.system === 'shop');
  return pool.find((f) => lc(f.name) === n) ?? pool.find((f) => n.length >= 3 && (lc(f.name).includes(n) || n.includes(lc(f.name)))) ?? null;
}

const topicLabel = (t: string) => (t === WEEKEND ? 'am Wochenende' : TIME_TOPICS.includes(t) ? 'unter der Woche' : `bei ${t}`);

export function parseShopRule(text: string, all: Favourite[], lastRun?: { run: ShopRun; name: string } | null): ShopRule | null {
  const s = text.trim().replace(/[.!?]+$/, '');
  let m: RegExpMatchArray | null;

  // Category / time → platform: "Alkohol bestelle ich bei Alfies", "Am Wochenende bei foodora", "Wein immer über Alfies"
  let word: string | undefined, plat: string | undefined;
  m = s.match(new RegExp(`^(?:${CAT_WORDS}|${TIME_WORDS})\\s+(?:(?:bestell|kauf)\\w*\\s+(?:ich\\s+)?)?(?:essen\\s+|einkauf\\s+|lebensmittel\\s+)?(?:immer\\s+|lieber\\s+|nur\\s+)?(?:bei|über|von|mit)\\s+${PLAT}(?:\\s+(?:bestellen|kaufen))?$`, 'i'));
  if (m) { word = m[1] ?? m[2]; plat = m[3]; }
  else {
    m = s.match(new RegExp(`^${TIME_WORDS}\\s+(?:immer\\s+)?${PLAT}(?:\\s+(?:zuerst|bestellen))?$`, 'i'));
    if (m) { word = m[1]; plat = m[2]; }
  }
  if (word && plat) {
    const p = platform(platformId(plat));
    if (p) {
      const topic = normalizeTopic(word);
      const isTime = TIME_TOPICS.includes(topic);
      const essen = /essen/i.test(s), einkauf = /einkauf|lebensmittel/i.test(s);
      const kinds: ShopKind[] = isTime
        ? ((essen ? ['food'] : einkauf ? ['grocery'] : p.kinds) as ShopKind[]).filter((k) => p.kinds.includes(k))
        : ['grocery'];
      if (kinds.length) {
        const what = isTime ? (kinds.length === 2 ? 'Essen und Einkauf ' : kinds[0] === 'food' ? 'Essen ' : 'Einkauf ') : `${topic} `;
        return { type: 'platform', kinds, topic, platformId: p.id, confirm: `${isTime ? `${cap(topicLabel(topic))} ${what}` : what}immer zuerst bei ${p.name}?` };
      }
    }
  }

  // Ranking: "Italienisch: Riva, Da Mario und Bella Napoli", "Beim Italiener zuerst Riva, dann Da Mario", "Top Sushi: …"
  m = s.match(new RegExp(`^(?:top\\s+|meine\\s+|beste[nr]?\\s+)?(?:beim\\s+|bei\\s+)?(${CUISINE_WORDS}|\\w*(?:italiener|inder|asiate|japaner|chinese|thai|mexikaner|burger|sushi|pizza|döner|kebab)\\w*)\\s*(?::|reihenfolge:?|zuerst|ist|sind)\\s+(.+)$`, 'i'));
  if (m) {
    const topic = normalizeTopic(m[1]);
    let rest = m[2];
    const via = rest.match(new RegExp(`\\s+(?:über|bei|auf)\\s+${PLAT}$`, 'i'));
    if (via) rest = rest.slice(0, via.index);
    const names = rest.split(/\s*(?:,|;|\bund\b|\bdann\b|\bdanach\b)\s*/i).map(clean).filter((x) => x.length > 1);
    if (CUISINES.some(([c]) => c === topic) && names.length) {
      return { type: 'ranking', topic, names, platformId: via ? platformId(via[1]) : null,
        confirm: `${topic}: ${names.map((n, k) => `${k + 1}. ${n}`).join(', ')}. Speichern?` };
    }
  }

  // Add one restaurant: "Riva für Italienisch (über Lieferando)", "Riva ist mein Italiener"
  m = s.match(new RegExp(`^(.+?)\\s+(?:für|als|zu)\\s+(${CUISINE_WORDS}|\\w*(?:italiener|inder|asiate|japaner|sushi|pizza|burger|döner)\\w*)(?:\\s+(?:über|bei|auf)\\s+${PLAT})?(?:\\s+(?:hinzu\\w*|dazu|speichern|merken))?$`, 'i'))
    ?? s.match(new RegExp(`^(.+?)\\s+ist\\s+mein(?:e)?\\s+(?:liebste[rns]?\\s+)?(\\w*(?:italiener|inder|asiate|japaner|sushi|pizza|burger|döner)\\w*)(?:\\s+(?:über|bei|auf)\\s+${PLAT})?$`, 'i'));
  if (m) {
    const topic = normalizeTopic(m[2]);
    const name = clean(m[1].replace(/^(?:füg\w*|nimm|speicher\w*)\s+/i, ''));
    if (CUISINES.some(([c]) => c === topic) && name && !platformId(name)) {
      const have = shopEntries(all, 'food', topic).map((f) => f.name);
      const names = have.some((h) => lc(h) === lc(name)) ? have : [...have, name];
      const place = names.findIndex((n) => lc(n) === lc(name)) + 1;
      return { type: 'ranking', topic, names, platformId: m[3] ? platformId(m[3]) : null, confirm: `${name} als Nummer ${place} für ${topic} speichern?` };
    }
  }

  // Feedback after an order: "Riva war super", "war schlecht", "Riva nie wieder", "nie wieder Riva"
  m = s.match(/^(?:(.+?)\s+)?war\s+(?:echt\s+|sehr\s+|richtig\s+|ziemlich\s+|leider\s+)?(super|toll|top|klasse|großartig|sehr gut|gut|lecker|hervorragend|schlecht|nicht gut|nicht so gut|kalt|enttäuschend|mies|zu spät|grauslich)$/i)
    ?? s.match(/^(?:(.+?)\s+)?(nie wieder|nie mehr)(?:\s+(.+))?$/i);
  if (m) {
    const word = lc(m[2]);
    const mood: 'up' | 'down' | 'never' = /nie/.test(word) ? 'never' : /schlecht|nicht|kalt|enttäusch|mies|spät|grauslich/.test(word) ? 'down' : 'up';
    const who = m[1] ?? m[3];
    const e = who ? findRestaurant(all, who) : lastRun ? findRestaurant(all, lastRun.name) : null;
    if (e) {
      const list = shopEntries(all, 'food', e.topic);
      const at = list.findIndex((x) => x.id === e.id) + 1;
      const where = e.topic ? ` bei ${e.topic}` : '';
      const confirm = mood === 'never' ? `${e.name} aus deiner Liste${where} streichen?`
        : mood === 'up' ? (at <= 1 ? `${e.name} bleibt deine Nummer 1${where}. Passt?` : `${e.name}${where} auf Platz ${at - 1} vorziehen?`)
        : (at >= list.length ? `${e.name} ist schon ganz hinten${where}. Ganz streichen?` : `${e.name}${where} auf Platz ${at + 1} zurückreihen?`);
      return { type: 'rate', entryId: e.id, name: e.name, topic: e.topic, mood: mood === 'down' && at >= list.length ? 'never' : mood, confirm };
    }
  }
  return null;
}

/** Applies a confirmed rule. Returns the sentence PA says afterwards. */
export function applyShopRule(store: Store, r: ShopRule, fallbackFood?: string): string {
  const all = () => store.list('favourite');
  switch (r.type) {
    case 'platform': {
      for (const kind of r.kinds) {
        let list = shopEntries(all(), kind, r.topic);
        let e = list.find((f) => f.systemRef === r.platformId);
        if (!e) { e = store.save('favourite', { ...shopEntry(all(), kind, r.platformId), topic: r.topic, priority: list.length + 1 }); list = shopEntries(all(), kind, r.topic); }
        applyMove(store, list, e.id, 0);
      }
      const p = platform(r.platformId)!;
      return `Gemerkt: ${TIME_TOPICS.includes(r.topic) ? topicLabel(r.topic) : r.topic} zuerst ${p.name}.`;
    }
    case 'ranking': {
      const pid = r.platformId ?? fallbackFood ?? PLATFORMS.find((p) => p.kinds.includes('food'))!.id;
      for (const name of r.names) {
        const have = shopEntries(all(), 'food', r.topic).find((f) => lc(f.name) === lc(name));
        if (!have) store.save('favourite', { ...shopEntry(all(), 'food', pid, null, name), topic: r.topic, priority: shopEntries(all(), 'food', r.topic).length + 1 });
      }
      r.names.forEach((name, k) => {
        const list = shopEntries(all(), 'food', r.topic);
        const e = list.find((f) => lc(f.name) === lc(name));
        if (e) applyMove(store, list, e.id, k);
      });
      return `${r.topic} gespeichert: ${r.names.join(', ')}.`;
    }
    case 'rate': {
      const list = shopEntries(all(), 'food', r.topic);
      const e = list.find((f) => f.id === r.entryId);
      if (!e) return 'Nicht gefunden.';
      if (r.mood === 'never') { removeEntry(store, all(), e); return `${r.name} ist gestrichen.`; }
      const at = list.findIndex((x) => x.id === e.id);
      const to = r.mood === 'up' ? Math.max(0, at - 1) : Math.min(list.length - 1, at + 1);
      applyMove(store, list, e.id, to);
      return `${r.name} ist jetzt deine Nummer ${to + 1}${r.topic ? ` für ${r.topic}` : ''}.`;
    }
  }
}

/** Last food order that came from a ranked restaurant (for "war super" without a name). */
export function lastRestaurantRun(runs: ShopRun[], lists: Array<{ id: string; name: string; kind: ShopKind }>): { run: ShopRun; name: string } | null {
  const food = new Map(lists.filter((l) => l.kind === 'food').map((l) => [l.id, l.name]));
  const run = [...runs].filter((r) => r.listId && food.has(r.listId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  return run ? { run, name: food.get(run.listId!)! } : null;
}

export { CATEGORIES };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
