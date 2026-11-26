// Baskets ("Einkaufslisten") and their rhythm. Semi-automatic: on its day PA has the basket ready and asks once;
// the user confirms, PA opens the platform with the list, the user orders there and says "bestellt".
import { stamp, type ShopKind, type ShopList, type ShopRun } from '../model';
import { addDays, addInterval, weekday, type ISODate, type Unit } from '../time/dates';
import { formatItem, itemsToText, parseItem, splitItems, textToItems, type ShopIntent, type ShopItem } from './parse';
import { platform, type Platform } from './platforms';

export const DEFAULT_LEAD_DAYS = 1;

export function createList(d: Partial<ShopList> & { name: string; kind: ShopKind }, now = new Date()): ShopList {
  return stamp<Omit<ShopList, 'id' | 'createdAt' | 'updatedAt'>>({
    platformId: null, storeUrl: null, items: '', everyN: null, everyUnit: null, weekday: null, nextDate: null,
    leadDays: DEFAULT_LEAD_DAYS, handedOn: null, lastOrdered: null, state: 'active', ...d,
  }, now);
}

const touch = (l: ShopList, patch: Partial<ShopList>): ShopList => ({ ...l, ...patch, updatedAt: new Date().toISOString() });

/** First date on/after `from` that fits the weekday (or `from` itself without one). */
export function onWeekday(from: ISODate, wd: number | null): ISODate {
  if (wd === null) return from;
  return addDays(from, (wd - weekday(from) + 7) % 7);
}

/** List from a spoken intent. A rhythm makes it recurring, starting with the next fitting day. */
export function listFromIntent(i: ShopIntent, today: ISODate, fallbackPlatform?: string): ShopList {
  const recurring = !!i.everyN;
  const platformId = i.platformId === undefined ? fallbackPlatform ?? null : i.platformId;
  return createList({
    name: i.name ?? (i.kind === 'food' ? 'Essen bestellen' : recurring ? 'Wocheneinkauf' : 'Einkauf'),
    kind: i.kind,
    platformId,
    items: itemsToText(i.items),
    everyN: i.everyN ?? null,
    everyUnit: i.everyUnit ?? null,
    weekday: i.weekday ?? null,
    nextDate: recurring ? onWeekday(addDays(today, 1), i.weekday ?? null) : today,
  });
}

/** "Bestell das Übliche" / "den Wocheneinkauf nochmal": the matching saved list. "Übliche" = the most used one. */
export function findList(lists: ShopList[], name: string, runs: ShopRun[] = []): ShopList | undefined {
  const active = lists.filter((l) => l.state !== 'done');
  const n = name.toLowerCase();
  if (n === 'übliche') {
    const count = (l: ShopList) => runs.filter((r) => r.listId === l.id).length;
    return [...active].sort((a, b) => count(b) - count(a) || (b.everyN ? 1 : 0) - (a.everyN ? 1 : 0))[0];
  }
  return active.find((l) => l.name.toLowerCase() === n) ?? active.find((l) => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase()));
}

/** From this day on PA shows the prepared basket. */
export function readyFrom(l: ShopList): ISODate | null {
  return l.nextDate ? addDays(l.nextDate, -l.leadDays) : null;
}

/** Baskets that want a decision today: due ones, and ones opened earlier that are not confirmed as ordered yet. */
export function dueLists(lists: ShopList[], today: ISODate): ShopList[] {
  return lists
    .filter((l) => l.state === 'active' && (l.handedOn !== null || ((readyFrom(l) ?? '9999') <= today)))
    .sort((a, b) => (a.nextDate ?? '').localeCompare(b.nextDate ?? ''));
}

/** User tapped "Öffnen": PA remembers it and asks "Bestellt?" afterwards. Nothing is ordered by PA. */
export function markHanded(l: ShopList, today: ISODate): ShopList {
  return touch(l, { handedOn: today });
}

/** User says it is ordered: history row, and a recurring list moves to its next date (a one-off list is done). */
export function markOrdered(l: ShopList, today: ISODate): { list: ShopList; run: ShopRun } {
  const run = stamp<Omit<ShopRun, 'id' | 'createdAt' | 'updatedAt'>>({ listId: l.id, platformId: l.platformId, date: today, items: l.items });
  if (l.everyN && l.everyUnit) {
    const base = l.nextDate && l.nextDate > today ? l.nextDate : today;
    const next = onWeekday(addInterval(base, l.everyN, l.everyUnit), l.weekday);
    return { list: touch(l, { lastOrdered: today, handedOn: null, nextDate: next }), run };
  }
  return { list: touch(l, { lastOrdered: today, handedOn: null, state: 'done' }), run };
}

/** "Diesmal auslassen": recurring basket skips one round. */
export function skip(l: ShopList, today: ISODate): ShopList {
  if (!l.everyN || !l.everyUnit) return touch(l, { state: 'done', handedOn: null });
  const base = l.nextDate && l.nextDate > today ? l.nextDate : today;
  return touch(l, { handedOn: null, nextDate: onWeekday(addInterval(base, l.everyN, l.everyUnit), l.weekday) });
}

export function setItems(l: ShopList, items: ShopItem[]): ShopList {
  return touch(l, { items: itemsToText(items) });
}

// ---- voice while the basket is open ----

export type BasketCommand =
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'skip' }
  | { type: 'ordered' }
  | { type: 'add'; items: ShopItem[] }
  | { type: 'remove'; names: string[] }
  | { type: 'read' };

/** Short spoken answers to the open basket: "ja", "noch Butter dazu", "ohne Eier", "diesmal nicht", "bestellt". */
export function parseBasketCommand(raw: string): BasketCommand | null {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^(bestellt|ist bestellt|hab(e)? (ich )?bestellt|erledigt)$/.test(t)) return { type: 'ordered' };
  if (/^(ja|jawohl|passt|ok(ay)?|genau|bestellen|öffnen|los|mach das|ja,? bitte|ja,? bestellen|abschicken)$/.test(t)) return { type: 'confirm' };
  if (/^(nein|abbrechen|stopp|halt|vergiss es)$/.test(t)) return { type: 'cancel' };
  if (/^(diesmal nicht|diese woche nicht|auslassen|überspringen|nicht diesmal)$/.test(t)) return { type: 'skip' };
  if (/^(vorlesen|was ist drin|lies (es |mir )?vor|nochmal)$/.test(t)) return { type: 'read' };
  const rm = t.match(/^(?:ohne|streich(?:e)?|lösch(?:e)?|nimm)\s+(.+?)(?:\s+(?:weg|raus))?$/) ?? t.match(/^(.+?)\s+(?:weg|raus|streichen)$/);
  if (rm) return { type: 'remove', names: splitItems(rm[1]).map((i) => i.name.toLowerCase()) };
  const add = t.match(/^(?:noch|plus|und|füg(?:e)?|nimm noch|dazu)\s+(.+?)(?:\s+(?:dazu|hinzu|rein))?$/) ?? t.match(/^(.+?)\s+(?:dazu|hinzu)$/);
  if (add) return { type: 'add', items: splitItems(add[1]) };
  return null;
}

/** Apply add/remove to the item text. Adding an item that is there already only updates its amount. */
export function applyCommand(items: string, cmd: BasketCommand): string {
  const list = textToItems(items);
  if (cmd.type === 'add') {
    for (const it of cmd.items) {
      const i = list.findIndex((x) => x.name.toLowerCase() === it.name.toLowerCase());
      if (i >= 0) list[i] = { ...list[i], qty: it.qty ?? list[i].qty, unit: it.unit ?? list[i].unit };
      else list.push(it);
    }
  }
  if (cmd.type === 'remove') {
    return itemsToText(list.filter((x) => !cmd.names.some((n) => x.name.toLowerCase().startsWith(n.replace(/n$/, '')))));
  }
  return itemsToText(list);
}

/** What PA says when the basket is ready. Short: name, platform, count, first items, one question. */
export function readBack(l: ShopList, p?: Platform): string {
  const items = textToItems(l.items);
  const where = p ? ` bei ${p.name}` : '';
  if (!items.length) return `${l.name}${where} ist noch leer. Was soll rein?`;
  const names = items.map(formatItem);
  const head = names.length <= 4 ? joinDe(names) : `${names.slice(0, 3).join(', ')} und ${names.length - 3} weitere`;
  const ask = p ? `Soll ich ${p.name} öffnen?` : 'Passt die Liste?';
  return `${l.name}${where}: ${items.length} ${items.length === 1 ? 'Artikel' : 'Artikel'}, ${head}. ${ask}`;
}

function joinDe(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} und ${xs[xs.length - 1]}`;
}

// ---- handing over to the platform ----

export interface HandoffPlan {
  /** Opened on confirm: saved store page, else the platform. Null: shop without delivery. */
  url: string | null;
  /** Item search links on platforms that have a search URL. */
  itemLinks: Array<{ item: string; url: string }>;
  /** Copied to the clipboard on confirm, to paste into the platform's note or search. */
  text: string;
  note?: string;
}

export function handoff(l: ShopList): HandoffPlan {
  const p = platform(l.platformId);
  const items = textToItems(l.items);
  return {
    url: l.storeUrl ?? p?.web ?? null,
    itemLinks: p?.search ? items.map((i) => ({ item: formatItem(i), url: p.search!(i.name) })) : [],
    text: `${l.name}\n${items.map((i) => `- ${formatItem(i)}`).join('\n')}`,
    note: p?.note,
  };
}

export const UNIT_LABEL: Record<Unit, [string, string]> = {
  day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'], month: ['Monat', 'Monate'], year: ['Jahr', 'Jahre'],
};

export function rhythmLabel(l: Pick<ShopList, 'everyN' | 'everyUnit' | 'weekday'>): string | null {
  if (!l.everyN || !l.everyUnit) return null;
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const every = l.everyN === 1 ? (l.everyUnit === 'week' ? 'jede Woche' : `jeden ${UNIT_LABEL[l.everyUnit][0]}`) : `alle ${l.everyN} ${UNIT_LABEL[l.everyUnit][1]}`;
  if (l.weekday === null) return every;
  return l.everyN === 1 && l.everyUnit === 'week' ? `jeden ${days[l.weekday]}` : `${every}, ${days[l.weekday]}`;
}

export { parseItem };
