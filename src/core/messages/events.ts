// Other features listen here for sent messages (e.g. rhythms: "zuletzt gemeldet"), without this module knowing them.
import type { Channel, Recipient } from './recipients';
import type { MessageTemplateId } from './templates';
import type { ISODate } from '../time/dates';

export interface SentMessage {
  recipient: Recipient;
  channel: Channel;
  template: MessageTemplateId;
  date: ISODate;
  text: string;
}

type Listener = (m: SentMessage) => void;
const listeners = new Set<Listener>();

/** Returns unsubscribe. */
export function onMessageSent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "Sent" means: handed to the mail, SMS or WhatsApp app with the user's confirmation. */
export function emitMessageSent(m: SentMessage): void {
  for (const fn of listeners) {
    try { fn(m); } catch { /* one listener must not break sending */ }
  }
}
