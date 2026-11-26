// Hands a finished message to the user's own apps. PA itself sends nothing: mail app, SMS app or WhatsApp opens
// with everything filled in, the user taps "Senden" there.
import type { Channel, Recipient } from './recipients';
import type { Composed } from './templates';

/** Austrian numbers to international form: "0664 123 45 67" → "+436641234567". */
export function normalizePhone(raw: string, country = '43'): string | null {
  let s = raw.replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (s.startsWith('0')) s = `+${country}` + s.slice(1);
  else if (!s.startsWith('+')) s = `+${country}` + s;
  return /^\+\d{7,15}$/.test(s) ? s : null;
}

export function sendLink(channel: Channel, r: Pick<Recipient, 'email' | 'phone'>, m: Composed): string | null {
  if (channel === 'email') {
    if (!r.email) return null;
    const q = [m.subject ? `subject=${encodeURIComponent(m.subject)}` : '', `body=${encodeURIComponent(m.text)}`].filter(Boolean).join('&');
    return `mailto:${encodeURIComponent(r.email.trim()).replace(/%40/g, '@')}?${q}`;
  }
  const phone = r.phone ? normalizePhone(r.phone) : null;
  if (!phone) return null;
  if (channel === 'whatsapp') return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(m.text)}`;
  // "?&body=" is understood by both iOS and Android messaging apps.
  return `sms:${phone}?&body=${encodeURIComponent(m.text)}`;
}
