import { useEffect, useMemo, useRef, useState } from 'react';
import { isMessageIntent, parseCommand, parseRequest } from '../core/messages';
import { formatShort } from '../core/time/dates';
import { canListen, listen, speak, stopSpeaking } from '../platform/speech';
import { MessageComposer, useRecipients, type ComposerStart } from './Message';
import { MicButton } from './Mic';
import { stamp, type Order } from '../core/model';
import { createOrder } from '../core/orders/flow';
import { createMemory, sourceFromMemo, CATEGORY_LABEL, guessCategory } from '../core/memory/memory';
import { suggest, TEMPLATES, type Suggestion, type TemplateId } from '../core/templates/templates';
import type { Unit } from '../core/time/dates';
import { usePA } from './context';
import { parseRequest as parseBooking } from '../core/favourites/request';
import { KIND_LABEL } from '../core/favourites/model';
import { Chip, Field } from './kit';

const UNITS: Array<[Unit, string]> = [['week', 'Wochen'], ['month', 'Monate'], ['year', 'Jahre']];

/**
 * The microphone tab: say anything. "Schreib Anna, dass …" becomes a message, everything else a memo that a
 * fixed template turns into an order; "Friseur morgen 14 bis 17 Uhr" opens the favourites check. Nothing is saved or sent before a spoken or tapped confirmation.
 */
export function Capture({ onDone, onFind }: { onDone: () => void; onFind: (text: string) => void }) {
  const { store, today, refresh } = usePA();
  const recipients = useRecipients();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const [edit, setEdit] = useState<Partial<Suggestion>>({});
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState<ComposerStart | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => void>(() => {});

  const hear = (onFinal: (said: string) => void) => {
    stopRef.current();
    setListening(true);
    stopRef.current = listen({
      onInterim: (t) => setVoiceNote(`„${t}“`),
      onFinal,
      onEnd: () => setListening(false),
      onError: (code) => setVoiceNote(code === 'not-allowed' ? 'Mikrofon ist nicht erlaubt. Bitte in den Einstellungen freigeben.' : 'Nicht verstanden. Nochmal tippen.'),
    });
  };

  // First utterance: message or memo.
  const start = () => hear((said) => {
    setVoiceNote(null);
    if (isMessageIntent(said)) {
      const r = parseRequest(said, recipients, today);
      setMessage({ recipient: r.recipient, template: r.template, channel: r.channel, body: r.body, when: r.when, voice: true });
      return;
    }
    if (parseBooking(said, today)) { onFind(said); return; }
    setText(said); setEdit({}); setPicked(null);
    const [best] = suggest(said, today);
    if (best && best.confidence >= 0.85) {
      const label = TEMPLATES.find((t) => t.id === best.template)!.label;
      speak(`${label}: ${best.title}${best.dueDate ? `, ${formatShort(best.dueDate, today)}` : ''}. Speichern?`).then(() =>
        hear((yes) => {
          const c = parseCommand(yes);
          if (c?.type === 'send' || /speicher/i.test(yes)) saveRef.current();
          else setVoiceNote('Nicht gespeichert. Ändere es unten oder tippe auf Speichern.');
        }));
    } else {
      speak('Notiert. Bitte unten eine Form wählen oder als Notiz speichern.');
    }
  });

  // Opening the tab starts listening at once: phone in hand, no searching.
  useEffect(() => {
    if (canListen()) start();
    return () => { stopRef.current(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = useMemo(() => suggest(text, today), [text, today]);
  const booking = useMemo(() => parseBooking(text, today), [text, today]);
  const base = suggestions.find((s) => s.template === picked) ?? (picked ? { template: picked, title: text, dueDate: null, confidence: 0 } : suggestions[0]);
  const s: Suggestion | undefined = base ? { ...base, ...edit } as Suggestion : undefined;
  const tpl = s?.template;
  const set = (patch: Partial<Suggestion>) => setEdit((e) => ({ ...e, ...patch }));
  const choose = (id: TemplateId) => { setPicked(id); setEdit({}); };

  const save = () => {
    const source = sourceFromMemo(today);
    const memo = store.save('memo', stamp({ text: text.trim(), result: null }));
    if (!s || !tpl) {
      store.save('memo', { ...memo, result: 'note' });
    } else {
      const kind = TEMPLATES.find((t) => t.id === tpl)!.kind;
      const draft: Partial<Order> = { title: s.title || text.trim(), kind, dueDate: s.dueDate ?? null, source };
      if (tpl === 'location') draft.place = s.place ?? null;
      if (tpl === 'conditional') Object.assign(draft, { waitingFor: s.waitingFor ?? null, fallback: s.fallback ?? null });
      if (tpl === 'recurring') Object.assign(draft, { everyN: s.everyN ?? 1, everyUnit: s.everyUnit ?? 'week', lastDone: s.dueDate ?? today, dueDate: null });
      const o = store.save('order', createOrder({ ...draft, title: draft.title!, kind }));
      if (s.memory && remember) store.save('memory', createMemory(s.memory, source));
      store.save('memo', { ...memo, result: `order:${o.id}` });
    }
    refresh();
    setText(''); setPicked(null); setEdit({});
    onDone();
  };
  saveRef.current = save;

  if (message) {
    return (
      <div className="screen">
        <h1>Nachricht</h1>
        <MessageComposer initial={message} recipients={recipients} onClose={() => { setMessage(null); setText(''); }} />
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>Sag es PA</h1>
      {canListen() && (
        <div className="voice-hero">
          <MicButton active={listening} onClick={() => (listening ? stopRef.current() : start())} />
          <div className="voice-hint">
            {voiceNote ?? (listening ? 'Ich höre …' : 'Tippen und sprechen')}
            <div className="meta">„Schreib Studio Nails, dass ich morgen 10 Minuten später komme“ · „Erinner mich morgen an die Steuer“</div>
          </div>
        </div>
      )}
      <div className="chips">
        <Chip active onClick={() => {}}>Memo</Chip>
        <Chip onClick={() => setMessage({ body: text.trim() ? text : '' })}>Nachricht schreiben</Chip>
      </div>
      <textarea
        className="memo" value={text} rows={3}
        placeholder="z. B. „Wenn der Installateur bis Freitag nicht zurückruft, such einen anderen“"
        onChange={(e) => { setText(e.target.value); setEdit({}); setPicked(null); }}
      />
      <p className="hint-line">PA erkennt feste Formen direkt auf dem Gerät, ohne KI.</p>

      <div className="chips">
        {TEMPLATES.map((t) => <Chip key={t.id} active={tpl === t.id} onClick={() => choose(t.id)}>{t.label}</Chip>)}
      </div>
      {booking && (
        <div className="actions"><button className="primary" onClick={() => { onFind(text); setText(''); }}>Bei Favoriten prüfen ({booking.topic ?? KIND_LABEL[booking.kind]})</button></div>
      )}
      {!tpl && text.trim() && <p className="hint-line">Keine Form erkannt. Wähle eine aus oder speichere es als Notiz.</p>}
      {!text.trim() && (
        <ul className="patterns">{TEMPLATES.map((t) => <li key={t.id}>{t.pattern}</li>)}</ul>
      )}

      {s && tpl && (
        <div className="form">
          <Field label={tpl === 'birthday' ? 'Wer' : 'Was'}>
            <input value={tpl === 'birthday' ? s.person ?? '' : s.title}
              onChange={(e) => tpl === 'birthday' ? set({ person: e.target.value, title: `Geburtstag ${e.target.value}` }) : set({ title: e.target.value })} />
          </Field>
          {tpl === 'location' && <Field label="Wo"><input value={s.place ?? ''} onChange={(e) => set({ place: e.target.value })} /></Field>}
          {tpl === 'conditional' && <>
            <Field label="Warten auf"><input value={s.waitingFor ?? ''} onChange={(e) => set({ waitingFor: e.target.value })} /></Field>
            <Field label="Plan B"><input value={s.fallback ?? ''} onChange={(e) => set({ fallback: e.target.value })} /></Field>
          </>}
          {tpl === 'recurring' ? (
            <div className="row">
              <Field label="Alle"><input type="number" min={1} value={s.everyN ?? 1} onChange={(e) => set({ everyN: Number(e.target.value) })} /></Field>
              <Field label="&nbsp;">
                <select value={s.everyUnit ?? 'week'} onChange={(e) => set({ everyUnit: e.target.value as Unit })}>
                  {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
                </select>
              </Field>
              <Field label="Zuletzt"><input type="date" value={s.dueDate ?? today} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
            </div>
          ) : tpl !== 'location' && (
            <Field label={tpl === 'conditional' ? 'Bis' : tpl === 'birthday' ? 'Datum' : 'Wann'}>
              <input type="date" value={s.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
          )}
          {s.memory && (
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Merken: „{s.memory}“ <em>({CATEGORY_LABEL[guessCategory(s.memory)]})</em>
            </label>
          )}
        </div>
      )}

      <div className="actions sticky">
        <button disabled={!text.trim()} onClick={save} hidden={!!tpl}>Als Notiz speichern</button>
        <button className="primary" disabled={!text.trim() || !tpl || (tpl !== 'location' && tpl !== 'recurring' && !s?.dueDate)} onClick={save}>Speichern</button>
      </div>
    </div>
  );
}
