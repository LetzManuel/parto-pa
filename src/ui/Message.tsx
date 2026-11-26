import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  channelsFor, CHANNEL_LABEL, compose, defaultChannel, emitMessageSent, fromProvider, matchRecipient, MESSAGE_TEMPLATES,
  parseCommand, sendLink, templateById, cleanDictation, type Channel, type MessageTemplateId, type Recipient,
} from '../core/messages';
import { createOrder, markRequested } from '../core/orders/flow';
import { canListen, canSpeak, listen, speak, stopSpeaking } from '../platform/speech';
import { usePA } from './context';
import { Chip, Field } from './kit';
import { MicButton } from './Mic';

export interface ComposerStart {
  recipient?: Recipient | null;
  template?: MessageTemplateId | null;
  channel?: Channel | null;
  body?: string;
  /** "am Freitag, 27. November" */
  when?: string | null;
  /** Read the draft aloud and listen for "senden" right away (opened by voice). */
  voice?: boolean;
}

export function useRecipients(): Recipient[] {
  const { store, version } = usePA();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => store.list('provider').map(fromProvider), [store, version]);
}

type Phase = 'idle' | 'speaking' | 'listening' | 'sent';

/**
 * Dictated message → template → read back → "senden". Hands the message to the mail, SMS or WhatsApp app;
 * the user confirms there. Reusable: pass any Recipient (providers, favourites, people).
 */
export function MessageComposer({ initial, recipients, onClose, onSent }: {
  initial: ComposerStart;
  recipients?: Recipient[];
  onClose: () => void;
  onSent?: (info: { recipient: Recipient; channel: Channel; template: MessageTemplateId; text: string }) => void;
}) {
  const { store, today, refresh } = usePA();
  const fromStore = useRecipients();
  const list = recipients ?? fromStore;
  const [recipient, setRecipient] = useState<Recipient | null>(initial.recipient ?? null);
  const [adhoc, setAdhoc] = useState({ name: '', contact: '' });
  const [template, setTemplate] = useState<MessageTemplateId>(initial.template ?? 'free');
  const [formal, setFormal] = useState<boolean | null>(null);
  const [body, setBody] = useState(initial.body ?? '');
  const [chosen, setChosen] = useState<Channel | null>(initial.channel ?? null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const alive = useRef(true);

  const r: Recipient | null = useMemo(() => {
    const base = recipient ?? (adhoc.name || adhoc.contact ? {
      key: 'adhoc', name: adhoc.name || adhoc.contact, formal: true,
      email: adhoc.contact.includes('@') ? adhoc.contact.trim() : null,
      phone: adhoc.contact.includes('@') ? null : adhoc.contact.trim() || null,
    } : null);
    return base && formal !== null ? { ...base, formal } : base;
  }, [recipient, adhoc, formal]);

  const avail = r ? channelsFor(r) : [];
  const channel: Channel | null = chosen && avail.includes(chosen) ? chosen : r ? defaultChannel(r) : null;
  const sender = { name: store.getMeta('name') ?? '' };
  const msg = r && channel ? compose({ template, recipient: r, channel, body, sender, when: initial.when }) : null;
  const link = r && channel && msg ? sendLink(channel, r, msg) : null;
  const tpl = templateById(template);

  // Latest values for the voice loop, which runs across renders.
  const live = useRef({ r, channel, msg, link, list, template });
  live.current = { r, channel, msg, link, list, template };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopRef.current(); stopSpeaking(); };
  }, []);

  const send = useCallback(() => {
    const { r, channel, msg, link, template } = live.current;
    if (!r || !channel || !msg || !link) return;
    stopRef.current(); stopSpeaking();
    emitMessageSent({ recipient: r, channel, template, date: today, text: msg.text });
    onSent?.({ recipient: r, channel, template, text: msg.text });
    let follow = '';
    if (templateById(template).expectsReply && r.key.startsWith('provider:')) {
      const pid = r.key.slice('provider:'.length);
      const existing = store.list('order').find((o) => o.providerId === pid && o.kind !== 'recurring' && o.state !== 'done' && o.state !== 'cancelled');
      const o = existing ?? createOrder({ title: `Antwort: ${r.name}`, kind: 'followup', providerId: pid, source: `Nachricht vom ${today.slice(8, 10)}.${today.slice(5, 7)}.` });
      store.save('order', markRequested(o, today, r.name));
      refresh();
      follow = ' PA fasst nach, wenn in zwei Werktagen keine Antwort da ist.';
    }
    setPhase('sent');
    setNote(`An ${CHANNEL_LABEL[channel]} übergeben. Dort noch auf Senden tippen.${follow}`);
    if (channel === 'whatsapp') {
      if (!window.open(link, '_blank')) location.assign(link);
    } else {
      location.assign(link);
    }
  }, [onSent, refresh, store, today]);

  const handle = useCallback((said: string): 'again' | 'stop' => {
    const c = parseCommand(said);
    const { list } = live.current;
    if (!c) {
      // A name alone answers "An wen?".
      const who = matchRecipient(said, list);
      if (who) { setRecipient(who); setChosen(null); return 'again'; }
      setNote(`Nicht verstanden: „${said}“. Sag „senden“, „vorlesen“, „ergänze …“, „per WhatsApp“ oder „abbrechen“.`);
      return 'again';
    }
    setNote(null);
    switch (c.type) {
      case 'send': send(); return 'stop';
      case 'cancel': onClose(); return 'stop';
      case 'read': return 'again';
      case 'redo': setBody(''); return 'again';
      case 'append': setBody((b) => `${b} ${cleanDictation(c.text)}`.trim()); return 'again';
      case 'replace': setBody(cleanDictation(c.text)); return 'again';
      case 'channel': setChosen(c.channel); return 'again';
      case 'template': setTemplate(c.template); return 'again';
      case 'formal': setFormal(c.formal); return 'again';
      case 'recipient': {
        const who = matchRecipient(c.query, list);
        if (who) { setRecipient(who); setChosen(null); } else setNote(`„${c.query}“ nicht gefunden.`);
        return 'again';
      }
    }
  }, [onClose, send]);

  /** Read the draft (or ask what is missing), then listen for one command; repeat until send/cancel. */
  const loop = useCallback(async (redoBody = false) => {
    if (!alive.current) return;
    const { r, channel, msg } = live.current;
    let prompt: string;
    if (redoBody) prompt = 'Was soll drinstehen?';
    else if (!r) prompt = 'An wen soll die Nachricht gehen?';
    else if (!channel) prompt = `Für ${r.name} fehlt eine Telefonnummer oder E-Mail-Adresse. Bitte unten eintragen.`;
    else prompt = `${templateById(live.current.template).label} an ${r.name} per ${CHANNEL_LABEL[channel]}. ${msg?.subject ? `Betreff: ${msg.subject}. ` : ''}${msg?.text.replace(/\n+/g, ' ')}. Senden?`;
    setPhase('speaking');
    await speak(prompt);
    if (!alive.current || (r && !channel)) { setPhase('idle'); return; }
    setPhase('listening');
    setHeard('');
    stopRef.current = listen({
      onInterim: setHeard,
      onFinal: (said) => {
        if (redoBody) { setBody(cleanDictation(said)); setTimeout(() => loop(), 50); return; }
        const next = handle(said);
        const c = parseCommand(said);
        if (next === 'again') setTimeout(() => loop(c?.type === 'redo'), 50);
      },
      onEnd: () => setPhase((p) => (p === 'listening' ? 'idle' : p)),
      onError: (code) => setNote(code === 'not-allowed' ? 'Mikrofon ist nicht erlaubt. Bitte in den Einstellungen freigeben.' : null),
    });
  }, [handle]);

  useEffect(() => {
    if (!initial.voice || !canSpeak()) return;
    const t = setTimeout(() => loop(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const micOn = phase === 'listening' || phase === 'speaking';
  const toggleMic = () => {
    if (micOn) { stopRef.current(); stopSpeaking(); setPhase('idle'); } else loop();
  };

  if (phase === 'sent') {
    return (
      <div className="composer">
        <p className="ok big">{note}</p>
        <div className="actions">
          {link && <a className="button" href={link} target={channel === 'whatsapp' ? '_blank' : undefined} rel="noreferrer">Nochmal öffnen</a>}
          <button className="primary" onClick={onClose}>Fertig</button>
        </div>
      </div>
    );
  }

  return (
    <div className="composer">
      <div className="to">
        <span className="meta">An</span>
        {r && recipient ? (
          <button className="chip on" onClick={() => setRecipient(null)} title="Empfänger ändern">{r.name} ✕</button>
        ) : (
          <div className="grow">
            {list.length > 0 && (
              <div className="chips scroll">
                {list.map((x) => <Chip key={x.key} onClick={() => { setRecipient(x); setChosen(null); }}>{x.name}</Chip>)}
              </div>
            )}
            <div className="row">
              <Field label="Name"><input value={adhoc.name} onChange={(e) => setAdhoc({ ...adhoc, name: e.target.value })} /></Field>
              <Field label="Handy oder E-Mail"><input value={adhoc.contact} onChange={(e) => setAdhoc({ ...adhoc, contact: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </div>

      <div className="chips scroll" aria-label="Vorlage">
        {MESSAGE_TEMPLATES.map((t) => <Chip key={t.id} active={template === t.id} onClick={() => setTemplate(t.id)}>{t.label}</Chip>)}
      </div>

      <div className="row compact">
        <div className="seg" role="group" aria-label="Kanal">
          {(['email', 'whatsapp', 'sms'] as Channel[]).map((c) => (
            <button key={c} className={channel === c ? 'on' : ''} disabled={!avail.includes(c)} onClick={() => setChosen(c)}>{CHANNEL_LABEL[c]}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Anrede">
          <button className={r?.formal !== false ? 'on' : ''} onClick={() => setFormal(true)}>Sie</button>
          <button className={r?.formal === false ? 'on' : ''} onClick={() => setFormal(false)}>du</button>
        </div>
      </div>

      <Field label="Dein Text">
        <textarea className="memo" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tpl.opening ? 'Optional: was noch hinein soll' : 'Was soll drinstehen?'} />
      </Field>

      {msg && (
        <div className={`preview ${channel}`}>
          {msg.subject && <div className="subject">{msg.subject}</div>}
          <div className="text">{msg.text}</div>
        </div>
      )}

      <div className="actions">
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary big" disabled={!link} onClick={send}>Senden per {channel ? CHANNEL_LABEL[channel] : '…'}</button>
      </div>
      <p className="hint-line">PA öffnet deine {channel ? CHANNEL_LABEL[channel] : 'Nachrichten'}-App mit allem ausgefüllt, du tippst dort auf Senden.</p>
      {canListen() && (
        <div className="voice-bar">
          <MicButton active={phase === 'listening'} busy={phase === 'speaking'} onClick={toggleMic} />
          <div className="voice-hint">
            {phase === 'listening' ? (heard ? `„${heard}“` : 'Ich höre …') : phase === 'speaking' ? 'Ich lese vor …' : '„Senden“, „vorlesen“, „ergänze …“, „per WhatsApp“, „Vorlage Absage“, „per du“, „abbrechen“'}
          </div>
        </div>
      )}
      {note && <p className="hint-line">{note}</p>}

    </div>
  );
}
