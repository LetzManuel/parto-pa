// Route times for leave-by reminders. Signed in: the cloud function travel-time (Google Routes: live traffic,
// Wiener Linien, ÖBB). Without sign-in or without the Google key: places from OpenStreetMap (Nominatim) and an
// estimate from the distance. Found places are cached on this device.
import type { Store } from '../core/db/store';
import type { Upcoming } from '../core/calendar/upcoming';
import { estimateMinutes, type LatLng } from '../core/travel/estimate';
import type { Mode } from '../core/travel/prefs';
import type { Origin, RouteState } from '../core/reminders/plan';
import { cloud, signedInEmail } from './cloud';

const ROUTES = 'travelRoutes';

export function cachedRoutes(store: Store): Record<string, RouteState> {
  try { return JSON.parse(store.getMeta(ROUTES) ?? '{}') as Record<string, RouteState>; } catch { return {}; }
}

export function saveRoute(store: Store, key: string, r: RouteState): void {
  const all = cachedRoutes(store);
  all[key] = r;
  const dayAgo = Date.now() - 86400000;
  for (const [k, v] of Object.entries(all)) if (v.computedAtMs < dayAgo) delete all[k];
  store.setMeta(ROUTES, JSON.stringify(all));
}

/** Address → coordinates via OpenStreetMap, cached for 30 days. null = not found. */
async function geocode(store: Store, address: string): Promise<LatLng | null> {
  const k = `geo:${address.toLowerCase()}`;
  try {
    const hit = JSON.parse(store.getMeta(k) ?? 'null') as { at: number; p: LatLng | null } | null;
    if (hit && Date.now() - hit.at < 30 * 86400000) return hit.p;
  } catch { /* refetch */ }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=de&q=${encodeURIComponent(address)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const [first] = (await res.json()) as Array<{ lat: string; lon: string }>;
  const p = first ? { lat: Number(first.lat), lng: Number(first.lon) } : null;
  store.setMeta(k, JSON.stringify({ at: Date.now(), p }));
  return p;
}

async function viaCloud(origin: Origin, ev: Upcoming, mode: Mode, departAtMs: number): Promise<RouteState | 'fallback'> {
  const c = cloud();
  if (!c || !(await signedInEmail())) return 'fallback';
  const { data, error } = await c.functions.invoke('travel-time', {
    body: {
      origin: origin.coords ?? { address: origin.address }, destination: ev.location, mode,
      arriveBy: new Date(ev.startMs).toISOString(), departAt: new Date(departAtMs).toISOString(),
    },
  });
  const base = { computedAtMs: Date.now(), originKey: origin.key, mode };
  if (!error && data && typeof data.minutes === 'number') {
    return { ...base, minutes: data.minutes, leaveAtMs: data.leaveAt ? Date.parse(data.leaveAt) : undefined, summary: data.summary, traffic: !!data.traffic, source: 'google' };
  }
  let code = '';
  try { code = (await (error as { context?: Response })?.context?.json())?.error ?? ''; } catch { /* no body */ }
  if (code === 'not_found') return { ...base, error: 'not_found' };
  return 'fallback'; // no key yet, Google unreachable: estimate instead
}

async function estimate(store: Store, origin: Origin, ev: Upcoming, mode: Mode): Promise<RouteState> {
  const base = { computedAtMs: Date.now(), originKey: origin.key, mode };
  const from = origin.coords ?? (origin.address ? await geocode(store, origin.address) : null);
  const to = await geocode(store, ev.location!);
  if (!from || !to) return { ...base, error: 'not_found' };
  return { ...base, minutes: estimateMinutes(from, to, mode), source: 'estimate', traffic: false };
}

export async function fetchRoute(store: Store, origin: Origin, ev: Upcoming, mode: Mode, previous?: RouteState): Promise<RouteState> {
  const guess = previous && 'minutes' in previous ? previous.minutes : 30;
  try {
    const r = await viaCloud(origin, ev, mode, ev.startMs - guess * 60000);
    return r === 'fallback' ? await estimate(store, origin, ev, mode) : r;
  } catch {
    try { return await estimate(store, origin, ev, mode); } catch {
      return { computedAtMs: Date.now(), originKey: origin.key, mode, error: 'offline' };
    }
  }
}
