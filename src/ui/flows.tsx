// The app-wide ways into a feature, so one feature can hand over to another (rhythm → booking check,
// babysitter → message, …) without knowing how the other one is shown. Provided once by the app shell.
import { createContext, useContext } from 'react';
import type { Channel, MessageTemplateId, Recipient } from '../core/messages';
import type { FinderStart } from './Finder';
import type { ComposerStart } from './Message';

export interface SentInfo { recipient: Recipient; channel: Channel; template: MessageTemplateId; text: string }

export interface Flows {
  openFinder: (start: FinderStart) => void;
  openMessage: (start: ComposerStart, onSent?: (info: SentInfo) => void) => void;
  openBasket: (id: string) => void;
  openProvider: (id: string) => void;
  openMe: () => void;
}

const FlowsContext = createContext<Flows | null>(null);
export const FlowsProvider = FlowsContext.Provider;
export const useFlows = (): Flows | null => useContext(FlowsContext);
