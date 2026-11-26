import { describe, expect, it } from 'vitest';
import type { Upcoming } from '../calendar/upcoming';
import { DEFAULT_PREFS } from './prefs';
import { applyCommand, parseTravelCommand } from './voice';
import { estimateMinutes } from './estimate';
import { classifyLocation } from './place';

const TODAY = '2026-11-26';
const evs: Upcoming[] = [
  { key: 'k1', title: 'Zahnarzt Dr. Huber', date: TODAY, start: '14:30', end: null, startMs: 1, endMs: 2, location: 'Mariahilfer Straße 1' },
  { key: 'k2', title: 'Friseur', date: TODAY, start: '17:00', end: null, startMs: 3, endMs: 4, location: 'Neubaugasse 5' },
];
const cmd = (s: string) => parseTravelCommand(s, TODAY, evs);

describe('travel preferences by voice', () => {
  it('sets the usual mode', () => {
    expect(cmd('Ich fahre normalerweise mit den Öffis')?.patch).toEqual({ mode: 'transit' });
    expect(cmd('Ich bin meistens mit dem Auto unterwegs.')?.patch).toEqual({ mode: 'car' });
    expect(cmd('Ich gehe zu Fuß')?.patch).toEqual({ mode: 'walk' });
    expect(cmd('Ich fahre Rad')?.patch).toEqual({ mode: 'bike' });
  });

  it('sets a mode for one day', () => {
    expect(cmd('Heute bin ich mit dem Auto unterwegs')).toEqual({ patch: { dayModes: { '2026-11-26': 'car' } }, confirm: 'Heute plane ich alle Wege mit dem Auto.' });
    expect(cmd('Morgen fahre ich mit der U-Bahn')?.patch).toEqual({ dayModes: { '2026-11-27': 'transit' } });
  });

  it('sets a mode for one appointment', () => {
    expect(cmd('Zum Zahnarzt gehe ich zu Fuß')).toEqual({ patch: { eventModes: { k1: 'walk' } }, confirm: 'Zu „Zahnarzt Dr. Huber“ plane ich zu Fuß.' });
    expect(cmd('Ich fahre mit dem Auto zum Friseur')?.patch).toEqual({ eventModes: { k2: 'car' } });
  });

  it('sets home, buffer and heads-up', () => {
    expect(cmd('Ich wohne in der Praterstraße 10, 1020 Wien')?.patch).toEqual({ home: 'Praterstraße 10, 1020 Wien' });
    expect(cmd('Plane zehn Minuten Puffer ein')?.patch).toEqual({ bufferMin: 10 });
    expect(cmd('Erinnere mich 20 Minuten bevor ich losmuss')?.patch).toEqual({ preMin: 20 });
  });

  it('leaves other memos alone', () => {
    expect(cmd('Auto zum Service bringen')).toBeNull();
    expect(cmd('Erinner mich morgen an die Batterien')).toBeNull();
  });

  it('adds day choices to the existing ones', () => {
    const prefs = { ...DEFAULT_PREFS, dayModes: { '2026-11-27': 'bike' as const } };
    expect(applyCommand(prefs, cmd('Heute fahre ich mit dem Auto')!).dayModes).toEqual({ '2026-11-27': 'bike', '2026-11-26': 'car' });
  });
});

describe('places and estimates', () => {
  it('tells calls from places', () => {
    expect(classifyLocation('Microsoft Teams-Besprechung')).toEqual({ kind: 'online' });
    expect(classifyLocation('https://zoom.us/j/1')).toEqual({ kind: 'online', url: 'https://zoom.us/j/1' });
    expect(classifyLocation('Café Sperl, Gumpendorfer Str. 11')).toEqual({ kind: 'place' });
    expect(classifyLocation('')).toEqual({ kind: 'none' });
  });

  it('estimates Vienna trips in plausible ranges', () => {
    const stephansplatz = { lat: 48.2085, lng: 16.3731 }, schoenbrunn = { lat: 48.1849, lng: 16.3122 };
    expect(estimateMinutes(stephansplatz, schoenbrunn, 'transit')).toBeGreaterThanOrEqual(20);
    expect(estimateMinutes(stephansplatz, schoenbrunn, 'transit')).toBeLessThanOrEqual(35);
    expect(estimateMinutes(stephansplatz, schoenbrunn, 'walk')).toBeGreaterThanOrEqual(60);
    expect(estimateMinutes(stephansplatz, schoenbrunn, 'car')).toBeLessThanOrEqual(25);
  });
});
