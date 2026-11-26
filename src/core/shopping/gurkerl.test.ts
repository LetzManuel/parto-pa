import { describe, expect, it } from 'vitest';
import { cartSummary, fillCart, McpClient, packs, pickTools, productsIn, type McpPost, type McpTool } from './gurkerl';
import { parseItem } from './parse';

const TOOLS: McpTool[] = [
  { name: 'get_order_history', inputSchema: { properties: { limit: { type: 'number' } } } },
  { name: 'search_products', description: 'Search gurkerl products', inputSchema: { properties: { keyword: { type: 'string' } } } },
  { name: 'add_items_to_cart', inputSchema: { properties: { items: { type: 'array' } } } },
  { name: 'checkout', inputSchema: { properties: {} } },
];

function fakeServer(log: Array<{ method: string; params?: unknown }>, catalogue: Record<string, unknown[]>): McpPost {
  return async (body) => {
    const b = body as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
    log.push({ method: b.method, params: b.params });
    if (b.method === 'initialize') return { status: 200, session: 's1', json: { jsonrpc: '2.0', id: b.id, result: {} } };
    if (b.method === 'tools/list') return { status: 200, session: null, json: { jsonrpc: '2.0', id: b.id, result: { tools: TOOLS } } };
    if (b.method === 'tools/call' && b.params!.name === 'search_products') {
      const hits = catalogue[String(b.params!.arguments.keyword).toLowerCase()] ?? [];
      return { status: 200, session: null, json: { jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: JSON.stringify({ products: hits }) }] } } };
    }
    return { status: 200, session: null, json: { jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: 'ok' }] } } };
  };
}

describe('gurkerl cart fill', () => {
  it('picks search and add-to-cart, never checkout', () => {
    expect(pickTools(TOOLS)).toEqual({ search: { name: 'search_products', query: 'keyword' }, add: { name: 'add_items_to_cart', product: null, quantity: null, items: 'items' } });
    expect(pickTools(TOOLS.filter((t) => t.name !== 'add_items_to_cart'))).toBeNull();
  });

  it('reads products from text or structured results', () => {
    expect(productsIn({ structuredContent: { results: [{ productId: 123, productName: 'Ja! Natürlich Milch 1 l', price: '1.49' }] } }))
      .toEqual([{ id: '123', name: 'Ja! Natürlich Milch 1 l', price: '1.49' }]);
  });

  it('puts every found item in the cart and reports the rest', async () => {
    const log: Array<{ method: string; params?: unknown }> = [];
    const client = new McpClient(fakeServer(log, { milch: [{ id: 11, name: 'Milch 1 l' }], eier: [{ id: 22, name: 'Eier 10 Stk' }] }));
    const lines = await fillCart(client, ['2 l Milch', '10 Eier', 'Drachenfrucht'].map(parseItem));
    expect(lines.map((l) => l.status)).toEqual(['added', 'added', 'not_found']);
    const adds = log.filter((l) => (l.params as { name?: string })?.name === 'add_items_to_cart').map((l) => (l.params as { arguments: unknown }).arguments);
    expect(adds).toEqual([{ items: [{ productId: 11, quantity: 2 }] }, { items: [{ productId: 22, quantity: 10 }] }]);
    expect(log.some((l) => (l.params as { name?: string })?.name === 'checkout')).toBe(false);
    expect(cartSummary(lines)).toBe('2 von 3 im gurkerl-Warenkorb. Nicht gefunden: Drachenfrucht. Bestellen und zahlen machst du in gurkerl.');
  });

  it('counts packs sensibly', () => {
    expect(packs(parseItem('500 g Mehl'))).toBe(1);
    expect(packs(parseItem('3 Joghurt'))).toBe(3);
    expect(packs(parseItem('Bananen'))).toBe(1);
  });
});
