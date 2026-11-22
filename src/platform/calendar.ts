// Fetches subscribed calendars. Browsers may not read most calendar links directly (CORS), so the web app asks the
// cloud function ics-relay when signed in; without sign-in it tries the link directly (works for some hosts only).
import { applyFetch, listFeeds } from '../core/calendar/feeds';
import { normaliseIcsUrl } from '../core/calendar/ics';
import type { Store } from '../core/db/store';
import type { ISODate } from '../core/time/dates';
import { cloud, signedInEmail } from './cloud';

const RELAY_ERRORS: Record<string, string> = {
  url: 'Der Link wird nicht unterstützt (nur öffentliche https- oder webcal-Links).',
  no_ics: 'Unter dem Link liegt kein Kalender.',
  too_large: 'Der Kalender ist zu groß (über 5 MB).',
  sign_in: 'Bitte zuerst unter Ich › Konto anmelden.',
};

async function fetchIcs(url: string): Promise<{ text: string } | { error: string }> {
  const u = normaliseIcsUrl(url);
  const c = cloud();
  if (c && (await signedInEmail())) {
    const { data, error } = await c.functions.invoke('ics-relay', { body: { url: u } });
    if (!error && typeof data === 'string') return { text: data };
    let code = '';
    try { code = (await (error as { context?: Response })?.context?.json())?.error ?? ''; } catch { /* no body */ }
    return { error: RELAY_ERRORS[code] ?? `Kalender konnte nicht geladen werden${code ? ` (${code})` : ''}.` };
  }
  try {
    const res = await fetch(u, { headers: { Accept: 'text/calendar' } });
    if (!res.ok) return { error: `Kalender antwortet mit Fehler ${res.status}.` };
    return { text: await res.text() };
  } catch {
    return { error: 'Dieser Kalender lässt sich nur mit Anmeldung laden (Ich › Konto & Sync).' };
  }
}

/** Refreshes every feed (or the ones older than maxAgeMin). Returns whether anything was fetched. */
export async function refreshFeeds(store: Store, today: ISODate, maxAgeMin = 0): Promise<boolean> {
  const due = listFeeds(store).filter((f) => !f.fetchedAt || Date.now() - Date.parse(f.fetchedAt) >= maxAgeMin * 60_000);
  for (const f of due) applyFetch(store, f.id, await fetchIcs(f.url), today);
  return due.length > 0;
}
