// Standard message templates. They frame what the user dictated with a greeting, a fitting first and last
// sentence, a subject and a sign-off, in Sie or du. No AI: the dictated text itself is only tidied up.
import type { Channel, Recipient } from './recipients';

export type MessageTemplateId =
  | 'free' | 'request' | 'cancel' | 'reschedule' | 'quote' | 'followup' | 'invoice' | 'thanks' | 'availability';

export interface TemplateCtx {
  formal: boolean;
  /** Spoken date, already formatted: "am Freitag, 27. November". */
  when?: string | null;
  service?: string | null;
}

export interface MessageTemplate {
  id: MessageTemplateId;
  label: string;
  /** Words that pick this template by voice. First match in TEMPLATE order wins. */
  keywords: RegExp;
  subject: (c: TemplateCtx) => string | null;
  opening?: (c: TemplateCtx) => string;
  closing?: (c: TemplateCtx) => string;
  /** After sending, PA waits for an answer and follows up. */
  expectsReply: boolean;
}

const sv = (c: TemplateCtx, sie: string, du: string) => (c.formal ? sie : du);
const at = (c: TemplateCtx) => (c.when ? ` ${c.when}` : '');
const forS = (c: TemplateCtx) => (c.service ? ` für ${c.service}` : '');

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'cancel', label: 'Absage', expectsReply: false,
    keywords: /\b(absage|absagen|sag\w*\s+\w*\s*ab|abzusagen|stornier\w*)\b/i,
    subject: (c) => `Absage Termin${at(c)}`,
    opening: (c) => `leider muss ich ${c.when ? `meinen Termin ${c.when}` : 'meinen Termin'} absagen.`,
    closing: (c) => sv(c, 'Vielen Dank für Ihr Verständnis.', 'Danke für dein Verständnis!'),
  },
  {
    id: 'reschedule', label: 'Verschieben', expectsReply: true,
    keywords: /\b(verschieb\w*|verlegen|neuen termin)\b/i,
    subject: (c) => `Terminverschiebung${at(c)}`,
    opening: (c) => `leider muss ich meinen Termin${at(c)} verschieben.`,
    closing: (c) => sv(c, 'Bitte geben Sie mir Bescheid, welcher Ersatztermin möglich ist.', 'Sag mir bitte, wann es dir sonst passt.'),
  },
  {
    id: 'request', label: 'Terminanfrage', expectsReply: true,
    keywords: /\b(terminanfrage|termin\s+(?:an)?fragen|termin\s+ausmachen|termin\s+vereinbaren|termin\s+buchen|einen\s+termin)\b/i,
    subject: (c) => `Terminanfrage${c.service ? `: ${c.service}` : ''}`,
    opening: (c) => `ich hätte gerne einen Termin${forS(c)}.`,
    closing: (c) => sv(c, 'Bitte geben Sie mir kurz Bescheid, ob das möglich ist.', 'Gib mir bitte kurz Bescheid, ob das geht.'),
  },
  {
    id: 'quote', label: 'Angebot', expectsReply: true,
    keywords: /\b(angebot|kostenvoranschlag|was\s+(?:das|es)\s+kostet)\b/i,
    subject: (c) => `Anfrage Angebot${c.service ? `: ${c.service}` : ''}`,
    opening: (c) => sv(c, `ich würde gerne ein Angebot${forS(c)} einholen.`, `kannst du mir ein Angebot${forS(c)} machen?`),
    closing: (c) => sv(c, 'Ich freue mich auf Ihre Rückmeldung.', 'Danke dir!'),
  },
  {
    id: 'invoice', label: 'Rechnung', expectsReply: true,
    keywords: /\b(rechnung)\b/i,
    subject: () => 'Bitte um Rechnung',
    opening: (c) => sv(c, `darf ich Sie bitten, mir die Rechnung${forS(c)} zu schicken?`, `kannst du mir bitte die Rechnung${forS(c)} schicken?`),
    closing: (c) => sv(c, 'Vielen Dank!', 'Danke!'),
  },
  {
    id: 'availability', label: 'Zeit?', expectsReply: true,
    keywords: /\b(zeit\s+(?:hat|hätte|haben|hättest|hast)|hat\s+\w+\s+zeit|verfügbar|babysitt\w*|aufpassen)\b/i,
    subject: (c) => sv(c, `Anfrage${at(c)}`, `Hast du${at(c)} Zeit?`),
    opening: (c) => sv(c, `hätten Sie${at(c) || ' demnächst'} Zeit?`, `hättest du${at(c) || ' demnächst'} Zeit?`),
    closing: (c) => sv(c, 'Bitte geben Sie mir kurz Bescheid. Vielen Dank!', 'Sag mir bitte kurz Bescheid. Danke!'),
  },
  {
    id: 'followup', label: 'Nachfragen', expectsReply: true,
    keywords: /\b(nachfrag\w*|nachhaken|nachfassen|erinnern)\b/i,
    subject: () => 'Kurze Nachfrage',
    opening: (c) => sv(c, 'ich wollte kurz nachfragen, ob es zu meiner Anfrage schon Neuigkeiten gibt.', 'ich wollte kurz nachfragen, ob es schon etwas Neues gibt.'),
    closing: (c) => sv(c, 'Vielen Dank!', 'Danke dir!'),
  },
  {
    id: 'thanks', label: 'Danke', expectsReply: false,
    keywords: /\b(bedank\w*|dankeschön|danke\s+sagen)\b/i,
    subject: () => 'Vielen Dank',
  },
  {
    id: 'free', label: 'Nachricht', expectsReply: false,
    keywords: /$^/,
    subject: () => null,
  },
];

export function templateById(id: MessageTemplateId): MessageTemplate {
  return MESSAGE_TEMPLATES.find((t) => t.id === id) ?? MESSAGE_TEMPLATES[MESSAGE_TEMPLATES.length - 1];
}

export function detectTemplate(text: string): MessageTemplateId | null {
  return MESSAGE_TEMPLATES.find((t) => t.keywords.test(text))?.id ?? null;
}

export interface Sender {
  /** Full name, "Manuel Letz". First name is used for du. */
  name: string;
}

export interface ComposeInput {
  template: MessageTemplateId;
  recipient: Recipient;
  channel: Channel;
  /** The dictated text, already cleaned. May be empty: then the template alone carries the message. */
  body: string;
  sender: Sender;
  when?: string | null;
  service?: string | null;
}

export interface Composed {
  /** E-mail only. */
  subject: string | null;
  text: string;
}

export function greeting(r: Recipient, channel: Channel): string {
  const cp = (r.contactPerson ?? '').trim();
  const title = cp.match(/^(frau|herr)\s+(.+)$/i);
  if (r.formal) {
    if (title) {
      const t = title[1].toLowerCase() === 'frau' ? 'Frau' : 'Herr';
      if (channel !== 'email') return `Guten Tag ${t} ${title[2]},`;
      return `${t === 'Frau' ? 'Sehr geehrte' : 'Sehr geehrter'} ${t} ${title[2]},`;
    }
    return channel === 'email' ? 'Sehr geehrte Damen und Herren,' : 'Guten Tag,';
  }
  // A first name ("Anna"), not a business ("Installateur Wagner").
  const who = title ? '' : cp || (r.name.trim().split(/\s+/).length === 1 ? r.name.trim() : '');
  const first = who.split(/\s+/)[0];
  return first ? `Hallo ${first},` : 'Hallo,';
}

export function signOff(sender: Sender, formal: boolean, channel: Channel): string {
  const full = sender.name.trim();
  const first = full.split(/\s+/)[0] ?? '';
  if (channel === 'email') return formal ? `Mit freundlichen Grüßen\n${full}` : `Liebe Grüße\n${first}`;
  if (formal) return full ? `Freundliche Grüße\n${full}` : 'Freundliche Grüße';
  return first ? `LG ${first}` : 'LG';
}

/** After "Hallo Anna," German goes on in lower case, except for nouns and names: only these words are lowered. */
const LOWER_AFTER_GREETING = /^(ich|wir|leider|danke|vielen|kannst|könnten|könnten|hätten|hättest|darf|bitte|wie|wann|ob|gerne?|kurz|heute|morgen|nur|es|das|die|der|mein|meine|unser|unsere|kein|keine|sorry|entschuldige|entschuldigen|bin|komme?|ja|nein|alles)\b/i;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function firstWords(text: string, max = 6): string {
  const w = text.replace(/\s+/g, ' ').replace(/[.!?:,;]+$/, '').split(' ');
  return w.slice(0, max).join(' ') + (w.length > max ? ' …' : '');
}

export function compose(i: ComposeInput): Composed {
  const t = templateById(i.template);
  const c: TemplateCtx = { formal: i.recipient.formal, when: i.when, service: i.service ?? i.recipient.service };
  const body = i.body.trim();
  const parts: string[] = [];
  // After "Sehr geehrte …," German continues in lower case.
  const opening = t.opening?.(c);
  const first = opening ?? body;
  const rest = opening ? body : '';
  if (first) parts.push(LOWER_AFTER_GREETING.test(first) ? lowerFirst(first) : first);
  if (rest) parts.push(rest);
  const closing = t.closing?.(c);
  if (closing) parts.push(closing);

  const short = i.channel !== 'email';
  const sep = short ? '\n' : '\n\n';
  const content = parts.join(short ? ' ' : '\n\n');
  const text = `${greeting(i.recipient, i.channel)}${sep}${content || ''}${sep}${signOff(i.sender, i.recipient.formal, i.channel)}`;
  const subject = i.channel === 'email' ? t.subject(c) ?? (body ? upperFirst(firstWords(body)) : 'Nachricht') : null;
  return { subject, text };
}
