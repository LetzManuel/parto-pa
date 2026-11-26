// Hand-offs between features, wired in one place. Each feature stays usable alone; this file connects them:
//   rhythm "Friseurtermin buchen?"   → check the salon list on Meine Anbieter (Finder), else the provider sheet
//   rhythm "Ben schreiben?"          → message composer with the draft (templates, read back, "senden")
//   sent message                     → rhythm history ("zuletzt gemeldet")
// Booking → messages (babysitter, doctors) and booking → calendar live in Finder via flows + addAppointment.
import type { Store } from '../core/db/store';
import { listFor } from '../core/favourites/check';
import type { FavKind } from '../core/favourites/model';
import { onMessageSent } from '../core/messages';
import { personKey } from '../core/rhythms/subjects';
import { logTouch, rhythmBySubject } from '../core/rhythms/touch';
import { contactLink, registerHandoff } from './handoffs';

/** Rhythm services → the list on Meine Anbieter. Trades (Werkstatt, Therme) have no list yet: provider sheet. */
const SERVICE_KIND: Record<string, FavKind> = { friseur: 'salon', manikuere: 'beauty', pedikuere: 'beauty', massage: 'beauty', kosmetik: 'beauty' };

export function favKindForService(serviceKey: string): FavKind | null {
  return SERVICE_KIND[serviceKey] ?? null;
}

let wired = false;

export function wireFeatures(store: Store): () => void {
  if (!wired) {
    wired = true;
    registerHandoff('book', (h, ctx) => {
      const kind = favKindForService(h.serviceKey);
      if (kind && ctx.flows && listFor(ctx.store.list('favourite'), { kind, topic: null }).length) {
        ctx.flows.openFinder({ kind, topic: null });
        return;
      }
      if (h.providerId) ctx.openProvider(h.providerId);
      else ctx.openMe();
    });
    registerHandoff('contact', (h, ctx) => {
      if (h.channel === 'message' && ctx.flows) {
        ctx.flows.openMessage({
          recipient: { key: `rhythm:${h.rhythmId}`, name: h.person, formal: false, phone: h.phone, email: null, channel: h.phone ? 'whatsapp' : null },
          template: 'free', body: h.draft,
        });
        return;
      }
      const link = contactLink(h);
      if (link) window.location.href = link;
    });
  }
  // A sent message counts as contact for the person's rhythm (only if there is one: PA keeps no other log).
  return onMessageSent((m) => {
    const r = rhythmBySubject(store, personKey(m.recipient.name)) ?? store.list('rhythm').find((x) => m.recipient.key === `rhythm:${x.id}`);
    if (r) logTouch(store, { subject: r.subject, kind: r.kind, date: m.date, source: 'message', direction: 'out' });
  });
}
