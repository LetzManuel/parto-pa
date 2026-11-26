import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { Store } from '../db/store';
import { stamp } from '../model';
import { addFeed, applyFetch } from './feeds';
import { atLocal, upcomingTimed } from './upcoming';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:z
SUMMARY:Zahnarzt
LOCATION:Mariahilfer Straße 1\\, 1060 Wien
DTSTART;TZID=Europe/Vienna:20261126T143000
DTEND;TZID=Europe/Vienna:20261126T153000
END:VEVENT
BEGIN:VEVENT
UID:f
SUMMARY:Blocker
DTSTART;TZID=Europe/Vienna:20261126T120000
DTEND;TZID=Europe/Vienna:20261126T130000
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:a
SUMMARY:Urlaub
DTSTART;VALUE=DATE:20261126
DTEND;VALUE=DATE:20261127
END:VEVENT
END:VCALENDAR`;

describe('upcoming timed appointments', () => {
  it('reads own and imported events with place and absolute start, skipping all-day and free ones', async () => {
    const SQL = await initSqlJs();
    const store = new Store(new SQL.Database(), 'space', () => {});
    const f = addFeed(store, 'Privat', 'https://example.com/a.ics');
    applyFetch(store, f.id, { text: ICS }, '2026-11-26');
    store.save('event', stamp({ title: 'Friseur', date: '2026-11-26', start: '17:00', end: '17:45', tentative: false, orderId: null, location: 'Neubaugasse 5' }));
    store.save('event', stamp({ title: 'Morgen', date: '2026-11-28', start: '09:00', end: null, tentative: false, orderId: null }));

    const now = atLocal('2026-11-26', '10:00', 'Europe/Vienna');
    const list = upcomingTimed(store, now, 24, { tz: 'Europe/Vienna' });
    expect(list.map((u) => [u.title, u.start, u.location, u.feed])).toEqual([
      ['Zahnarzt', '14:30', 'Mariahilfer Straße 1, 1060 Wien', 'Privat'],
      ['Friseur', '17:00', 'Neubaugasse 5', undefined],
    ]);
    expect(new Date(list[0].startMs).toISOString()).toBe('2026-11-26T13:30:00.000Z');
  });

  it('handles the DST change', () => {
    expect(new Date(atLocal('2026-03-29', '10:00', 'Europe/Vienna')).toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(new Date(atLocal('2026-10-25', '10:00', 'Europe/Vienna')).toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });
});
