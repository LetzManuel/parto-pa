import { describe, expect, it } from 'vitest';
import { complete, createOrder, markRequested, nextOccurrence, runFallback, suggestFrom } from './flow';

describe('order flow', () => {
  it('waits two working days after a request', () => {
    const o = markRequested(createOrder({ title: 'Termin bei Studio Nails', kind: 'reminder' }), '2026-11-20', 'Studio Nails');
    expect(o.state).toBe('waiting');
    expect(o.dueDate).toBe('2026-11-24');
    expect(o.waitingFor).toBe('Studio Nails');
  });

  it('starts the next round of a recurring order', () => {
    const o = createOrder({ title: 'Friseur', kind: 'recurring', everyN: 6, everyUnit: 'week', lastDone: '2026-10-01' });
    expect(nextOccurrence(o)).toBe('2026-11-12');
    expect(suggestFrom(o)).toBe('2026-10-29');
    const d = complete(o, '2026-11-22');
    expect(d.state).toBe('open');
    expect(d.lastDone).toBe('2026-11-22');
    expect(d.dueDate).toBe('2026-12-20'); // 3.1.2027 minus 14 days
  });

  it('closes a one-off order', () => {
    expect(complete(createOrder({ title: 'Batterien', kind: 'location' }), '2026-11-22').state).toBe('done');
  });

  it('moves a birthday to next year', () => {
    const b = createOrder({ title: 'Geburtstag Anna', kind: 'birthday', dueDate: '2027-03-03' });
    expect(complete(b, '2027-03-03').dueDate).toBe('2028-03-03');
  });

  it('switches a conditional order to plan B', () => {
    const o = createOrder({ title: 'Rückruf Installateur', kind: 'conditional', waitingFor: 'der Installateur', fallback: 'einen anderen suchen', dueDate: '2026-11-27' });
    expect(o.state).toBe('waiting');
    const b = runFallback(o, '2026-11-28');
    expect(b.title).toBe('Einen anderen suchen');
    expect(b.state).toBe('open');
    expect(b.note).toContain('der Installateur');
  });
});
