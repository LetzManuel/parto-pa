// The last step is always the person's: PA opens the booking page, the phone app or a prepared message.
// The message text is deliberately plain; the shared message templates (e-mail/SMS/WhatsApp) will replace it.
import { formatShort, type ISODate } from '../time/dates';
import type { BookingRequest, Favourite, Slot } from './model';
import { detectSystem, normalizeUrl, systemInfo } from './systems';

export type HandoffKind = 'book' | 'web' | 'call' | 'whatsapp' | 'sms';
export interface HandoffAction { kind: HandoffKind; label: string; url: string }

const phoneDigits = (p: string) => p.replace(/[^\d+]/g, '');
/** wa.me wants the number in international form without "+" (Austrian 0664… → 43664…). */
export function waNumber(p: string): string {
  const d = phoneDigits(p);
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return '43' + d.slice(1);
  return d;
}

/** "am Samstag ab 19 Uhr", "zwischen Mo und Fr zwischen 14:00 und 17:00 Uhr": the asked window as words. */
export function windowText(req: BookingRequest, ref: ISODate): string {
  const day = req.dateFrom === req.dateTo ? formatShort(req.dateFrom, ref) : `zwischen ${formatShort(req.dateFrom, ref)} und ${formatShort(req.dateTo, ref)}`;
  const time = req.to >= '23:59' ? `ab ${req.from} Uhr` : `zwischen ${req.from} und ${req.to} Uhr`;
  return `${day} ${time}`;
}

/** The sentence for the call or the message ("Spickzettel"). */
export function requestText(fav: Favourite, req: BookingRequest, ref: ISODate): string {
  const w = windowText(req, ref);
  switch (fav.kind) {
    case 'babysitter': return `Hallo ${fav.name.split(' ')[0]}, hättest du ${w} Zeit zum Babysitten? Liebe Grüße`;
    case 'restaurant': return `Ich hätte gern einen Tisch für ${req.people ?? 2} Personen, ${w}.`;
    case 'doctor': return `Ich hätte gern einen Termin${req.topic ? ` (${req.topic})` : ''}, am liebsten ${w}.`;
    case 'tickets': return `Ich suche ${req.people ?? 1} ${req.people === 1 ? 'Ticket' : 'Tickets'}${req.keyword ? ` für ${req.keyword}` : ''}, ${w}.`;
    default: return `Ich hätte gern einen Termin${fav.topic ? ` für ${fav.topic}` : ''}, am liebsten ${w}.`;
  }
}

/** One-tap ways to finish. With a slot, its deep link comes first. */
export function handoffActions(fav: Favourite, req: BookingRequest, ref: ISODate, slot?: Slot | null): HandoffAction[] {
  const out: HandoffAction[] = [];
  const text = requestText(fav, req, ref);
  const web = slot?.url ?? normalizeUrl(fav.bookingUrl);
  const sys = systemInfo(fav.system) ?? detectSystem(fav.bookingUrl);
  if (web) out.push({ kind: slot ? 'book' : 'web', label: slot ? 'Jetzt buchen' : sys ? `Auf ${sys.label} ansehen` : 'Website öffnen', url: web });
  if (fav.phone) {
    if (fav.kind === 'babysitter') {
      out.push({ kind: 'whatsapp', label: 'WhatsApp', url: `https://wa.me/${waNumber(fav.phone)}?text=${encodeURIComponent(text)}` });
      out.push({ kind: 'sms', label: 'SMS', url: `sms:${phoneDigits(fav.phone)}?body=${encodeURIComponent(text)}` });
    }
    out.push({ kind: 'call', label: 'Anrufen', url: `tel:${phoneDigits(fav.phone)}` });
  }
  return out;
}
