// Subscribed calendars. The links stay on this device (they are secret like a password), and so does the
// imported copy: only PA's own events sync. The imported events count as busy for free windows and show in
// Heute and Kalender, read-only.
import type { Store } from '../db/store';
import { stamp, type CalEvent } from '../model';
import { addDays, type ISODate } from '../time/dates';
import { parseIcs, type ImportedEvent } from './ics';

export interface Feed {
  id: string;
  label: string;
  url: string;
  fetchedAt: string | null;
  error: string | null;
  count: number;
}

const FEEDS = 'calendarFeeds';
const cacheKey = (id: string) => `feed:${id}`;
/** How far imported calendars are read: a day back, two months ahead. */
export const IMPORT_DAYS = { back: 1, ahead: 60 };

export function listFeeds(store: Store): Feed[] {
  try { return JSON.parse(store.getMeta(FEEDS) ?? '[]') as Feed[]; } catch { return []; }
}

function saveFeeds(store: Store, feeds: Feed[]): void {
  store.setMeta(FEEDS, JSON.stringify(feeds));
}

export function addFeed(store: Store, label: string, url: string): Feed {
  const f: Feed = { id: crypto.randomUUID(), label: label.trim() || 'Kalender', url: url.trim(), fetchedAt: null, error: null, count: 0 };
  saveFeeds(store, [...listFeeds(store), f]);
  return f;
}

export function removeFeed(store: Store, id: string): void {
  saveFeeds(store, listFeeds(store).filter((f) => f.id !== id));
  store.setMeta(cacheKey(id), '[]');
}

/** Stores the result of one fetch (text or error) for a feed. */
export function applyFetch(store: Store, id: string, result: { text: string } | { error: string }, today: ISODate): void {
  const feeds = listFeeds(store);
  const f = feeds.find((x) => x.id === id);
  if (!f) return;
  if ('error' in result) {
    f.error = result.error;
  } else {
    try {
      const events = parseIcs(result.text, addDays(today, -IMPORT_DAYS.back), addDays(today, IMPORT_DAYS.ahead));
      store.setMeta(cacheKey(id), JSON.stringify(events));
      f.count = events.length;
      f.error = null;
    } catch {
      f.error = 'Die Datei ist kein lesbarer Kalender.';
    }
  }
  f.fetchedAt = new Date().toISOString();
  saveFeeds(store, feeds);
}

export interface FeedEvent extends ImportedEvent { feed: string }

export function importedEvents(store: Store): FeedEvent[] {
  return listFeeds(store).flatMap((f) => {
    try {
      return (JSON.parse(store.getMeta(cacheKey(f.id)) ?? '[]') as ImportedEvent[]).map((e) => ({ ...e, feed: f.label }));
    } catch { return []; }
  });
}

/**
 * Own events plus imported ones, one entry per day (multi-day events repeat on each day, as all-day on the days
 * in between). Imported "free" events are left out when busyOnly is set.
 */
export function allEvents(store: Store, opts: { busyOnly?: boolean } = {}): Array<CalEvent & { feed?: string }> {
  const own = store.list('event');
  const out: Array<CalEvent & { feed?: string }> = [...own];
  for (const e of importedEvents(store)) {
    if (opts.busyOnly && !e.busy) continue;
    for (let d = e.date; d <= e.endDate; d = addDays(d, 1)) {
      const first = d === e.date, last = d === e.endDate;
      const timed = e.start !== null;
      out.push({
        ...stamp({
          title: e.title, date: d,
          start: timed && first ? e.start : timed && !first ? '00:00' : null,
          end: timed && last ? e.end : timed && !last ? '23:59' : null,
          tentative: false, orderId: null,
        }, new Date(0)),
        id: `${e.key}|${d}`,
        feed: e.feed,
      });
    }
  }
  return out;
}
