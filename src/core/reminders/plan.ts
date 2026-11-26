// Proactive appointment reminders. For an appointment with a place PA works out when to leave (route time from the
// travel preference, plus buffer) and reminds before that; for one without a place it reminds a few minutes ahead.
// Pure: the platform layer fetches routes, shows notifications and remembers what was shown.
import type { Upcoming } from '../calendar/upcoming';
import { classifyLocation, navUrl } from '../travel/place';
import { modeFor, MODE_WITH, type Mode, type TravelPrefs } from '../travel/prefs';
import type { LatLng } from '../travel/estimate';

export interface Route {
  mode: Mode;
  /** Door to door. */
  minutes: number;
  /** Public transport: when to step out of the door to catch the connection (already includes the walk to the stop). */
  leaveAtMs?: number;
  /** "U1, 13A" or "über A23". */
  summary?: string;
  source: 'google' | 'estimate';
  /** Car times include current traffic. */
  traffic: boolean;
  computedAtMs: number;
  /** Which start the route was computed from (see pickOrigin). */
  originKey: string;
}

export type RouteState = Route | { error: 'no_origin' | 'not_found' | 'offline'; computedAtMs: number; originKey: string; mode: Mode };

export interface Origin {
  kind: 'prev' | 'here' | 'home';
  key: string;
  /** For the person: "von zu Hause", "vom Termin davor", "von hier". */
  label: string;
  address?: string;
  coords?: LatLng;
}

export interface Reminder {
  /** Stable per appointment and step, so a reminder is shown once even if the time moves. */
  id: string;
  atMs: number;
  title: string;
  body: string;
  /** One action: open navigation or join the call. */
  action?: { label: string; url: string };
  /** Short sentence for read-aloud. */
  say: string;
}

export interface EventPlan {
  ev: Upcoming;
  kind: 'plain' | 'online' | 'travel';
  mode: Mode;
  route?: Route;
  /** Route could not be worked out (why), so PA reminds an hour ahead instead. */
  routeError?: 'no_origin' | 'not_found' | 'offline';
  leaveAtMs?: number;
  action?: { label: string; url: string };
  reminders: Reminder[];
}

const MIN = 60000;
/** Without a route: remind this long before an appointment with a place. */
export const FALLBACK_LEAD_MIN = 60;

export const hhmm = (ms: number, tz?: string): string =>
  new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(ms));

/**
 * Where the trip starts: the place of an appointment that ends shortly before, else where the phone is (if known
 * recently), else home. Coordinates are rounded to ~100 m so small moves do not trigger a new route.
 */
export function pickOrigin(ev: Upcoming, all: Upcoming[], prefs: TravelPrefs, here?: { coords: LatLng; atMs: number }, nowMs = Date.now()): Origin | null {
  const prev = all.filter((o) => o.key !== ev.key && o.endMs <= ev.startMs && o.endMs >= ev.startMs - 3 * 3600000
    && classifyLocation(o.location).kind === 'place' && o.location !== ev.location).pop();
  if (prev) return { kind: 'prev', key: `prev:${prev.location}`, label: 'vom Termin davor', address: prev.location! };
  const freshHere = here && nowMs - here.atMs < 15 * MIN;
  if (here && (freshHere && ev.startMs - nowMs < 3 * 3600000 || !prefs.home.trim() && nowMs - here.atMs < 2 * 3600000)) {
    const c = { lat: Math.round(here.coords.lat * 1000) / 1000, lng: Math.round(here.coords.lng * 1000) / 1000 };
    return { kind: 'here', key: `here:${c.lat},${c.lng}`, label: 'von hier', coords: c };
  }
  if (prefs.home.trim()) return { kind: 'home', key: `home:${prefs.home.trim()}`, label: 'von zu Hause', address: prefs.home.trim() };
  return null;
}

/** Whether a (new) route should be asked for now. Car routes refresh more often near departure (traffic). */
export function needsRoute(ev: Upcoming, mode: Mode, origin: Origin | null, state: RouteState | undefined, nowMs: number): boolean {
  if (!origin || classifyLocation(ev.location).kind !== 'place') return false;
  if (nowMs >= ev.startMs || ev.startMs - nowMs > 18 * 3600000) return false;
  if (!state || state.mode !== mode || state.originKey !== origin.key) return true;
  const age = nowMs - state.computedAtMs;
  if ('error' in state) return age > (state.error === 'offline' ? 5 : 60) * MIN;
  const leave = state.leaveAtMs ?? ev.startMs - state.minutes * MIN;
  const toLeave = leave - nowMs;
  if (toLeave < -10 * MIN) return false;
  if (toLeave < 2 * 3600000) return age > (mode === 'car' ? 10 : 20) * MIN;
  return age > 3 * 3600000;
}

export function planEvent(ev: Upcoming, prefs: TravelPrefs, state: RouteState | undefined, nowMs: number, tz?: string): EventPlan {
  const mode = modeFor(prefs, ev);
  const place = classifyLocation(ev.location);
  const at = hhmm(ev.startMs, tz);

  if (place.kind !== 'place') {
    const action = place.url ? { label: 'Beitreten', url: place.url } : undefined;
    const lead = prefs.plainMin;
    return {
      ev, kind: place.kind === 'online' ? 'online' : 'plain', mode, action,
      reminders: [{
        id: `${ev.key}|plain`, atMs: ev.startMs - lead * MIN,
        title: `${ev.title} um ${at}`,
        body: `In ${lead} Minuten${ev.location ? ` · ${ev.location}` : ''}`,
        action, say: `In ${lead} Minuten: ${ev.title}.`,
      }],
    };
  }

  const nav = { label: 'Navigation', url: navUrl(ev.location!, mode, prefs.navApp) };
  const route = state && !('error' in state) && state.mode === mode ? state : undefined;
  if (!route) {
    return {
      ev, kind: 'travel', mode, action: nav, routeError: state && 'error' in state ? state.error : undefined,
      reminders: [{
        id: `${ev.key}|fallback`, atMs: ev.startMs - FALLBACK_LEAD_MIN * MIN,
        title: `${ev.title} um ${at}`, body: `In einer Stunde · ${ev.location}`, action: nav,
        say: `In einer Stunde: ${ev.title}.`,
      }],
    };
  }

  const leaveAtMs = Math.floor(((route.leaveAtMs ?? ev.startMs - route.minutes * MIN) - prefs.bufferMin * MIN) / MIN) * MIN;
  const how = `${route.minutes} min ${MODE_WITH[mode]}${route.summary ? ` (${route.summary})` : ''}${route.source === 'estimate' ? ', geschätzt' : ''}`;
  const reminders: Reminder[] = [];
  if (prefs.preMin > 0) {
    reminders.push({
      id: `${ev.key}|pre`, atMs: leaveAtMs - prefs.preMin * MIN,
      title: `Um ${hhmm(leaveAtMs, tz)} los: ${ev.title}`,
      body: `${at} · ${how}`, action: nav,
      say: `In ${prefs.preMin} Minuten musst du los zu ${ev.title}.`,
    });
  }
  const late = nowMs > leaveAtMs + 2 * MIN && nowMs < ev.startMs;
  const arrive = nowMs + route.minutes * MIN;
  reminders.push(late
    ? {
      id: `${ev.key}|leave`, atMs: leaveAtMs,
      title: `Spät dran: ${ev.title}`,
      body: `Jetzt los, an ca. ${hhmm(arrive, tz)}${arrive > ev.startMs ? ` (${Math.ceil((arrive - ev.startMs) / MIN)} min zu spät)` : ''} · ${how}`,
      action: nav, say: `Du bist spät dran für ${ev.title}. Jetzt los.`,
    }
    : {
      id: `${ev.key}|leave`, atMs: leaveAtMs,
      title: `Jetzt los: ${ev.title}`,
      body: `${at} · ${how} · ${ev.location}`,
      action: nav, say: `Jetzt los zu ${ev.title}, ${route.minutes} Minuten ${MODE_WITH[mode]}.`,
    });
  return { ev, kind: 'travel', mode, route, leaveAtMs, action: nav, reminders };
}

/**
 * Reminders to show now: due, not shown yet, not older than graceMin, appointment not begun. When several of one
 * appointment are due at once (phone was off), only the latest shows; all count as shown.
 */
export function dueReminders(plans: EventPlan[], shown: Set<string>, nowMs: number, graceMin = 20): { show: Reminder[]; mark: string[] } {
  const show: Reminder[] = [], mark: string[] = [];
  for (const p of plans) {
    if (nowMs >= p.ev.startMs) continue;
    const due = p.reminders.filter((r) => r.atMs <= nowMs && !shown.has(r.id));
    if (!due.length) continue;
    mark.push(...due.map((r) => r.id));
    const last = due[due.length - 1];
    if (nowMs - last.atMs <= graceMin * MIN || last.id.endsWith('|leave')) show.push(last);
  }
  return { show, mark };
}
