import { describe, expect, it } from 'vitest';
import { parseIcs } from './ics';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:test
BEGIN:VTIMEZONE
TZID:Europe/Vienna
BEGIN:STANDARD
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:team
SUMMARY:Team-Meeting
DTSTART;TZID=Europe/Vienna:20261123T093000
DTEND;TZID=Europe/Vienna:20261123T103000
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:team
RECURRENCE-ID;TZID=Europe/Vienna:20261130T093000
SUMMARY:Team-Meeting (verschoben)
DTSTART;TZID=Europe/Vienna:20261130T140000
DTEND;TZID=Europe/Vienna:20261130T150000
END:VEVENT
BEGIN:VEVENT
UID:utc
SUMMARY:Call London
DTSTART:20261124T170000Z
DTEND:20261124T180000Z
END:VEVENT
BEGIN:VEVENT
UID:holiday
SUMMARY:Urlaub
DTSTART;VALUE=DATE:20261126
DTEND;VALUE=DATE:20261128
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:gone
SUMMARY:Abgesagt: Zahnarzt
DTSTART;TZID=Europe/Vienna:20261125T080000
DTEND;TZID=Europe/Vienna:20261125T090000
END:VEVENT
END:VCALENDAR`;

describe('ICS import', () => {
  it('expands series, respects changed and cancelled occurrences and zones', () => {
    const ev = parseIcs(ICS, '2026-11-22', '2026-12-10', 'Europe/Vienna');
    expect(ev.map((e) => [e.date, e.start, e.end, e.title, e.busy])).toEqual([
      ['2026-11-23', '09:30', '10:30', 'Team-Meeting', true],
      ['2026-11-24', '18:00', '19:00', 'Call London', true],
      ['2026-11-26', null, null, 'Urlaub', false],
      ['2026-11-30', '14:00', '15:00', 'Team-Meeting (verschoben)', true],
      ['2026-12-07', '09:30', '10:30', 'Team-Meeting', true],
    ]);
    expect(ev[2].endDate).toBe('2026-11-27');
  });

  it('keeps to the window', () => {
    expect(parseIcs(ICS, '2026-12-01', '2026-12-03', 'Europe/Vienna')).toEqual([]);
  });
});
