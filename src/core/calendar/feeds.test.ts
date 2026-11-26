import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { Store } from '../db/store';
import { addFeed, allEvents, applyFetch, listFeeds, removeFeed } from './feeds';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
SUMMARY:Messe
DTSTART;VALUE=DATE:20261124
DTEND;VALUE=DATE:20261126
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Nachtflug
DTSTART:20261127T220000
DTEND:20261128T060000
END:VEVENT
BEGIN:VEVENT
UID:c
SUMMARY:Vielleicht
DTSTART:20261129T100000
DTEND:20261129T110000
TRANSP:TRANSPARENT
END:VEVENT
END:VCALENDAR`;

describe('calendar feeds', () => {
  it('caches a fetch, splits multi-day events per day and keeps free ones out of busy', async () => {
    const SQL = await initSqlJs();
    const store = new Store(new SQL.Database(), 'space', () => {});
    const f = addFeed(store, 'Arbeit', 'webcal://example.com/cal.ics');
    applyFetch(store, f.id, { text: ICS }, '2026-11-22');
    expect(listFeeds(store)[0]).toMatchObject({ count: 3, error: null });
    const all = allEvents(store).map((e) => [e.date, e.start, e.end, e.title, e.feed]);
    expect(all).toEqual([
      ['2026-11-24', null, null, 'Messe', 'Arbeit'],
      ['2026-11-25', null, null, 'Messe', 'Arbeit'],
      ['2026-11-27', '22:00', '23:59', 'Nachtflug', 'Arbeit'],
      ['2026-11-28', '00:00', '06:00', 'Nachtflug', 'Arbeit'],
      ['2026-11-29', '10:00', '11:00', 'Vielleicht', 'Arbeit'],
    ]);
    expect(allEvents(store, { busyOnly: true }).some((e) => e.title === 'Vielleicht')).toBe(false);

    applyFetch(store, f.id, { error: 'weg' }, '2026-11-22');
    expect(listFeeds(store)[0].error).toBe('weg');
    expect(allEvents(store)).toHaveLength(5); // last good copy stays
    removeFeed(store, f.id);
    expect(allEvents(store)).toEqual([]);
  });
});
