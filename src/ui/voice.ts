// Finder's voice helpers, now a thin layer over the shared platform/speech.ts so every screen uses one recogniser
// (de-AT, same privacy note) and one voice for read-back.
import { canListen as can, listen as hear, speak as say } from '../platform/speech';

export const canListen = can;

/** Listens once. onText gets the running text, onDone the final one (empty if nothing was understood). */
export function listen(onText: (t: string) => void, onDone: (t: string, error?: string) => void): () => void {
  let text = '', error: string | undefined;
  return hear({
    onInterim: (t) => { text = t; onText(t); },
    onFinal: (t) => { text = t; onText(t); },
    onError: (code) => { error = code === 'not-supported' ? 'unsupported' : code; },
    onEnd: () => onDone(text, error),
  });
}

export function speak(text: string): void {
  void say(text);
}
