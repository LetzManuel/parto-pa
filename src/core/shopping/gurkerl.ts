// gurkerl cart fill through gurkerl's official MCP server (https://mcp.gurkerl.at/mcp, OAuth with the person's own
// gurkerl account). Optional and off by default (Ich › Einkauf & Bestellen). What it does: for each item of a
// confirmed basket, search the product and put the first hit into the gurkerl cart. What it never does: check out.
// The person opens gurkerl, checks the cart and orders and pays there, exactly as before.
//
// gurkerl does not publish the tool names. The client therefore reads tools/list and picks the search and the
// add-to-cart tool by name and input schema (it also works with Knuspr/Rohlik, same server software). If it cannot
// find both, the feature says so and PA falls back to "copy list + open gurkerl".
import { formatItem } from './parse';
import type { ShopItem } from './parse';

export const GURKERL_MCP = 'https://mcp.gurkerl.at/mcp';
/** Opened after the fill; the cart is one tap from gurkerl's start page (exact cart address to be checked with a login). */
export const GURKERL_CART = 'https://www.gurkerl.at';
const PROTOCOL = '2025-06-18';

/** One JSON-RPC round trip. Returns the parsed result (SSE answers already unpacked) and the session id. */
export type McpPost = (body: unknown, session: string | null) => Promise<{ status: number; session: string | null; json: unknown }>;

export interface McpTool { name: string; description?: string; inputSchema?: { properties?: Record<string, { type?: string; items?: unknown }>; required?: string[] } }

interface RpcResponse { result?: unknown; error?: { code: number; message: string } }

export class McpError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

export class McpClient {
  private session: string | null = null;
  private id = 0;
  constructor(private readonly post: McpPost) {}

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const r = await this.post({ jsonrpc: '2.0', id: ++this.id, method, params }, this.session);
    if (r.session) this.session = r.session;
    if (r.status === 401 || r.status === 403) throw new McpError('login', r.status);
    const res = r.json as RpcResponse;
    if (res?.error) throw new McpError(res.error.message, r.status);
    if (r.status >= 400) throw new McpError(`HTTP ${r.status}`, r.status);
    return res?.result;
  }

  async connect(): Promise<void> {
    await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Parto PA', version: '0.1' } });
    // Notification: no id, no answer expected.
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, this.session).catch(() => undefined);
  }

  async tools(): Promise<McpTool[]> {
    const r = (await this.rpc('tools/list', {})) as { tools?: McpTool[] };
    return r?.tools ?? [];
  }

  call(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc('tools/call', { name, arguments: args });
  }
}

const props = (t: McpTool) => Object.keys(t.inputSchema?.properties ?? {});
const firstOf = (t: McpTool, names: string[]) => props(t).find((p) => names.includes(p.toLowerCase())) ?? null;

const QUERY = ['query', 'q', 'search', 'search_query', 'searchquery', 'term', 'keyword', 'keywords', 'text', 'phrase', 'name'];
const PRODUCT = ['product_id', 'productid', 'id', 'sku', 'item_id', 'itemid'];
const QTY = ['quantity', 'qty', 'amount', 'count'];

export interface CartTools {
  search: { name: string; query: string };
  add: { name: string; product: string | null; quantity: string | null; items: string | null };
}

/** Picks the product search and the add-to-cart tool. Null when the server does not offer both. */
export function pickTools(tools: McpTool[]): CartTools | null {
  const cartish = (t: McpTool) => /cart|basket|warenkorb|korb/i.test(t.name);
  const search = tools.find((t) => !cartish(t) && /search|find|such/i.test(t.name) && /product|item|artikel|grocer|search_products/i.test(`${t.name} ${t.description ?? ''}`) && firstOf(t, QUERY))
    ?? tools.find((t) => !cartish(t) && /search|find/i.test(t.name) && firstOf(t, QUERY));
  const add = tools.find((t) => cartish(t) && /add|put|insert|update|set|hinzu/i.test(t.name) && !/remove|delete|clear|checkout|order/i.test(t.name));
  if (!search || !add) return null;
  const items = props(add).find((p) => /^(items|products|lines)$/i.test(p)) ?? null;
  return {
    search: { name: search.name, query: firstOf(search, QUERY)! },
    add: { name: add.name, product: firstOf(add, PRODUCT), quantity: firstOf(add, QTY), items },
  };
}

export interface Product { id: string; name: string; price?: string }

/** Products from a tools/call result: structuredContent first, else JSON in the text parts. */
export function productsIn(result: unknown): Product[] {
  const r = result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  const pools: unknown[] = [];
  if (r?.structuredContent) pools.push(r.structuredContent);
  for (const c of r?.content ?? []) {
    if (c.type === 'text' && c.text) { try { pools.push(JSON.parse(c.text)); } catch { /* plain text answer */ } }
  }
  const out: Product[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    const id = o.productId ?? o.product_id ?? o.id ?? o.sku;
    const name = o.productName ?? o.product_name ?? o.name ?? o.title;
    if ((typeof id === 'string' || typeof id === 'number') && typeof name === 'string') {
      const price = o.price ?? (o.prices as Record<string, unknown> | undefined)?.price;
      out.push({ id: String(id), name, price: typeof price === 'string' || typeof price === 'number' ? String(price) : undefined });
      return;
    }
    for (const k of ['products', 'items', 'results', 'data', 'hits']) if (k in o) visit(o[k], depth + 1);
  };
  pools.forEach((p) => visit(p, 0));
  return out;
}

export interface CartLine { item: string; status: 'added' | 'not_found' | 'error'; product?: string; error?: string }

/** Whole number of packs for an item ("2 l Milch" → 2, "500 g Mehl" → 1, "Bananen" → 1). */
export function packs(i: ShopItem): number {
  if (!i.qty) return 1;
  const u = (i.unit ?? '').toLowerCase();
  if (/^(g|gramm|dag|ml)$/.test(u)) return 1;
  return Math.max(1, Math.min(20, Math.round(i.qty)));
}

/** Fills the cart item by item. Never calls anything that orders. */
export async function fillCart(client: McpClient, items: ShopItem[], onLine?: (l: CartLine) => void): Promise<CartLine[]> {
  await client.connect();
  const tools = pickTools(await client.tools());
  if (!tools) throw new McpError('tools');
  const out: CartLine[] = [];
  for (const i of items) {
    const label = formatItem(i);
    let line: CartLine;
    try {
      const [hit] = productsIn(await client.call(tools.search.name, { [tools.search.query]: i.name }));
      if (!hit) line = { item: label, status: 'not_found' };
      else {
        const qty = packs(i);
        const a = tools.add;
        const args: Record<string, unknown> = a.items
          ? { [a.items]: [{ [a.product ?? 'productId']: numeric(hit.id), [a.quantity ?? 'quantity']: qty }] }
          : { [a.product ?? 'productId']: numeric(hit.id), ...(a.quantity ? { [a.quantity]: qty } : {}) };
        await client.call(a.name, args);
        line = { item: label, status: 'added', product: hit.name };
      }
    } catch (e) {
      if (e instanceof McpError && e.message === 'login') throw e;
      line = { item: label, status: 'error', error: String((e as Error).message ?? e) };
    }
    out.push(line);
    onLine?.(line);
  }
  return out;
}

const numeric = (id: string): string | number => (/^\d+$/.test(id) ? Number(id) : id);

/** "8 von 9 sind im gurkerl-Warenkorb. Nicht gefunden: Bananen." */
export function cartSummary(lines: CartLine[]): string {
  const ok = lines.filter((l) => l.status === 'added').length;
  const miss = lines.filter((l) => l.status !== 'added').map((l) => l.item);
  return `${ok} von ${lines.length} im gurkerl-Warenkorb.${miss.length ? ` Nicht gefunden: ${miss.join(', ')}.` : ''} Bestellen und zahlen machst du in gurkerl.`;
}
