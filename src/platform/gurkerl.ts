// gurkerl connection on this device: OAuth sign-in with the person's own gurkerl account (PKCE, dynamic client
// registration as the MCP spec describes), then the MCP calls for the cart fill. Tokens stay on this device (meta
// table, not synced). Browsers may block gurkerl's addresses (CORS): then the call goes through the cloud function
// `mcp-relay` (signed-in users only, only *.gurkerl.at), same pattern as slot-relay.
//
// Off by default. Switch: Ich › Einkauf & Bestellen › "gurkerl-Warenkorb direkt befüllen".
import type { Store } from '../core/db/store';
import type { ShopList } from '../core/model';
import { cartSummary, fillCart, GURKERL_MCP, McpClient, McpError, type CartLine, type McpPost } from '../core/shopping/gurkerl';
import { textToItems } from '../core/shopping/parse';
import { cloud, signedInEmail } from './cloud';

const ON = 'gurkerl.cart';
const AUTH = 'gurkerl.auth';
const PENDING = 'gurkerl.pending';

interface Auth { clientId: string; tokenEndpoint: string; access: string; refresh: string | null; expires: number }
interface Pending { clientId: string; tokenEndpoint: string; verifier: string; state: string; redirect: string }

const read = <T>(store: Store, k: string): T | null => { try { return JSON.parse(store.getMeta(k) ?? 'null') as T | null; } catch { return null; } };

export const cartFillOn = (store: Store) => store.getMeta(ON) === '1';
export const setCartFill = (store: Store, on: boolean) => store.setMeta(ON, on ? '1' : '0');
export const gurkerlConnected = (store: Store) => !!read<Auth>(store, AUTH)?.access;
export const disconnectGurkerl = (store: Store) => store.setMeta(AUTH, 'null');
/** The basket goes to gurkerl and the person switched the fill on and signed in once. */
export const willFill = (store: Store, l: Pick<ShopList, 'platformId'>) => l.platformId === 'gurkerl' && cartFillOn(store) && gurkerlConnected(store);

// ---------- HTTP: direct, else via the relay ----------

interface Raw { status: number; headers: Record<string, string>; text: string }

async function http(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Raw> {
  try {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { status: r.status, headers, text: await r.text() };
  } catch {
    const c = cloud();
    if (!c || !(await signedInEmail())) throw new McpError('relay');
    const { data, error } = await c.functions.invoke('mcp-relay', { body: { url, ...init } });
    if (error) throw new McpError(`relay: ${String(error.message ?? error)}`);
    return data as Raw;
  }
}

/** Streamable HTTP answers either JSON or an SSE stream; take the JSON-RPC message from it. */
export function parseRpcBody(raw: Raw): unknown {
  const type = raw.headers['content-type'] ?? '';
  if (!raw.text.trim()) return null;
  if (type.includes('text/event-stream')) {
    const datas = raw.text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    for (let i = datas.length - 1; i >= 0; i--) { try { const j = JSON.parse(datas[i]); if (j && ('result' in j || 'error' in j)) return j; } catch { /* keep looking */ } }
    return null;
  }
  try { return JSON.parse(raw.text); } catch { return null; }
}

// ---------- OAuth ----------

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function discover(): Promise<{ authorize: string; token: string; register: string | null; scopes: string[] }> {
  const base = new URL(GURKERL_MCP);
  let issuer = base.origin;
  try {
    const pr = await http(`${base.origin}/.well-known/oauth-protected-resource${base.pathname}`, { method: 'GET', headers: { Accept: 'application/json' } });
    const j = pr.status === 200 ? JSON.parse(pr.text) : JSON.parse((await http(`${base.origin}/.well-known/oauth-protected-resource`, { method: 'GET' })).text);
    if (j?.authorization_servers?.[0]) issuer = j.authorization_servers[0];
  } catch { /* fall back to the MCP host */ }
  const iu = new URL(issuer);
  const meta = await http(`${iu.origin}/.well-known/oauth-authorization-server${iu.pathname === '/' ? '' : iu.pathname}`, { method: 'GET', headers: { Accept: 'application/json' } });
  const m = JSON.parse(meta.text);
  return { authorize: m.authorization_endpoint, token: m.token_endpoint, register: m.registration_endpoint ?? null, scopes: m.scopes_supported ?? [] };
}

const redirectUri = () => `${location.origin}${location.pathname}?gurkerl=1`;

/** Step 1: leaves the app for gurkerl's login page. */
export async function connectGurkerl(store: Store): Promise<void> {
  const d = await discover();
  const redirect = redirectUri();
  let clientId = read<Auth>(store, AUTH)?.clientId ?? null;
  if (!clientId) {
    if (!d.register) throw new McpError('no_registration');
    const r = await http(d.register, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      client_name: 'Parto PA', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }) });
    clientId = JSON.parse(r.text).client_id;
    if (!clientId) throw new McpError('registration');
  }
  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = random(16);
  store.setMeta(PENDING, JSON.stringify({ clientId, tokenEndpoint: d.token, verifier, state, redirect } satisfies Pending));
  const u = new URL(d.authorize);
  u.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256',
    state, resource: GURKERL_MCP, ...(d.scopes.length ? { scope: d.scopes.join(' ') } : {}),
  }).toString();
  location.assign(u.toString());
}

async function token(tokenEndpoint: string, form: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const r = await http(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form).toString() });
  const j = JSON.parse(r.text);
  if (!j.access_token) throw new McpError(j.error ?? `token ${r.status}`);
  return j;
}

/** Step 2, on app start: gurkerl sent the person back with ?gurkerl=1&code=…&state=…. Returns true when connected. */
export async function finishGurkerlLogin(store: Store): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  if (!q.has('gurkerl')) return false;
  history.replaceState(null, '', location.pathname);
  const p = read<Pending>(store, PENDING);
  store.setMeta(PENDING, 'null');
  if (!p || q.get('state') !== p.state || !q.get('code')) return false;
  const t = await token(p.tokenEndpoint, { grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: p.redirect, client_id: p.clientId, code_verifier: p.verifier, resource: GURKERL_MCP });
  store.setMeta(AUTH, JSON.stringify({ clientId: p.clientId, tokenEndpoint: p.tokenEndpoint, access: t.access_token, refresh: t.refresh_token ?? null, expires: Date.now() + (t.expires_in ?? 3600) * 1000 } satisfies Auth));
  setCartFill(store, true);
  return true;
}

async function accessToken(store: Store): Promise<string> {
  const a = read<Auth>(store, AUTH);
  if (!a?.access) throw new McpError('login', 401);
  if (a.expires - 60_000 > Date.now() || !a.refresh) return a.access;
  const t = await token(a.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: a.refresh, client_id: a.clientId, resource: GURKERL_MCP });
  store.setMeta(AUTH, JSON.stringify({ ...a, access: t.access_token, refresh: t.refresh_token ?? a.refresh, expires: Date.now() + (t.expires_in ?? 3600) * 1000 }));
  return t.access_token;
}

// ---------- cart fill ----------

function transport(store: Store): McpPost {
  return async (body, session) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${await accessToken(store)}`, 'MCP-Protocol-Version': '2025-06-18',
    };
    if (session) headers['Mcp-Session-Id'] = session;
    const raw = await http(GURKERL_MCP, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: raw.status, session: raw.headers['mcp-session-id'] ?? null, json: parseRpcBody(raw) };
  };
}

export type CartEvent = { phase: 'start'; list: string } | { phase: 'line'; line: CartLine } | { phase: 'done'; summary: string; lines: CartLine[] } | { phase: 'error'; message: string };
const listeners = new Set<(e: CartEvent) => void>();
export function onCartEvent(fn: (e: CartEvent) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e: CartEvent) => listeners.forEach((fn) => { try { fn(e); } catch { /* ignore */ } });

/** Fills the gurkerl cart with the basket, in the background. Never orders. */
export async function fillGurkerlCart(store: Store, l: ShopList): Promise<CartLine[] | null> {
  emit({ phase: 'start', list: l.name });
  try {
    const lines = await fillCart(new McpClient(transport(store)), textToItems(l.items), (line) => emit({ phase: 'line', line }));
    emit({ phase: 'done', summary: cartSummary(lines), lines });
    return lines;
  } catch (e) {
    const m = e instanceof McpError && e.message === 'login' ? 'gurkerl-Anmeldung abgelaufen. Bitte unter Ich › Einkauf & Bestellen neu verbinden.'
      : e instanceof McpError && e.message === 'tools' ? 'gurkerl bietet gerade keinen Warenkorb-Zugang an. Liste ist kopiert.'
      : 'gurkerl war nicht erreichbar. Liste ist kopiert, bitte selbst einlegen.';
    if (e instanceof McpError && e.message === 'login') { const a = read<Auth>(store, AUTH); if (a) store.setMeta(AUTH, JSON.stringify({ ...a, access: '' })); }
    emit({ phase: 'error', message: m });
    return null;
  }
}
