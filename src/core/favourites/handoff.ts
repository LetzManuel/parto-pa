// The last step is always the person's: PA opens the booking page, the phone app or a prepared message.
// Messages to people (babysitters) use the shared templates, so they look like every other PA message.
import { compose, formatSpokenDate, sendLink, type Recipient } from '../messages';
import { formatShort, type ISODate } from '../time/dates';
import type { BookingRequest, Favourite, Slot } from './model';
import { detectSystem, normalizeUrl, systemInfo } from './systems';

export type HandoffKind = 'book' | 'web' | 'call' | 'whatsapp' | 'sms';
export interface HandoffAction { kind: HandoffKind; label: string; url: string }

const phoneDigits = (p: string) => p.replace(/[^\d+]/g, '');
/** "am Samstag ab 19 Uhr", "zwischen Mo und Fr zwischen 14:00 und 17:00 Uhr": the asked window as words. */
export function windowText(req: BookingRequest, ref: ISODate): string {
  const day = req.dateFrom === req.dateTo ? formatShort(req.dateFrom, ref) : `zwischen ${formatShort(req.dateFrom, ref)} und ${formatShort(req.dateTo, ref)}`;
  const time = req.to >= '23:59' ? `ab ${req.from} Uhr` : `zwischen ${req.from} und ${req.to} Uhr`;
  return `${day} ${time}`;
}

export function recipientOf(fav: Favourite): Recipient {
  return { key: `favourite:${fav.id}`, name: fav.name, contactPerson: fav.name.split(' ')[0], formal: false, phone: fav.phone, channel: 'whatsapp' };
}

/** "am Samstag, 28. November ab 19:00 Uhr": the time for a message, written out. */
function spokenWindow(req: BookingRequest, ref: ISODate): string {
  const day = req.dateFrom === req.dateTo ? formatSpokenDate(req.dateFrom, ref) : `zwischen ${formatShort(req.dateFrom, ref)} und ${formatShort(req.dateTo, ref)}`;
  return `${day} ${req.to >= '23:59' ? `ab ${req.from} Uhr` : `zwischen ${req.from} und ${req.to} Uhr`}`;
}

/** A babysitter request in the shared "availability" template (du form). */
export function babysitterMessage(fav: Favourite, req: BookingRequest, ref: ISODate, sender: string, channel: 'whatsapp' | 'sms') {
  return compose({ template: 'availability', recipient: recipientOf(fav), channel, body: 'Es geht ums Babysitten.', sender: { name: sender }, when: spokenWindow(req, ref) });
}

/** The sentence for the call or the message ("Spickzettel"). */
export function requestText(fav: Favourite, req: BookingRequest, ref: ISODate, sender = ''): string {
  const w = windowText(req, ref);
  switch (fav.kind) {
    case 'babysitter': return babysitterMessage(fav, req, ref, sender, 'whatsapp').text;
    case 'restaurant': return `Ich hätte gern einen Tisch für ${req.people ?? 2} Personen, ${w}.`;
    case 'doctor': return `Ich hätte gern einen Termin${req.topic ? ` (${req.topic})` : ''}, am liebsten ${w}.`;
    case 'tickets': return `Ich suche ${req.people ?? 1} ${req.people === 1 ? 'Ticket' : 'Tickets'}${req.keyword ? ` für ${req.keyword}` : ''}, ${w}.`;
    default: return `Ich hätte gern einen Termin${fav.topic ? ` für ${fav.topic}` : ''}, am liebsten ${w}.`;
  }
}

/** One-tap ways to finish. With a slot, its deep link comes first. */
export function handoffActions(fav: Favourite, req: BookingRequest, ref: ISODate, slot?: Slot | null, sender = ''): HandoffAction[] {
  const out: HandoffAction[] = [];
  const web = slot?.url ?? normalizeUrl(fav.bookingUrl);
  const sys = systemInfo(fav.system) ?? detectSystem(fav.bookingUrl);
  if (web) out.push({ kind: slot ? 'book' : 'web', label: slot ? 'Jetzt buchen' : sys ? `Auf ${sys.label} ansehen` : 'Website öffnen', url: web });
  if (fav.phone) {
    if (fav.kind === 'babysitter') {
      for (const channel of ['whatsapp', 'sms'] as const) {
        const url = sendLink(channel, fav, babysitterMessage(fav, req, ref, sender, channel));
        if (url) out.push({ kind: channel, label: channel === 'whatsapp' ? 'WhatsApp' : 'SMS', url });
      }
    }
    out.push({ kind: 'call', label: 'Anrufen', url: `tel:${phoneDigits(fav.phone)}` });
  }
  return out;
}
