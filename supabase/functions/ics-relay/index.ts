// ICS relay for the web version: browsers may not read published calendar links of other sites (CORS),
// so the web app asks this function to fetch the .ics file. Only signed-in users of Parto PA may use it (copied from Parto Projects),
// only public https links are fetched (also checked after resolving the name, on every redirect), and only calendar
// files are passed on (max. 5 MB).
import { internalIp } from '../_shared/ip.ts';

const ORIGINS = ['https://pa.parto.at', 'https://test-pa.parto.at',
  'http://localhost:5173', 'http://localhost:5199'];
const MAX = 5 * 1024 * 1024;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Public https host only: no IP addresses of private networks, no localhost, no internal names, default port. */
function allowed(u: URL): boolean {
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return false; // IP literals are not needed for calendar links
  return true;
}

/**
 * Refuses a public name that points to an internal address. Only a found internal address refuses: where the runtime
 * cannot resolve names, the checks of allowed() still apply and the fetch itself fails for unknown names.
 */
async function pointsInside(host: string): Promise<boolean> {
  if (typeof Deno.resolveDns !== 'function') return false;
  for (const type of ['A', 'AAAA'] as const) {
    try { if ((await Deno.resolveDns(host, type)).some(internalIp)) return true; } catch { /* no record of this type */ }
  }
  return false;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return fail(405, 'method');

  // A signed-in user (the anon key alone is not enough).
  const auth = req.headers.get('authorization') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
  if (!who.ok) return fail(401, 'sign_in');

  let url: URL;
  try {
    const body = await req.json();
    url = new URL(String(body?.url ?? '').trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch { return fail(400, 'url'); }

  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      if (!allowed(url) || await pointsInside(url.hostname)) return fail(400, 'url');
      res = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/calendar, */*' }, signal: AbortSignal.timeout(15000) });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = new URL(next, url);
      res = null;
    }
    if (!res) return fail(502, 'redirects');
    if (!res.ok) return fail(502, `HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX) return fail(413, 'too_large');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX) return fail(413, 'too_large');
    const text = new TextDecoder().decode(buf);
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return fail(422, 'no_ics');
    return new Response(text, { headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(502, String((e as Error)?.message ?? e).slice(0, 200));
  }
});
