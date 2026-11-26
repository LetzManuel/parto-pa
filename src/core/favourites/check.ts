// Checks the favourites of one list in their order and returns what each said. By default PA stops at the first
// place with a free slot ("der Reihe nach"); the person can ask for the others too.
import type { CalEvent } from '../model';
import { formatShort, type ISODate } from '../time/dates';
import { adapterFor, type AdapterContext } from './adapters';
import type { BookingRequest, CheckResult, Favourite, FavKind, Slot } from './model';
import { systemInfo } from './systems';

export interface Outcome { fav: Favourite; result: CheckResult }

/** Usual length if the favourite has none, used to test a slot against the person's calendar. */
const DEFAULT_MIN: Partial<Record<FavKind, number>> = { salon: 60, doctor: 30, restaurant: 120 };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** The list for a request: favourites of that kind (and doctor field), first priority first. */
export function listFor(all: Favourite[], req: Pick<BookingRequest, 'kind' | 'topic'>): Favourite[] {
  const kind = all.filter((f) => f.kind === req.kind);
  const byTopic = req.topic ? kind.filter((f) => f.topic?.toLowerCase() === req.topic!.toLowerCase()) : [];
  return (byTopic.length ? byTopic : kind).slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/** Drops slots that collide with the person's own appointments (only times are compared, never content). */
export function freeForMe(slots: Slot[], fav: Favourite, busy: CalEvent[]): Slot[] {
  const len = fav.durationMin ?? DEFAULT_MIN[fav.kind];
  if (!len) return slots;
  return slots.filter((s) => {
    const a = toMin(s.start), b = a + len;
    return !busy.some((e) => e.date === s.date && (!e.start || (toMin(e.start) < b && toMin(e.end ?? e.start) + (e.end ? 0 : 60) > a)));
  });
}

export async function checkInOrder(
  favs: Favourite[], req: BookingRequest, ctx: AdapterContext,
  opts: { busy?: CalEvent[]; all?: boolean; onProgress?: (o: Outcome) => void } = {},
): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const fav of favs) {
    const adapter = adapterFor(fav.system);
    let result: CheckResult = adapter
      ? await adapter.check(fav, req, ctx).catch((e) => ({ status: 'error' as const, reason: String(e) }))
      : { status: 'manual', reason: systemInfo(fav.system) ? `${systemInfo(fav.system)!.label} zeigt freie Termine nur auf der eigenen Seite` : 'Kein Online-Kalender' };
    if (result.status === 'slots' && opts.busy) {
      const slots = freeForMe(result.slots, fav, opts.busy);
      result = slots.length ? { status: 'slots', slots } : { status: 'full' };
    }
    const o = { fav, result };
    out.push(o);
    opts.onProgress?.(o);
    if (result.status === 'slots' && !opts.all) break;
  }
  return out;
}

/** The best proposal: the first place (in favourite order) with a slot, else the first place PA could not read. */
export function proposal(outcomes: Outcome[]): { fav: Favourite; slot: Slot | null; more: Slot[] } | null {
  for (const o of outcomes) if (o.result.status === 'slots') return { fav: o.fav, slot: o.result.slots[0], more: o.result.slots.slice(1) };
  const open = outcomes.find((o) => o.result.status === 'manual' || o.result.status === 'error');
  return open ? { fav: open.fav, slot: null, more: [] } : null;
}

/** One or two short sentences to read out loud: the person is on the go and does not want to scroll. */
export function spokenSummary(outcomes: Outcome[], req: BookingRequest, ref: ISODate): string {
  if (!outcomes.length) return 'Für diese Anfrage hast du noch keine Favoriten gespeichert.';
  const p = proposal(outcomes);
  const full = outcomes.filter((o) => o.result.status === 'full').map((o) => o.fav.name);
  const fullText = full.length ? `${full.join(' und ')} ${full.length === 1 ? 'hat' : 'haben'} nichts frei. ` : '';
  if (p?.slot) {
    const s = p.slot;
    const what = req.kind === 'tickets' && s.label ? `${s.label} am ${formatShort(s.date, ref)}` : `${formatShort(s.date, ref)} um ${s.start}`;
    const others = p.more.slice(0, 2).map((x) => (x.date === s.date ? x.start : `${formatShort(x.date, ref)} ${x.start}`));
    const verb = req.kind === 'tickets' ? 'Tickets gibt es bei' : `${p.fav.name} hat`;
    const head = req.kind === 'tickets' ? `${verb} ${p.fav.name}: ${what}.` : `${verb} ${what} frei.`;
    return `${fullText}${head}${others.length ? ` Auch ${others.join(' oder ')}.` : ''} Zum Buchen tippen.`;
  }
  if (p && p.fav.kind === 'babysitter') return `${fullText}Soll ich ${p.fav.name} fragen? Die Nachricht ist vorbereitet.`;
  if (p) {
    const way = p.fav.bookingUrl ? 'Buchungsseite öffnen' : p.fav.phone ? (p.fav.kind === 'babysitter' ? 'Nachricht schicken' : 'anrufen') : 'selbst nachsehen';
    return `${fullText}Bei ${p.fav.name} kann ich nicht nachsehen. ${way.charAt(0).toUpperCase() + way.slice(1)}?`;
  }
  return `Bei deinen Favoriten ist im gewünschten Zeitraum nichts frei.`;
}
