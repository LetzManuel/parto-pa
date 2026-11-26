import type { Provider } from '../model';

/** The sentence for the phone call or the e-mail ("Spickzettel"). Nothing is sent by PA itself. */
export function requestSentence(p: Provider, windows: string, service?: string): string {
  const what = service || p.service || 'einen Termin';
  const art = service || p.service ? `einen Termin für ${what}` : what;
  return windows
    ? `Ich hätte gern ${art}, am liebsten ${windows}.`
    : `Ich hätte gern ${art}. Wann hätten Sie etwas frei?`;
}

export function telLink(p: Provider): string | null {
  return p.phone ? `tel:${p.phone.replace(/[^\d+]/g, '')}` : null;
}

/** Opens the user's own mail app with the request filled in; the user sends it there. */
export function mailLink(p: Provider, sentence: string, signature: string): string | null {
  if (!p.email) return null;
  const greeting = p.contactPerson ? `Hallo ${p.contactPerson},` : 'Guten Tag,';
  const body = `${greeting}\n\n${sentence}\n\nDanke und liebe Grüße\n${signature}`;
  const subject = `Terminanfrage${p.service ? ': ' + p.service : ''}`;
  return `mailto:${p.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function webLink(p: Provider): string | null {
  if (!p.website) return null;
  return /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`;
}

export const CATEGORY_LABEL: Record<Provider['category'], string> = { beauty: 'Beauty', trades: 'Handwerk', other: 'Sonstiges' };
export const WAY_LABEL: Record<Provider['bookingWay'], string> = { phone: 'anrufen', web: 'Buchungsseite', email: 'E-Mail' };
