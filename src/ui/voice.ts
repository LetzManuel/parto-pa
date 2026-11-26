// Voice in and out with what the device offers (Web Speech API now, native speech in the phone shell later).
// Note: in Chrome the browser's speech recognition runs on Google's servers; Safari/iOS recognise on the device.
// No speech is stored by PA: only the recognised text goes into the form.

interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => !!ctor();

/** Listens once. onText gets the running text, onDone the final one (empty if nothing was understood). */
export function listen(onText: (t: string) => void, onDone: (t: string, error?: string) => void): () => void {
  const C = ctor();
  if (!C) { onDone('', 'unsupported'); return () => {}; }
  const r = new C();
  r.lang = 'de-AT'; r.interimResults = true; r.continuous = false;
  let text = '', error: string | undefined;
  r.onresult = (e) => {
    text = Array.from(e.results).map((x) => x[0].transcript).join(' ').trim();
    onText(text);
  };
  r.onerror = (e) => { error = e.error; };
  r.onend = () => onDone(text, error);
  r.start();
  return () => r.stop();
}

export function speak(text: string): void {
  const s = globalThis.speechSynthesis;
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-AT';
  s.speak(u);
}
