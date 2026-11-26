// Speech in and out. Web Speech API in the browser and the installed web app; the phone shell (Tauri) can later
// swap in the native recogniser behind the same functions. Privacy: in Chrome the browser's recogniser sends audio
// to Google, Safari uses Apple's; PA itself never records or stores audio.

interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

const LANG = 'de-AT';

function ctor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return !!ctor();
}

export function canSpeak(): boolean {
  return typeof speechSynthesis !== 'undefined';
}

export interface ListenHandlers {
  /** Text so far, while the person is still talking. */
  onInterim?: (text: string) => void;
  /** The whole utterance once the person pauses. */
  onFinal: (text: string) => void;
  /** Always called last, also after errors and stop(). */
  onEnd?: () => void;
  onError?: (code: string) => void;
  /**
   * Names and keywords the person uses (Meine Anbieter). Passed as recognition hints where the browser supports
   * them (Chrome's contextual phrases); elsewhere ignored, the router still matches them in the text.
   */
  phrases?: string[];
}

/** Listens for one utterance. Returns stop(). */
export function listen(h: ListenHandlers): () => void {
  const C = ctor();
  if (!C) {
    h.onError?.('not-supported');
    h.onEnd?.();
    return () => {};
  }
  stopSpeaking();
  const r = new C();
  r.lang = LANG;
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  if (h.phrases?.length) hint(r, h.phrases);
  let final = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    h.onInterim?.((final + ' ' + interim).trim());
  };
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') h.onError?.(e.error); };
  let ended = false;
  r.onend = () => {
    if (ended) return;
    ended = true;
    if (final.trim()) h.onFinal(final.trim());
    h.onEnd?.();
  };
  try { r.start(); } catch { h.onError?.('start-failed'); h.onEnd?.(); }
  return () => { try { r.stop(); } catch { /* already stopped */ } };
}

/** Best effort: newer Chrome takes `phrases` (SpeechRecognitionPhrase with a boost). Never fails the listening. */
function hint(r: Recognition, phrases: string[]): void {
  const g = globalThis as unknown as { SpeechRecognitionPhrase?: new (p: string, boost?: number) => unknown };
  const target = r as unknown as { phrases?: unknown[] };
  try {
    if (g.SpeechRecognitionPhrase && 'phrases' in target) target.phrases = phrases.map((p) => new g.SpeechRecognitionPhrase!(p, 3));
  } catch { /* not supported in this browser */ }
}

function germanVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === LANG) ?? voices.find((v) => v.lang.startsWith('de'));
}

/** Reads text aloud. Resolves when done (or at once where speech output is missing). */
export function speak(text: string): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  stopSpeaking();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    const v = germanVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) speechSynthesis.cancel();
}
