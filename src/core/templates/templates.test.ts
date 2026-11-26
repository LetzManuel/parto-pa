import { describe, expect, it } from 'vitest';
import { suggest } from './templates';
import { findWhen } from './when';

const REF = '2026-11-22'; // Sunday

describe('date phrases', () => {
  it.each([
    ['in drei Wochen', '2026-12-13'],
    ['in 3 Tagen', '2026-11-25'],
    ['in einem Monat', '2026-12-22'],
    ['morgen', '2026-11-23'],
    ['übermorgen', '2026-11-24'],
    ['bis Freitag', '2026-11-27'],
    ['nächste Woche', '2026-11-23'],
    ['am 3. März', '2027-03-03'],
    ['am 24.12.', '2026-12-24'],
    ['am 1.2.2027', '2027-02-01'],
  ])('%s', (text, date) => {
    expect(findWhen(text, REF)?.date).toBe(date);
  });
  it('returns null without a date', () => {
    expect(findWhen('Batterien kaufen', REF)).toBeNull();
  });
});

describe('template suggestions (concept examples)', () => {
  it('location reminder', () => {
    const [s] = suggest('Erinner mich, wenn ich beim Billa bin, an Batterien', REF);
    expect(s).toMatchObject({ template: 'location', title: 'Batterien', place: 'Billa' });
  });

  it('follow-up with date', () => {
    const [s] = suggest('In drei Wochen nachfragen, ob die Versicherung gezahlt hat', REF);
    expect(s).toMatchObject({ template: 'followup', title: 'Nachfragen: die Versicherung gezahlt hat', dueDate: '2026-12-13' });
  });

  it('conditional with plan B', () => {
    const [s] = suggest('Wenn der Installateur bis Freitag nicht zurückruft, such einen anderen', REF);
    expect(s).toMatchObject({ template: 'conditional', title: 'Antwort: Installateur', waitingFor: 'der Installateur', fallback: 'Suche einen anderen', dueDate: '2026-11-27' });
  });

  it('birthday with a memory suggestion', () => {
    const [s] = suggest('Anna hat am 3. März Geburtstag, sie mag Orchideen', REF);
    expect(s).toMatchObject({ template: 'birthday', person: 'Anna', dueDate: '2027-03-03', memory: 'Anna mag Orchideen' });
  });

  it('recurring', () => {
    const [s] = suggest('Alle 6 Wochen Friseur', REF);
    expect(s).toMatchObject({ template: 'recurring', title: 'Friseur', everyN: 6, everyUnit: 'week' });
    const [t] = suggest('Pickerl jährlich', REF);
    expect(t).toMatchObject({ template: 'recurring', title: 'Pickerl', everyN: 1, everyUnit: 'year' });
  });

  it('plain reminder', () => {
    const [s] = suggest('Erinner mich in zwei Wochen an die Steuererklärung', REF);
    expect(s).toMatchObject({ template: 'remind', title: 'Die Steuererklärung', dueDate: '2026-12-06' });
    const [t] = suggest('Morgen Paket abholen', REF);
    expect(t).toMatchObject({ template: 'remind', title: 'Paket abholen', dueDate: '2026-11-23' });
  });

  it('nothing recognised', () => {
    expect(suggest('Gedanken zum Urlaub', REF)).toEqual([]);
  });
});
