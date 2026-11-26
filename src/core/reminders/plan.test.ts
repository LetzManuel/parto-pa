import { describe, expect, it } from 'vitest';
import type { Upcoming } from '../calendar/upcoming';
import { DEFAULT_PREFS, type TravelPrefs } from '../travel/prefs';
import { dueReminders, needsRoute, pickOrigin, planEvent, type Route } from './plan';

const TZ = 'Europe/Vienna';
const T = (h: number, m = 0) => Date.UTC(2026, 10, 26, h - 1, m); // Vienna = UTC+1 in November
const ev = (o: Partial<Upcoming> = {}): Upcoming => ({
  key: 'z', title: 'Zahnarzt', date: '2026-11-26', start: '14:30', end: '15:30',
  startMs: T(14, 30), endMs: T(15, 30), location: 'Mariahilfer Straße 1, 1060 Wien', ...o,
});
const prefs = (p: Partial<TravelPrefs> = {}): TravelPrefs => ({ ...DEFAULT_PREFS, home: 'Praterstraße 10, 1020 Wien', ...p });
const route = (p: Partial<Route> = {}): Route => ({ mode: 'transit', minutes: 25, source: 'google', traffic: false, computedAtMs: T(10), originKey: 'home:x', ...p });

describe('leave-by reminders', () => {
  it('works out when to leave from route time and buffer, with a heads-up before', () => {
    const p = planEvent(ev(), prefs(), route(), T(10), TZ);
    expect(p.kind).toBe('travel');
    expect(p.leaveAtMs).toBe(T(14, 0)); // 14:30 − 25 min − 5 min buffer
    expect(p.reminders.map((r) => [r.id, r.atMs, r.title])).toEqual([
      ['z|pre', T(13, 50), 'Um 14:00 los: Zahnarzt'],
      ['z|leave', T(14, 0), 'Jetzt los: Zahnarzt'],
    ]);
    expect(p.reminders[1].body).toBe('14:30 · 25 min mit den Öffis · Mariahilfer Straße 1, 1060 Wien');
    expect(p.action?.url).toBe('https://www.google.com/maps/dir/?api=1&destination=Mariahilfer%20Stra%C3%9Fe%201%2C%201060%20Wien&travelmode=transit');
  });

  it('uses the departure of the connection for public transport', () => {
    const p = planEvent(ev(), prefs({ bufferMin: 0 }), route({ leaveAtMs: T(13, 52), summary: 'U3' }), T(10), TZ);
    expect(p.leaveAtMs).toBe(T(13, 52));
    expect(p.reminders[1].body).toContain('25 min mit den Öffis (U3)');
  });

  it('follows the mode chosen for the day or the appointment', () => {
    const day = prefs({ dayModes: { '2026-11-26': 'car' } });
    expect(planEvent(ev(), day, route({ mode: 'car' }), T(10), TZ).mode).toBe('car');
    expect(planEvent(ev(), { ...day, eventModes: { z: 'walk' } }, undefined, T(10), TZ).mode).toBe('walk');
    // A route for another mode does not count.
    expect(planEvent(ev(), day, route({ mode: 'transit' }), T(10), TZ).route).toBeUndefined();
  });

  it('says so when it is late', () => {
    const p = planEvent(ev(), prefs(), route(), T(14, 10), TZ);
    expect(p.reminders[1].title).toBe('Spät dran: Zahnarzt');
    expect(p.reminders[1].body).toMatch(/^Jetzt los, an ca\. 14:35 \(5 min zu spät\)/);
  });

  it('reminds an hour ahead while the route is unknown, and before appointments without a place', () => {
    const p = planEvent(ev(), prefs(), { error: 'not_found', computedAtMs: T(10), originKey: 'home:x', mode: 'transit' }, T(10), TZ);
    expect(p.routeError).toBe('not_found');
    expect(p.reminders.map((r) => [r.id, r.atMs])).toEqual([['z|fallback', T(13, 30)]]);

    const call = planEvent(ev({ location: 'https://teams.microsoft.com/l/meetup/123' }), prefs(), undefined, T(10), TZ);
    expect(call.kind).toBe('online');
    expect(call.reminders[0]).toMatchObject({ atMs: T(14, 15), action: { label: 'Beitreten' } });
    expect(planEvent(ev({ location: null }), prefs(), undefined, T(10), TZ).kind).toBe('plain');
  });

  it('shows each reminder once, only the latest when several are due', () => {
    const plans = [planEvent(ev(), prefs(), route(), T(13, 55), TZ)];
    const shown = new Set<string>();
    const r1 = dueReminders(plans, shown, T(13, 55));
    expect(r1.show.map((r) => r.id)).toEqual(['z|pre']);
    r1.mark.forEach((id) => shown.add(id));
    expect(dueReminders(plans, shown, T(13, 58)).show).toEqual([]);
    expect(dueReminders(plans, shown, T(14, 0)).show.map((r) => r.id)).toEqual(['z|leave']);
    // Phone was off: both due, only "Jetzt los" shows.
    expect(dueReminders(plans, new Set(), T(14, 1)).show.map((r) => r.id)).toEqual(['z|leave']);
    // After the start nothing more.
    expect(dueReminders(plans, new Set(), T(14, 31)).show).toEqual([]);
  });
});

describe('route start and refresh', () => {
  it('starts at the appointment before, else here when fresh, else home', () => {
    const before = ev({ key: 'b', title: 'Meeting', start: '12:00', startMs: T(12), endMs: T(13, 30), location: 'Opernring 2, Wien' });
    const here = { coords: { lat: 48.20849, lng: 16.37208 }, atMs: T(13) };
    expect(pickOrigin(ev(), [before, ev()], prefs(), here, T(13))).toMatchObject({ kind: 'prev', address: 'Opernring 2, Wien' });
    expect(pickOrigin(ev(), [ev()], prefs(), here, T(13, 5))).toMatchObject({ kind: 'here', key: 'here:48.208,16.372' });
    expect(pickOrigin(ev(), [ev()], prefs(), here, T(13, 30))).toMatchObject({ kind: 'home' });
    expect(pickOrigin(ev(), [ev()], prefs({ home: '' }), undefined, T(13))).toBeNull();
  });

  it('asks for routes when needed and refreshes car routes more often near departure', () => {
    const o = { kind: 'home' as const, key: 'home:x', label: 'von zu Hause' };
    expect(needsRoute(ev(), 'transit', o, undefined, T(10))).toBe(true);
    expect(needsRoute(ev({ startMs: T(14) + 20 * 3600000 }), 'transit', o, undefined, T(10))).toBe(false);
    expect(needsRoute(ev(), 'transit', o, route(), T(11))).toBe(false);
    expect(needsRoute(ev(), 'car', o, route(), T(11))).toBe(true); // other mode
    expect(needsRoute(ev(), 'transit', { ...o, key: 'here:1,2' }, route(), T(11))).toBe(true); // other start
    expect(needsRoute(ev(), 'transit', o, route({ computedAtMs: T(13, 30) }), T(13, 45))).toBe(false);
    expect(needsRoute(ev(), 'car', o, route({ mode: 'car', computedAtMs: T(13, 30) }), T(13, 45))).toBe(true);
    expect(needsRoute(ev({ location: 'Zoom' }), 'transit', o, undefined, T(10))).toBe(false);
  });
});
