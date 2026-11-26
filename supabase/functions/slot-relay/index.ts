// Slot relay for the web version: browsers may not read the booking systems' public slot data (CORS), so the web app
// asks this function. Only signed-in users of Parto PA, only GET, only the fixed hosts below, only JSON (max. 1 MB).
// The phone app reads the same addresses directly and does not need this.
const ORIGINS = ['https://pa.parto.at', 'https://test-pa.parto.at', 'http://localhost:5173', 'http://localhost:5199'];
const MAX = 1024 * 1024;

/** Exact hosts, or "*.x" for a salon's own subdomain. */
const HOSTS = ['api.resmio.com', '*.salonized.com', 'app.ticketmaster.com'];

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function allowedHost(u: URL): boolean {
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return HOSTS.some((x) => (x.startsWith('*.') ? h.endsWith(x.slice(1)) && /^[a-z0-9-]+$/.test(h.slice(0, -x.length + 1)) : h === x));
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return fail(405, 'method');

  const auth = req.headers.get('authorization') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
  if (!who.ok) return fail(401, 'sign_in');

  let url: URL;
  try { url = new URL(String((await req.json())?.url ?? '')); } catch { return fail(400, 'url'); }
  if (!allowedHost(url)) return fail(400, 'url');

  try {
    const res = await fetch(url, { redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return fail(502, `HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX) return fail(413, 'too_large');
    const text = new TextDecoder().decode(buf);
    try { JSON.parse(text); } catch { return fail(422, 'no_json'); }
    return new Response(text, { headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(502, String((e as Error)?.message ?? e).slice(0, 200));
  }
});
