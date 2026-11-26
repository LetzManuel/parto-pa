import { describe, expect, it } from 'vitest';
import { stamp, type CalEvent } from '../model';
import { describeWindows, freeWindows } from './free';
import { requestSentence } from '../providers/contact';

const ev = (date: string, start: string | null, end: string | null) =>
  stamp<Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'>>({ title: 'x', date, start, end, tentative: false, orderId: null });

describe('free windows', () => {
  it('finds evening windows around appointments', () => {
    const events = [ev('2026-11-23', '17:30', '18:30'), ev('2026-11-24', null, null)];
    const w = freeWindows(events, { from: '2026-11-23', days: 3, dayStart: '17:00', dayEnd: '20:00', minMinutes: 60 });
    expect(w).toEqual([
      { date: '2026-11-23', from: '18:30', to: '20:00' },
      { date: '2026-11-25', from: '17:00', to: '20:00' },
    ]);
    expect(describeWindows(w, '2026-11-22')).toBe('morgen 18:30–20:00, Mi., 25.11. 17:00–20:00');
  });
  it('writes the cheat-sheet sentence', () => {
    const p = { service: 'Maniküre Gel' } as Parameters<typeof requestSentence>[0];
    expect(requestSentence(p, 'Di. ab 17 Uhr')).toBe('Ich hätte gern einen Termin für Maniküre Gel, am liebsten Di. ab 17 Uhr.');
  });
});
