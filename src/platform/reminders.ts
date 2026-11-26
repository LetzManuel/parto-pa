// Runs the reminders: every half minute it looks at the next appointments, asks for routes when needed and shows
// what is due. Called from the app context; the logic itself lives in src/core/reminders/plan.ts.
import type { Store } from '../core/db/store';
import { upcomingTimed } from '../core/calendar/upcoming';
import { dueReminders, needsRoute, pickOrigin, planEvent, type EventPlan } from '../core/reminders/plan';
import { getPrefs, modeFor } from '../core/travel/prefs';
import type { LatLng } from '../core/travel/estimate';
import { say, showReminder } from './notify';
import { cachedRoutes, fetchRoute, saveRoute } from './travel';

const SHOWN = 'remindersShown';
let here: { coords: LatLng; atMs: number } | undefined;
let busy = false;

/** Current plans from what is cached (no network): for the "Als Nächstes" card. */
export function plansNow(store: Store, nowMs = Date.now(), hours = 18): EventPlan[] {
  const prefs = getPrefs(store);
  const routes = cachedRoutes(store);
  return upcomingTimed(store, nowMs, hours).map((ev) => planEvent(ev, prefs, routes[ev.key], nowMs));
}

/** Position, only if the person already allowed it (PA never asks in the background). */
async function locate(): Promise<void> {
  if (!('geolocation' in navigator) || (here && Date.now() - here.atMs < 5 * 60000)) return;
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    if (st && st.state !== 'granted') return;
  } catch { return; }
  await new Promise<void>((done) => navigator.geolocation.getCurrentPosition(
    (p) => { here = { coords: { lat: p.coords.latitude, lng: p.coords.longitude }, atMs: Date.now() }; done(); },
    () => done(), { maximumAge: 5 * 60000, timeout: 10000 },
  ));
}

/** One round. Returns whether routes changed (so screens re-read). */
export async function tick(store: Store, nowMs = Date.now()): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const prefs = getPrefs(store);
    const around = upcomingTimed(store, nowMs, 18, { backMin: 240 });
    const next = around.filter((e) => e.startMs > nowMs);
    let changed = false;
    await locate();
    let asked = 0;
    for (const ev of next) {
      if (asked >= 3) break; // a few per round, the rest next time
      const mode = modeFor(prefs, ev);
      const origin = pickOrigin(ev, around, prefs, here, nowMs);
      const state = cachedRoutes(store)[ev.key];
      if (!origin) {
        if (!state || !('error' in state) || state.error !== 'no_origin') {
          if (ev.location) { saveRoute(store, ev.key, { error: 'no_origin', computedAtMs: nowMs, originKey: '', mode }); changed = true; }
        }
        continue;
      }
      if (!needsRoute(ev, mode, origin, state, nowMs)) continue;
      asked++;
      saveRoute(store, ev.key, await fetchRoute(store, origin, ev, mode, state));
      changed = true;
    }

    const routes = cachedRoutes(store);
    const plans = next.map((ev) => planEvent(ev, prefs, routes[ev.key], Date.now()));
    let shown: string[] = [];
    try { shown = JSON.parse(store.getMeta(SHOWN) ?? '[]'); } catch { /* start fresh */ }
    const { show, mark } = dueReminders(plans, new Set(shown), Date.now());
    if (mark.length) store.setMeta(SHOWN, JSON.stringify([...shown, ...mark].slice(-300)));
    for (const r of show) {
      await showReminder(r).catch(() => { /* notifications blocked: the card in Heute still shows it */ });
      if (prefs.speak) say(r.say);
    }
    return changed || show.length > 0;
  } finally {
    busy = false;
  }
}
