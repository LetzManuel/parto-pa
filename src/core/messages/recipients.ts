import type { Provider } from '../model';

export type Channel = 'email' | 'sms' | 'whatsapp';

export const CHANNEL_LABEL: Record<Channel, string> = { email: 'E-Mail', sms: 'SMS', whatsapp: 'WhatsApp' };

/**
 * Anyone a message can go to. Providers map onto it here; other features (favourites, babysitters)
 * build their own Recipient and use the same compose and send functions.
 */
export interface Recipient {
  /** Stable key, e.g. 'provider:<id>' or 'favourite:<id>'. */
  key: string;
  /** Shown in lists and matched by voice: "Studio Nails", "Anna". */
  name: string;
  /** "Frau Huber", "Herr Berger" or a first name. Drives the greeting. */
  contactPerson?: string | null;
  /** Sie (true) or du (false). */
  formal: boolean;
  email?: string | null;
  phone?: string | null;
  /** Preferred way to write to this person. */
  channel?: Channel | null;
  /** Extra words that should find this person by voice ("Installateur", "Nägel"). */
  aliases?: string[];
  /** What we usually ask for ("Maniküre Gel"), used in subjects. */
  service?: string | null;
}

export function fromProvider(p: Provider): Recipient {
  const aliases = [p.service, p.contactPerson?.replace(/^(frau|herr)\s+/i, '')].filter((x): x is string => !!x);
  return {
    key: `provider:${p.id}`,
    name: p.name,
    contactPerson: p.contactPerson,
    formal: true,
    email: p.email,
    phone: p.phone,
    channel: p.bookingWay === 'email' && p.email ? 'email' : null,
    aliases,
    service: p.service,
  };
}

export function channelsFor(r: Pick<Recipient, 'email' | 'phone'>): Channel[] {
  const out: Channel[] = [];
  if (r.email) out.push('email');
  if (r.phone) out.push('whatsapp', 'sms');
  return out;
}

/** The channel to use when the user did not say one: preferred, else e-mail for Sie, WhatsApp for du. */
export function defaultChannel(r: Recipient): Channel | null {
  const avail = channelsFor(r);
  if (r.channel && avail.includes(r.channel)) return r.channel;
  if (!avail.length) return null;
  if (r.formal && avail.includes('email')) return 'email';
  if (avail.includes('whatsapp')) return 'whatsapp';
  return avail[0];
}
