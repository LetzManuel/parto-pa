// Public API of the message module. Other features (e.g. availability requests to favourites) use only this file.
export { cleanDictation } from './dictation';
export { channelsFor, CHANNEL_LABEL, defaultChannel, fromProvider, type Channel, type Recipient } from './recipients';
export { compose, detectTemplate, MESSAGE_TEMPLATES, templateById, type Composed, type ComposeInput, type MessageTemplateId, type Sender } from './templates';
export { normalizePhone, sendLink } from './links';
export { isMessageIntent, matchRecipient, parseCommand, parseRequest, type MessageRequest, type VoiceCommand } from './voice';
export { formatSpokenDate } from './when';
export { emitMessageSent, onMessageSent, type SentMessage } from './events';
