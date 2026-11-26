// Food and grocery platforms in Austria, as researched on 26 Nov 2026.
// None of them offers a public API for ordering as a customer. What exists:
//   - gurkerl.at: an official MCP server (https://mcp.gurkerl.at/mcp, OAuth with the user's gurkerl account) with
//     product search and cart. PA could fill the cart there; the order is still checked and sent in gurkerl.
//   - Lieferando, foodora, Wolt: only merchant/partner integrations (restaurants, couriers), nothing for customers.
// So PA prepares the list, opens the platform (saved favourite or search) and the user orders with one tap there.
import type { ShopKind } from '../model';

export type Handoff =
  /** Open the platform (or the saved store page); the list is copied and read out. */
  | 'open'
  /** As 'open', plus one search link per item. */
  | 'search'
  /** Cart can be filled through the platform's own connector (needs the user's sign-in once). */
  | 'cart';

export interface Platform {
  id: string;
  name: string;
  kinds: ShopKind[];
  /** Where it delivers, as far as known. Shown so nobody plans with a platform that does not reach them. */
  area: string;
  web: string;
  /** Product search on the platform, if it has a stable URL for it. */
  search?: (q: string) => string;
  handoff: Handoff;
  /** Connector that is possible but not switched on yet (see README "Bestellen"). */
  connector?: { kind: 'mcp'; url: string; auth: 'oauth'; state: 'planned' };
  note?: string;
}

const enc = encodeURIComponent;

export const PLATFORMS: Platform[] = [
  {
    id: 'gurkerl', name: 'gurkerl', kinds: ['grocery'], area: 'Wien und Umgebung',
    web: 'https://www.gurkerl.at', search: (q) => `https://www.gurkerl.at/suche?q=${enc(q)}`, handoff: 'search',
    connector: { kind: 'mcp', url: 'https://mcp.gurkerl.at/mcp', auth: 'oauth', state: 'planned' },
    note: 'Warenkorb kann PA künftig direkt befüllen (offizieller gurkerl-Zugang), bestellt wird in gurkerl.',
  },
  {
    id: 'foodora', name: 'foodora', kinds: ['food', 'grocery'], area: 'Wien, Graz, Linz, Salzburg, Innsbruck u. a.',
    web: 'https://www.foodora.at', handoff: 'open',
    note: 'Liefert auch BILLA (und in Innsbruck MPREIS). Gespeicherte Lieblings-Shops öffnen direkt.',
  },
  { id: 'lieferando', name: 'Lieferando', kinds: ['food'], area: 'ganz Österreich', web: 'https://www.lieferando.at', handoff: 'open' },
  { id: 'wolt', name: 'Wolt', kinds: ['food', 'grocery'], area: 'Wien, Graz, Linz u. a.', web: 'https://wolt.com/de/aut', handoff: 'open' },
  { id: 'alfies', name: 'Alfies', kinds: ['grocery'], area: 'Wien und Graz', web: 'https://www.alfies.at', handoff: 'open' },
];

/**
 * Names people say for a shop. Chains whose own delivery ended point to where they are delivered now, or to
 * null (list for the shop itself). Status 26 Nov 2026: BILLA delivers via foodora since Feb 2026, INTERSPAR ended
 * delivery (Wien Sep 2025), HOFER ended (Jun 2026), MPREIS via foodora in Innsbruck.
 */
export const ALIASES: Record<string, { platformId: string | null; note?: string }> = {
  gurkerl: { platformId: 'gurkerl' },
  foodora: { platformId: 'foodora' },
  mjam: { platformId: 'foodora' },
  lieferando: { platformId: 'lieferando' },
  wolt: { platformId: 'wolt' },
  alfies: { platformId: 'alfies' },
  billa: { platformId: 'foodora', note: 'BILLA liefert über foodora.' },
  mpreis: { platformId: 'foodora', note: 'MPREIS liefert über foodora (Innsbruck).' },
  'm-preis': { platformId: 'foodora', note: 'MPREIS liefert über foodora (Innsbruck).' },
  spar: { platformId: null, note: 'SPAR liefert nicht mehr zu, PA führt die Liste für den Einkauf im Geschäft.' },
  interspar: { platformId: null, note: 'INTERSPAR liefert nicht mehr zu, PA führt die Liste für den Einkauf im Geschäft.' },
  hofer: { platformId: null, note: 'HOFER liefert nicht mehr zu, PA führt die Liste für den Einkauf im Geschäft.' },
  lidl: { platformId: null, note: 'Lidl liefert keine Lebensmittel, PA führt die Liste für den Einkauf im Geschäft.' },
};

export const ALIAS_RE = Object.keys(ALIASES).map((k) => k.replace('-', '\\-')).join('|');

export function platform(id: string | null | undefined): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** Default platform for a kind when the user did not say one: the first one they enabled for it. */
export function defaultPlatform(kind: ShopKind, enabled: string[]): Platform | undefined {
  return enabled.map(platform).find((p) => p?.kinds.includes(kind));
}

/** Everything is on by default ("standardmäßig angebunden"); the user can switch platforms off in Ich › Bestellen. */
export const DEFAULT_ENABLED = PLATFORMS.map((p) => p.id);
