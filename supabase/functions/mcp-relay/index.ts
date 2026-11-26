// MCP relay for the web version: browsers may not call gurkerl's MCP and OAuth addresses directly (CORS), so the web
// app sends the request here. Only signed-in users of Parto PA, only https hosts under gurkerl.at, max. 1 MB.
// The relay keeps nothing: the person's gurkerl token comes with each request from their device and goes on unchanged.
// The phone app talks to gurkerl directly and does not need this.
const ORIGINS = ['https://pa.parto.at', 'https://test-pa.parto.at', 'http://localhost:5173', 'http://localhost:5199'];
const MAX = 1024 * 1024;
const PASS_REQ = ['accept', 'authorization', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const PASS_RES = ['content-type', 'mcp-session-id', 'www-authenticate'];

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function allowed(u: URL): boolean {
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === 'gurkerl.at' || (h.endsWith('.gurkerl.at') && /^[a-z0-9.-]+$/.test(h));
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return fail(405, 'method');

  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: req.headers.get('authorization') ?? '', apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
  if (!who.ok) return fail(401, 'sign_in');

  let input: { url?: string; method?: string; headers?: Record<string, string>; body?: string };
  try { input = await req.json(); } catch { return fail(400, 'json'); }
  let url: URL;
  try { url = new URL(String(input.url ?? '')); } catch { return fail(400, 'url'); }
  if (!allowed(url)) return fail(400, 'url');
  const method = input.method === 'GET' ? 'GET' : 'POST';
  if (typeof input.body === 'string' && input.body.length > MAX) return fail(413, 'too_large');

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) if (PASS_REQ.includes(k.toLowerCase()) && typeof v === 'string') out[k] = v;

  try {
    const res = await fetch(url, { method, headers: out, body: method === 'POST' ? input.body ?? '' : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX) return fail(413, 'too_large');
    const h: Record<string, string> = {};
    for (const k of PASS_RES) { const v = res.headers.get(k); if (v) h[k] = v; }
    return new Response(JSON.stringify({ status: res.status, headers: h, text: new TextDecoder().decode(buf) }), { headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(502, String((e as Error)?.message ?? e).slice(0, 200));
  }
});
