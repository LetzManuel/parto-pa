// Voice: one utterance becomes a message request, and short spoken commands steer the review.
// No AI: keyword rules on the device. Anything unclear stays visible and editable before sending.
import { findWhen } from '../templates/when';
import type { ISODate } from '../time/dates';
import { formatSpokenDate } from './when';
import { cleanDictation, mainClause } from './dictation';
import type { Channel, Recipient } from './recipients';
import { detectTemplate, MESSAGE_TEMPLATES, type MessageTemplateId } from './templates';

const CHANNEL_WORDS: Array<[RegExp, Channel]> = [
  [/\bwhats\s?app\b/i, 'whatsapp'],
  [/\b(sms|kurznachricht|textnachricht)\b/i, 'sms'],
  [/\b(e-?mail|mail)\b/i, 'email'],
];

export function detectChannel(text: string): Channel | null {
  for (const [re, ch] of CHANNEL_WORDS) if (re.test(text)) return ch;
  return null;
}

/** Words that mark a message rather than a memo ("Schreib …", "Sag Anna, dass …", "Nachricht an …"). */
const MESSAGE_INTENT = /^(?:bitte\s+)?(?:schreib\w*|sag\w*|schick\w*|send\w*|nachricht|e-?mail|mail|sms|whats\s?app|frag\w*|antwort\w*|teil\w*\s+\w+\s+mit|absage|terminanfrage)\b/i;

export function isMessageIntent(text: string): boolean {
  return MESSAGE_INTENT.test(text.trim()) || /^\s*(?:eine?\s+)?(?:nachricht|mail|e-mail|sms|whatsapp)\s+an\b/i.test(text);
}

const norm = (s: string) => s.toLowerCase().normalize('NFC');
const words = (s: string) => norm(s).split(/[^\p{L}\d]+/u).filter(Boolean);

/** Finds the person or business named in the utterance. Full names beat single words; short words are ignored. */
export function matchRecipient(text: string, list: Recipient[]): Recipient | null {
  const t = ` ${words(text).join(' ')} `;
  let best: { r: Recipient; score: number } | null = null;
  for (const r of list) {
    const names = [r.name, r.contactPerson ?? '', ...(r.aliases ?? [])].filter(Boolean);
    let score = 0;
    for (const n of names) {
      const ws = words(n);
      if (!ws.length) continue;
      if (t.includes(` ${ws.join(' ')} `)) score = Math.max(score, 10 + ws.join(' ').length);
      for (const w of ws) {
        if (w.length < 4 || w === 'frau' || w === 'herr' || w === 'studio') continue;
        // "dem Installateur", "Annas", "Huber's": allow a short ending.
        if (new RegExp(` ${w}(?:s|n|en)? `).test(t)) score = Math.max(score, w.length);
      }
    }
    if (score && (!best || score > best.score)) best = { r, score };
  }
  return best?.r ?? null;
}

export interface MessageRequest {
  template: MessageTemplateId | null;
  recipient: Recipient | null;
  channel: Channel | null;
  date: ISODate | null;
  /** "am Freitag, 27. November" when a date was said. */
  when: string | null;
  /** The message itself, cleaned. */
  body: string;
}

const HEAD_WORDS = /\b(schreib\w*|sag\w*|schick\w*|send\w*|nachricht|e-?mail|mail|sms|whats\s?app|an|per|als|mit|vorlage|bitte|eine?|einen|dem|der|den|die|frag\w*)\b/i;

/**
 * "Absage an Studio Nails per WhatsApp: ich kann morgen leider nicht"
 * "Sag Anna per SMS, dass ich morgen um 8 komme"
 * "Schreib dem Installateur eine Mail wegen Angebot Therme Doppelpunkt bitte um einen Kostenvoranschlag"
 */
export function parseRequest(raw: string, list: Recipient[], today: ISODate): MessageRequest {
  const spoken = raw.replace(/\s*\bdoppelpunkt\b\s*/gi, ': ');
  // Split "command part" from "message part" at the first ":", ", dass", " dass " or ",".
  let head = '';
  let body = spoken;
  let indirect = false;
  const m = spoken.match(/^(.*?)(?::\s*|,?\s+dass\s+|,\s*)(.+)$/is);
  if (m && (HEAD_WORDS.test(m[1]) || matchRecipient(m[1], list)) && m[1].split(/\s+/).length <= 12) {
    head = m[1];
    body = m[2];
    indirect = /\bdass\s+$/i.test(spoken.slice(0, spoken.length - m[2].length));
  } else if (isMessageIntent(spoken)) {
    head = spoken;
    body = '';
  }
  const scope = head || spoken;
  const recipient = matchRecipient(scope, list) ?? (head ? null : matchRecipient(spoken, list));
  const template = detectTemplate(scope) ?? detectTemplate(body);
  const channel = detectChannel(head);
  const when = findWhen(body, today) ?? findWhen(head, today);
  let text = body.trim();
  if (indirect) text = mainClause(text);
  return {
    template,
    recipient,
    channel,
    date: when?.date ?? null,
    when: when ? formatSpokenDate(when.date, today) : null,
    body: text ? cleanDictation(text) : '',
  };
}

export type VoiceCommand =
  | { type: 'send' }
  | { type: 'read' }
  | { type: 'cancel' }
  | { type: 'redo' }
  | { type: 'channel'; channel: Channel }
  | { type: 'template'; template: MessageTemplateId }
  | { type: 'formal'; formal: boolean }
  | { type: 'append'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'recipient'; query: string };

/** Short spoken commands while a draft is open. Returns null when nothing matched (the UI asks again). */
export function parseCommand(raw: string): VoiceCommand | null {
  const s = raw.trim().replace(/[.!?]+$/, '');
  const l = norm(s);
  if (/^(ja\s*,?\s*)?(bitte\s+)?(senden|absenden|abschicken|verschicken|schick\w*\s*(es|sie|ab)?|los|passt|ok(ay)?|ja(\s+bitte)?|raus damit)(\s+bitte)?$/.test(l)) return { type: 'send' };
  if (/^(vorlesen|lies\s+(es\s+|sie\s+)?(nochmal\s+)?vor|nochmal(\s+vorlesen)?|wiederholen|wie\s+lautet\s+sie)$/.test(l)) return { type: 'read' };
  if (/^(abbrechen|abbruch|stopp?|verwerfen|lass\s+es|vergiss\s+es|löschen)$/.test(l)) return { type: 'cancel' };
  if (/^(neu(\s+diktieren)?|nochmal\s+diktieren|von\s+vorne)$/.test(l)) return { type: 'redo' };
  const ap = s.match(/^(?:ergänz\w*|füg\w*\s+(?:hinzu|an)|noch\s+dazu|außerdem|und|zusätzlich)\s*[:,]?\s*(.+)$/i);
  if (ap) return { type: 'append', text: ap[1] };
  const rp = s.match(/^(?:ändern?\s+(?:in|auf|zu)|stattdessen|der\s+text\s+(?:ist|lautet)|text)\s*[:,]?\s*(.+)$/i);
  if (rp) return { type: 'replace', text: rp[1] };
  if (/\b(förmlich|per\s+sie|siezen|mit\s+sie)\b/.test(l)) return { type: 'formal', formal: true };
  if (/\b(persönlich|locker|per\s+du|duzen|mit\s+du)\b/.test(l)) return { type: 'formal', formal: false };
  const rc = s.match(/^(?:an|empfänger(?:\s+ist)?|schick\w*\s+es\s+an|lieber\s+an)\s+(.+)$/i);
  const ch = detectChannel(s);
  if (ch && /^(per|als|lieber|über|mit|via)?\s*\S*\s*$/i.test(s.replace(/e-?mail|whats\s?app|sms|kurznachricht/i, '').trim() + ' ')) return { type: 'channel', channel: ch };
  if (ch && /^(per|als|lieber|über|via|mit)\b/i.test(s)) return { type: 'channel', channel: ch };
  if (rc) return { type: 'recipient', query: rc[1] };
  const t = s.match(/^(?:vorlage|als|lieber\s+als|mach\s+(?:eine?n?\s+)?)\s*(.+)$/i);
  if (t) {
    const label = MESSAGE_TEMPLATES.find((x) => norm(x.label).replace(/\?$/, '') === norm(t[1]).replace(/^eine?n?\s+/, ''));
    const id = label?.id ?? detectTemplate(t[1]);
    if (id) return { type: 'template', template: id };
    if (/^(freie?|normale?|einfache?)\s+nachricht|ohne\s+vorlage/.test(norm(t[1]))) return { type: 'template', template: 'free' };
  }
  if (/^ohne\s+vorlage$/.test(l)) return { type: 'template', template: 'free' };
  return null;
}
