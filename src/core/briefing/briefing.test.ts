import { describe, expect, it } from 'vitest';
import { createOrder } from '../orders/flow';
import { createDeadline } from '../deadlines/deadlines';
import { createMemory } from '../memory/memory';
import { activeHints, buildBriefing } from './briefing';

const T = '2026-11-22';
const base = { providers: [], memory: [], events: [] };

describe('briefing', () => {
  it('asks about a conditional order whose deadline passed', () => {
    const o = createOrder({ title: 'Antwort Installateur', kind: 'conditional', waitingFor: 'der Installateur', fallback: 'Suche einen anderen', dueDate: '2026-11-20' });
    const b = buildBriefing({ ...base, orders: [o], deadlines: [] }, T);
    expect(b.decisions[0].text).toBe('Der Installateur hat sich bis Fr., 20.11. nicht gemeldet. Plan B: Suche einen anderen?');
    expect(b.decisions[0].actions.map((a) => a.id)).toEqual(['fallback', 'wait', 'done']);
  });

  it('keeps future waits in "PA erledigt"', () => {
    const o = createOrder({ title: 'Antwort Installateur', kind: 'conditional', waitingFor: 'der Installateur', fallback: 'Suche einen anderen', dueDate: '2026-11-27' });
    const b = buildBriefing({ ...base, orders: [o], deadlines: [] }, T);
    expect(b.decisions).toHaveLength(0);
    expect(b.paHandles[0]).toBe('Antwort Installateur: wartet bis Fr., 27.11., dann Plan B: Suche einen anderen');
  });

  it('suggests the next recurring appointment', () => {
    const o = createOrder({ title: 'Friseur', kind: 'recurring', everyN: 6, everyUnit: 'week', lastDone: '2026-10-08' });
    const b = buildBriefing({ ...base, orders: [o], deadlines: [] }, T);
    expect(b.decisions[0].text).toBe('Friseur ist 6 Wochen her. Termin ausmachen?');
  });

  it('shows a birthday with what PA knows', () => {
    const o = createOrder({ title: 'Geburtstag Anna', kind: 'birthday', dueDate: '2026-11-25' });
    const b = buildBriefing({ ...base, memory: [createMemory('Anna mag Orchideen', 'x')], orders: [o], deadlines: [] }, T);
    expect(b.decisions[0].text).toBe('Mi., 25.11. · Gedächtnis: Anna mag Orchideen');
  });

  it('ranks an expired deadline first and caps active hints at three', () => {
    const orders = ['A', 'B', 'C'].map((t) => createOrder({ title: t, kind: 'reminder', dueDate: T }));
    const pickerl = createDeadline({ kind: 'pickerl', dueDate: '2026-11-15' });
    const pass = createDeadline({ kind: 'passport', dueDate: '2027-12-01' });
    const b = buildBriefing({ ...base, orders, deadlines: [pickerl, pass] }, T);
    expect(b.decisions[0].title).toBe('§57a-Pickerl');
    expect(b.decisions).toHaveLength(4);
    expect(activeHints(b)).toHaveLength(3);
    expect(activeHints(b, 2)).toHaveLength(1);
  });
});
