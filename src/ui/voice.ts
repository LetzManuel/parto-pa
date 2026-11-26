// The finder's voice calls, as a thin wrapper over the shared speech module (src/platform/speech.ts).
import { canListen as canListenShared, listen as listenShared, speak as speakShared, stopSpeaking } from '../platform/speech';

export const canListen = canListenShared;
export { stopSpeaking };

/** Listens once. onText gets the running text, onDone the final one (empty if nothing was understood). */
export function listen(onText: (t: string) => void, onDone: (t: string, error?: string) => void): () => void {
  let final = '', error: string | undefined;
  return listenShared({
    onInterim: onText,
    onFinal: (t) => { final = t; onText(t); },
    onError: (code) => { error = code; },
    onEnd: () => onDone(final, error),
  });
}

export function speak(text: string): void {
  void speakShared(text);
}
