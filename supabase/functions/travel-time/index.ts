// Travel time for leave-by reminders: asks the Google Routes API (live traffic for the car, Wiener Linien / ÖBB
// timetables for public transport). The key stays here as the secret GOOGLE_MAPS_API_KEY and never reaches the app.
// Only signed-in users of Parto PA may use it. Without the key it answers 501 no_key and the app estimates instead.
const ORIGINS = ['https://pa.parto.at', 'https://test-pa.parto.at', 'http://localhost:5173', 'http://localhost:5199'];
const MODES: Record<string, string> = { car: 'DRIVE', transit: 'TRANSIT', walk: 'WALK', bike: 'BICYCLE' };
const FIELDS = [
  'routes.duration', 'routes.description',
  'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.transitDetails.stopDetails.departureTime',
  'routes.legs.steps.transitDetails.transitLine.nameShort', 'routes.legs.steps.transitDetails.transitLine.name',
].join(',');

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

interface Step {
  travelMode?: string;
  staticDuration?: string;
  transitDetails?: { stopDetails?: { departureTime?: string }; transitLine?: { nameShort?: string; name?: string } };
}

const secs = (d?: string) => Number(String(d ?? '0s').replace(/s$/, '')) || 0;

function place(p: unknown): Record<string, unknown> | null {
  const o = p as { address?: unknown; lat?: unknown; lng?: unknown } | null;
  if (o && typeof o.address === 'string' && o.address.trim() && o.address.length < 300) return { address: o.address.trim() };
  if (o && typeof o.lat === 'number' && typeof o.lng === 'number' && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180) {
    return { location: { latLng: { latitude: o.lat, longitude: o.lng } } };
  }
  return null;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return reply(405, { error: 'method' });

  const auth = req.headers.get('authorization') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
  if (!who.ok) return reply(401, { error: 'sign_in' });

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return reply(501, { error: 'no_key' });

  let body: { origin?: unknown; destination?: unknown; mode?: unknown; arriveBy?: unknown; departAt?: unknown };
  try { body = await req.json(); } catch { return reply(400, { error: 'body' }); }
  const origin = place(body.origin);
  const destination = place(typeof body.destination === 'string' ? { address: body.destination } : body.destination);
  const travelMode = MODES[String(body.mode)];
  const arriveBy = Date.parse(String(body.arriveBy ?? ''));
  if (!origin || !destination || !travelMode || Number.isNaN(arriveBy)) return reply(400, { error: 'body' });

  const now = Date.now();
  const request: Record<string, unknown> = {
    origin, destination, travelMode, languageCode: 'de-AT', regionCode: 'at', units: 'METRIC',
  };
  if (travelMode === 'TRANSIT') {
    request.arrivalTime = new Date(Math.max(arriveBy, now + 60000)).toISOString();
  } else if (travelMode === 'DRIVE') {
    // Traffic for the planned departure; Google refuses times in the past.
    const depart = Date.parse(String(body.departAt ?? '')) || arriveBy - 30 * 60000;
    request.routingPreference = 'TRAFFIC_AWARE';
    request.departureTime = new Date(Math.max(depart, now + 60000)).toISOString();
  }

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return reply(502, { error: 'google', detail: String(data?.error?.status ?? res.status) });
    const route = data?.routes?.[0];
    if (!route) return reply(404, { error: 'not_found' });

    const steps: Step[] = (route.legs ?? []).flatMap((l: { steps?: Step[] }) => l.steps ?? []);
    let leaveAt: string | undefined;
    const lines: string[] = [];
    if (travelMode === 'TRANSIT') {
      let walkBefore = 0;
      for (const s of steps) {
        const dep = s.transitDetails?.stopDetails?.departureTime;
        if (dep && !leaveAt) leaveAt = new Date(Date.parse(dep) - walkBefore * 1000).toISOString();
        if (!leaveAt) walkBefore += secs(s.staticDuration);
        const line = s.transitDetails?.transitLine;
        if (line) lines.push(line.nameShort || line.name || '');
      }
    }
    const summary = travelMode === 'TRANSIT'
      ? [...new Set(lines.filter(Boolean))].slice(0, 4).join(', ') || undefined
      : route.description ? `über ${route.description}` : undefined;
    return reply(200, { minutes: Math.max(1, Math.ceil(secs(route.duration) / 60)), leaveAt, summary, traffic: travelMode === 'DRIVE' });
  } catch (e) {
    return reply(502, { error: 'google', detail: String((e as Error)?.message ?? e).slice(0, 200) });
  }
});
