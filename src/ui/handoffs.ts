// Hand-offs from a suggestion card into other flows. The rhythm engine only says what fits ("book a hairdresser",
// "call Anna"); the flow that receives it shows the details and waits for the user's tap. Other modules replace the
// defaults with registerHandoff (booking: favourites availability check; contact: the message composer).
import type { Store } from '../core/db/store';
import type { Handoff } from '../core/rhythms/engine';
import type { ISODate } from '../core/time/dates';

export interface HandoffCtx {
  store: Store;
  today: ISODate;
  openProvider: (id: string) => void;
  /** Opens the "Ich" tab (e.g. to add a provider when none fits). */
  openMe: () => void;
  refresh: () => void;
}

type HandlerOf<T extends Handoff['type']> = (h: Extract<Handoff, { type: T }>, ctx: HandoffCtx) => void;

const handlers: { [T in Handoff['type']]?: HandlerOf<T> } = {};

export function registerHandoff<T extends Handoff['type']>(type: T, handler: HandlerOf<T>): void {
  (handlers as Record<string, unknown>)[type] = handler;
}

/** True when another module took over this hand-off (e.g. the message composer asks for the number itself). */
export function hasHandler(type: Handoff['type']): boolean {
  return !!handlers[type];
}

export function runHandoff(h: Handoff, ctx: HandoffCtx): void {
  const custom = handlers[h.type] as HandlerOf<typeof h.type> | undefined;
  if (custom) return (custom as (x: Handoff, c: HandoffCtx) => void)(h, ctx);
  if (h.type === 'book') return defaultBook(h, ctx);
  return defaultContact(h);
}

/** Default: the provider's sheet (call cheat sheet, e-mail, booking page); without a provider, "Meine Dienstleister". */
function defaultBook(h: Extract<Handoff, { type: 'book' }>, ctx: HandoffCtx): void {
  if (h.providerId) ctx.openProvider(h.providerId);
  else ctx.openMe();
}

/** Default: the phone app or the SMS app with the draft filled in. PA itself neither calls nor sends. */
function defaultContact(h: Extract<Handoff, { type: 'contact' }>): void {
  const link = contactLink(h);
  if (link) window.location.href = link;
}

export function contactLink(h: Extract<Handoff, { type: 'contact' }>): string | null {
  if (!h.phone) return null;
  const nr = h.phone.replace(/[^\d+]/g, '');
  return h.channel === 'message' ? `sms:${nr}?&body=${encodeURIComponent(h.draft)}` : `tel:${nr}`;
}
