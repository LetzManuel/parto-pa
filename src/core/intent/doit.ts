// "PA, erledige das": any open to-do can be handed to PA. PA works out what kind of job it is (book a slot, write a
// message, order, call), asks for what is missing, one short question at a time (spoken and on screen), and ends in
// the usual single confirm. PA still never books, sends, orders or calls by itself: the last step is the person's tap
// or spoken "ja", and the other app does the rest. On the device, fixed patterns, no AI.
import { kindWords } from '../anbieter/lists';
import { KIND_LABEL, type BookingRequest, type FavKind, type Favourite } from '../favourites/model';
import { findWindow, parseRequest as parseBooking } from '../favourites/request';
import { isMessageIntent, matchRecipient, parseRequest as parseMessage, type MessageTemplateId, type Recipient } from '../messages';
import type { Order, Provider } from '../model';
import { parseShopping, type ShopIntent } from '../shopping/parse';
import { findWhen } from '../templates/when';
import type { ISODate } from '../time/dates';
import { route } from './route';

export type Job = 'book' | 'message' | 'order' | 'call';
export const JOB_LABEL: Record<Job, string> = { book: 'Termin suchen', message: 'Nachricht schreiben', order: 'Bestellen', call: 'Anrufen' };

export type Field = 'job' | 'kind' | 'when' | 'recipient' | 'contact' | 'body' | 'items' | 'phone';
export interface Question { field: Field; ask: string; choices?: Array<{ label: string; value: string }> }

export type Ready =
  | { to: 'book'; text: string; req: BookingRequest }
  | { to: 'message'; recipient: Recipient; template: MessageTemplateId; body: string; when: string | null }
  | { to: 'order'; intent: ShopIntent }
  | { to: 'call'; name: string; phone: string };

export interface DoIt {
  orderId: string | null;
  title: string;
  job: Job | null;
  /** Everything said so far for this job, fed to the feature's own parser. */
  text: string;
  recipient: Recipient | null;
  body: string | null;
  template: MessageTemplateId | null;
  who: string | null;
  phone: string | null;
  /** Fields already asked once: PA does not ask the same thing twice, it takes the default instead. */
  asked: Field[];
  question: Question | null;
  ready: Ready | null;
  /** The one sentence read out before the hand-off ("Friseur morgen ab 14 Uhr bei deinen Anbietern prüfen?"). */
  confirm: string | null;
  cancelled?: boolean;
}

export interface DoItContext {
  today: ISODate;
  favourites: Favourite[];
  providers: Provider[];
  recipients: Recipient[];
}

const CALL = /^(?:anruf(?:en)?\s*:?\s*|ruf\w*\s+)|\banrufen\b|\btelefonier\w*/i;
const BOOK = /\b(termin|buch\w*|reservier\w*|tisch|karten|tickets?|babysitter)\b/i;
const CANCEL = /^(abbrechen|abbruch|stopp?|lass\s+es|vergiss\s+es|doch\s+nicht|nein,?\s+danke)$/i;

function whoToCall(title: string): string {
  return title.replace(/^anruf(?:en)?\s*:?\s*/i, '').replace(/^ruf\w*\s+/i, '').replace(/\s+an$/i, '').replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\banrufen\b|\btelefonier\w*|\bmit\b/gi, ' ').replace(/\s+/g, ' ').trim();
}
const phoneIn = (s: string) => s.match(/(\+?\d[\d\s/-]{5,}\d)/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

/** Number for a name from Meine Anbieter or the provider address book. */
function lookupPhone(name: string, ctx: DoItContext): string | null {
  const n = name.toLowerCase();
  if (n.length < 2) return null;
  const hit = (x: { name: string; phone: string | null }) => x.phone && (x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
  return ctx.favourites.find(hit)?.phone ?? ctx.providers.find(hit)?.phone ?? null;
}

function jobFromText(text: string, order: Pick<Order, 'kind' | 'waitingFor'> | null, ctx: DoItContext): Job | null {
  if (order?.kind === 'followup' && order.waitingFor) return 'message';
  if (CALL.test(text)) return 'call';
  const r = route(text, { today: ctx.today, favourites: ctx.favourites, recipients: ctx.recipients });
  if (r.to === 'message') return 'message';
  if (r.to === 'shopping') return 'order';
  if (r.to === 'booking') return 'book';
  if (BOOK.test(text)) return 'book';
  return null;
}

/** Starts the dialog for a to-do (or a spoken sentence without one). */
export function startDoIt(order: Order | null, said: string | null, ctx: DoItContext): DoIt {
  const title = order?.title ?? said ?? '';
  const text = [title, order?.note, order?.place ? `bei ${order.place}` : null].filter(Boolean).join(' ');
  const job = jobFromText(text, order, ctx);
  const followup = order?.kind === 'followup' && order.waitingFor;
  const base: DoIt = {
    orderId: order?.id ?? null, title, job, text,
    recipient: followup ? matchRecipient(order!.waitingFor!, ctx.recipients) : null,
    body: followup ? '' : null, template: followup ? 'followup' : null,
    who: job === 'call' ? whoToCall(title) : followup ? order!.waitingFor : null,
    phone: job === 'call' ? phoneIn(text) : null,
    asked: [], question: null, ready: null, confirm: null,
  };
  return next(base, ctx);
}

const KIND_CHOICES = (Object.keys(KIND_LABEL) as FavKind[]).map((k) => ({ label: KIND_LABEL[k], value: KIND_LABEL[k] }));
const JOB_CHOICES = (Object.keys(JOB_LABEL) as Job[]).map((j) => ({ label: JOB_LABEL[j], value: j }));

const ask = (s: DoIt, q: Question): DoIt => ({ ...s, question: q, ready: null, confirm: null });
const done = (s: DoIt, ready: Ready, confirm: string): DoIt => ({ ...s, question: null, ready, confirm });

/** Works out what is still missing, or the hand-off when nothing is. */
export function next(s: DoIt, ctx: DoItContext): DoIt {
  if (s.cancelled) return s;
  switch (s.job) {
    case null:
      return ask(s, { field: 'job', ask: `Wie soll ich „${s.title}“ erledigen? Termin suchen, Nachricht schreiben, bestellen oder anrufen?`, choices: JOB_CHOICES });

    case 'book': {
      const req = parseBooking(s.text, ctx.today, undefined, kindWords(ctx.favourites));
      if (!req) {
        if (s.asked.includes('kind')) return ask({ ...s, job: null }, { field: 'job', ask: 'Dann sag mir bitte, wie ich es erledigen soll.', choices: JOB_CHOICES });
        return ask(s, { field: 'kind', ask: 'Wofür ist der Termin? Friseur, Kosmetik, Arzt, Restaurant, Tickets oder Babysitter?', choices: KIND_CHOICES });
      }
      const hasWhen = !!findWhen(s.text, ctx.today) || !!findWindow(s.text, req.kind) || /\b(heute|morgen|übermorgen|wochenende|nächste woche)\b/i.test(s.text);
      if (!hasWhen && !s.asked.includes('when')) return ask(s, { field: 'when', ask: 'Wann passt es dir? Zum Beispiel „morgen ab 14 Uhr“ oder „egal“.' });
      const what = req.topic ?? KIND_LABEL[req.kind];
      return done(s, { to: 'book', text: s.text, req }, `${what} bei deinen Anbietern prüfen?`);
    }

    case 'message': {
      const parsed = parseMessage(s.text, ctx.recipients, ctx.today);
      const recipient = s.recipient ?? parsed.recipient;
      if (!recipient) {
        if (s.who && s.asked.includes('recipient')) return ask(s, { field: 'contact', ask: `Wie erreiche ich ${s.who}? Sag die Nummer oder E-Mail-Adresse.` });
        return ask(s, { field: 'recipient', ask: 'An wen soll die Nachricht gehen?' });
      }
      const template = s.template ?? parsed.template ?? 'free';
      // The to-do's own words only count as message text when they were said as a message ("Schreib Anna, dass …").
      const body = s.body ?? (isMessageIntent(s.text) && parsed.body ? parsed.body : null);
      if (template === 'free' && !body) return ask({ ...s, recipient }, { field: 'body', ask: `Was soll ich ${recipient.name} schreiben?` });
      return done({ ...s, recipient }, { to: 'message', recipient, template, body: body ?? '', when: parsed.when }, `Nachricht an ${recipient.name} vorbereiten?`);
    }

    case 'order': {
      const intent = parseShopping(/^(bestell|kauf|besorg)/i.test(s.text) ? s.text : `Bestell ${s.text}`);
      if (!intent || (!intent.reuse && intent.items.length === 0)) return ask(s, { field: 'items', ask: 'Was soll in den Korb?' });
      return done(s, { to: 'order', intent }, `${intent.reuse ? `„${intent.reuse}“` : `${intent.items.length} ${intent.items.length === 1 ? 'Artikel' : 'Artikel'}`} in den Korb legen?`);
    }

    case 'call': {
      const who = s.who || s.title;
      const phone = s.phone ?? lookupPhone(who, ctx);
      if (!phone) return ask(s, { field: 'phone', ask: `Welche Nummer hat ${who}?` });
      return done({ ...s, phone }, { to: 'call', name: who, phone }, `${who} anrufen?`);
    }
  }
}

/** Takes the spoken or typed answer to the current question. */
export function answer(s: DoIt, said: string, ctx: DoItContext): DoIt {
  const a = said.trim();
  if (!a) return s;
  if (CANCEL.test(a)) return { ...s, cancelled: true, question: null, ready: null, confirm: null };
  const field = s.question?.field;
  const asked = field && !s.asked.includes(field) ? [...s.asked, field] : s.asked;
  const t: DoIt = { ...s, asked };
  switch (field) {
    case 'job': {
      const j: Job | null = (['book', 'message', 'order', 'call'] as Job[]).includes(a as Job) ? (a as Job)
        : /termin|buch|reservier|such/i.test(a) ? 'book' : /nachricht|schreib|mail|sms|whatsapp/i.test(a) ? 'message'
        : /bestell|kauf|einkauf|korb/i.test(a) ? 'order' : /anruf|ruf|telefon/i.test(a) ? 'call' : null;
      if (!j) return t;
      return next({ ...t, job: j, who: j === 'call' ? whoToCall(s.title) : s.who, phone: j === 'call' ? phoneIn(s.text) : s.phone }, ctx);
    }
    case 'kind':
    case 'when':
      return next({ ...t, text: /^(egal|wann immer|ist egal|irgendwann)$/i.test(a) ? t.text : `${t.text} ${a}` }, ctx);
    case 'recipient': {
      const r = matchRecipient(a, ctx.recipients);
      if (r) return next({ ...t, recipient: r }, ctx);
      const contact = a.includes('@') ? a.match(/\S+@\S+/)?.[0] ?? null : phoneIn(a);
      const name = a.replace(contact ?? '', '').replace(/^(an\s+)/i, '').trim() || contact || a;
      if (contact) return next({ ...t, recipient: adhoc(name, contact) }, ctx);
      return next({ ...t, who: name }, ctx);
    }
    case 'contact': {
      const contact = a.includes('@') ? a.match(/\S+@\S+/)?.[0] ?? null : phoneIn(a);
      return contact ? next({ ...t, recipient: adhoc(s.who ?? 'Kontakt', contact) }, ctx) : t;
    }
    case 'body':
      return next({ ...t, body: a }, ctx);
    case 'items':
      return next({ ...t, text: `${t.text}: ${a}` }, ctx);
    case 'phone': {
      const p = phoneIn(a);
      return p ? next({ ...t, phone: p }, ctx) : t;
    }
    default:
      return t;
  }
}

function adhoc(name: string, contact: string): Recipient {
  const email = contact.includes('@');
  return { key: 'adhoc', name, formal: true, email: email ? contact : null, phone: email ? null : contact };
}
