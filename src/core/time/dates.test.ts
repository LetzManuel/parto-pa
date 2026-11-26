import { describe, expect, it } from 'vitest';
import { addMonths, addWorkdays, easter, formatShort, holidaysAT, isWorkday, workdaysBetween } from './dates';

describe('dates', () => {
  it('computes Easter', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
  });
  it('knows Austrian holidays', () => {
    const h = holidaysAT(2026);
    expect(h.has('2026-10-26')).toBe(true); // Nationalfeiertag
    expect(h.has('2026-06-04')).toBe(true); // Fronleichnam
    expect(h.has('2026-12-08')).toBe(true);
    expect(isWorkday('2026-12-08')).toBe(false);
  });
  it('adds working days over weekends and holidays', () => {
    expect(addWorkdays('2026-11-20', 2)).toBe('2026-11-24'); // Fri → Tue
    expect(addWorkdays('2026-12-04', 2)).toBe('2026-12-09'); // Fri → Wed (8.12. holiday)
    expect(addWorkdays('2026-12-23', 2)).toBe('2026-12-28'); // 24. counts, 25.–27. off
    expect(workdaysBetween('2026-11-20', '2026-11-24')).toBe(2);
  });
  it('clamps month ends', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
  });
  it('formats relative days', () => {
    expect(formatShort('2026-11-23', '2026-11-22')).toBe('morgen');
    expect(formatShort('2026-11-27', '2026-11-22')).toBe('Fr., 27.11.');
  });
});
