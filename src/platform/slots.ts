// How the app reaches booking systems. Directly first (works in the phone shell and for hosts that allow it);
// in the browser, blocked requests go through the cloud function slot-relay when signed in.
import type { AdapterContext } from '../core/favourites/adapters';
import type { ISODate } from '../core/time/dates';
import { cloud, signedInEmail } from './cloud';

type Res = Awaited<ReturnType<AdapterContext['fetch']>>;

async function viaRelay(url: string): Promise<Res> {
  const c = cloud();
  if (!c || !(await signedInEmail())) throw new Error('Nur mit Anmeldung lesbar');
  const { data, error } = await c.functions.invoke('slot-relay', { body: { url } });
  if (error) throw new Error('Relay: ' + String(error.message ?? error));
  return { ok: true, status: 200, json: async () => (typeof data === 'string' ? JSON.parse(data) : data) };
}

export function slotContext(today: ISODate): AdapterContext {
  return {
    today,
    ticketmasterKey: (import.meta.env.VITE_TICKETMASTER_KEY as string | undefined) ?? null,
    fetch: async (url, init) => {
      try {
        const r = await fetch(url, { headers: init?.headers });
        return { ok: r.ok, status: r.status, json: () => r.json() };
      } catch {
        return viaRelay(url); // CORS or offline: try the relay once
      }
    },
  };
}
