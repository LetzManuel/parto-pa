// Which booking system a link belongs to. Research, Nov 2026 (Austria):
// - Salons mostly use Treatwell, Shore, Fresha, Planity, Timify, Booksy, Studiolution or Salonized. Only Salonized
//   serves free time slots from its public booking page; the others have no public slot API (partner access only).
// - Restaurants: resmio has an unauthenticated availability endpoint; OpenTable, TheFork and Quandoo need partner keys.
// - Tickets: Ticketmaster's Discovery API (free key) lists events and whether they are on sale; oeticket/Eventim
//   (the biggest seller in Austria) has no public API, so it is linked only.
// - Doctors: Doctolib, Latido and DocFinder show online booking but have no public API: PA links to them.
// - Babysitters are mostly private people: PA prepares a WhatsApp/SMS message or a call.
import type { FavKind, SystemId } from './model';

export interface SystemInfo {
  id: SystemId;
  label: string;
  /** PA can read free slots or events itself. */
  readable: boolean;
  kinds: FavKind[];
  /** Host suffixes that identify the system in a booking link. */
  hosts: string[];
}

export const SYSTEMS: SystemInfo[] = [
  { id: 'resmio', label: 'resmio', readable: true, kinds: ['restaurant'], hosts: ['resmio.com'] },
  { id: 'salonized', label: 'Salonized', readable: true, kinds: ['salon'], hosts: ['salonized.com'] },
  { id: 'ticketmaster', label: 'Ticketmaster', readable: true, kinds: ['tickets'], hosts: ['ticketmaster.at', 'ticketmaster.de', 'ticketmaster.com'] },
  { id: 'treatwell', label: 'Treatwell', readable: false, kinds: ['salon'], hosts: ['treatwell.at', 'treatwell.de', 'treatwell.com'] },
  { id: 'shore', label: 'Shore', readable: false, kinds: ['salon', 'doctor'], hosts: ['shore.com'] },
  { id: 'fresha', label: 'Fresha', readable: false, kinds: ['salon'], hosts: ['fresha.com'] },
  { id: 'planity', label: 'Planity', readable: false, kinds: ['salon'], hosts: ['planity.com'] },
  { id: 'timify', label: 'Timify', readable: false, kinds: ['salon', 'doctor'], hosts: ['timify.com'] },
  { id: 'booksy', label: 'Booksy', readable: false, kinds: ['salon'], hosts: ['booksy.com'] },
  { id: 'studiolution', label: 'Studiolution', readable: false, kinds: ['salon'], hosts: ['studiolution.com', 'studiolution.at'] },
  { id: 'opentable', label: 'OpenTable', readable: false, kinds: ['restaurant'], hosts: ['opentable.at', 'opentable.de', 'opentable.com'] },
  { id: 'thefork', label: 'TheFork', readable: false, kinds: ['restaurant'], hosts: ['thefork.at', 'thefork.de', 'thefork.com'] },
  { id: 'quandoo', label: 'Quandoo', readable: false, kinds: ['restaurant'], hosts: ['quandoo.at', 'quandoo.de', 'quandoo.com'] },
  { id: 'oeticket', label: 'oeticket', readable: false, kinds: ['tickets'], hosts: ['oeticket.com'] },
  { id: 'eventim', label: 'Eventim', readable: false, kinds: ['tickets'], hosts: ['eventim.at', 'eventim.de'] },
  { id: 'doctolib', label: 'Doctolib', readable: false, kinds: ['doctor'], hosts: ['doctolib.at', 'doctolib.de'] },
  { id: 'latido', label: 'Latido', readable: false, kinds: ['doctor'], hosts: ['latido.at'] },
  { id: 'docfinder', label: 'DocFinder', readable: false, kinds: ['doctor'], hosts: ['docfinder.at'] },
  { id: 'babysits', label: 'Babysits', readable: false, kinds: ['babysitter'], hosts: ['babysits.at', 'babysits.com'] },
  { id: 'betreut', label: 'Betreut.at', readable: false, kinds: ['babysitter'], hosts: ['betreut.at'] },
];

export function systemInfo(id: SystemId): SystemInfo | null {
  return SYSTEMS.find((s) => s.id === id) ?? null;
}

export function normalizeUrl(u: string | null | undefined): string | null {
  const t = (u ?? '').trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function host(u: string): string | null {
  try { return new URL(normalizeUrl(u)!).hostname.toLowerCase(); } catch { return null; }
}

/** The system behind a booking link, or null for an ordinary website. */
export function detectSystem(url: string | null | undefined): SystemInfo | null {
  const h = url ? host(url) : null;
  if (!h) return null;
  return SYSTEMS.find((s) => s.hosts.some((x) => h === x || h.endsWith('.' + x))) ?? null;
}

/**
 * The id PA needs to read a system, taken from the booking link where possible:
 * resmio "https://app.resmio.com/the-fish/…" or "the-fish.resmio.com" → "the-fish"; Salonized "salon-x.salonized.com" → "salon-x".
 */
export function refFromUrl(system: SystemId, url: string | null): string | null {
  const n = normalizeUrl(url);
  if (!n) return null;
  let u: URL;
  try { u = new URL(n); } catch { return null; }
  const h = u.hostname.toLowerCase();
  const sub = h.split('.')[0];
  const first = u.pathname.split('/').filter(Boolean)[0] ?? null;
  if (system === 'resmio') {
    if (h !== 'resmio.com' && !['app', 'www', 'api', 'widget'].includes(sub)) return sub;
    return first && !['t', 'v1'].includes(first) ? first : null;
  }
  if (system === 'salonized') return h !== 'salonized.com' && !['app', 'www'].includes(sub) ? sub : null;
  return null;
}

/** Links to known booking platforms on an ordinary website ("Online-Termin" button of a doctor or salon). */
export function findBookingLinks(html: string, base: string): Array<{ system: SystemInfo; url: string }> {
  const out: Array<{ system: SystemInfo; url: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let url: string;
    try { url = new URL(m[1], base).toString(); } catch { continue; }
    const s = detectSystem(url);
    if (s && !seen.has(s.id)) { seen.add(s.id); out.push({ system: s, url }); }
  }
  return out;
}
