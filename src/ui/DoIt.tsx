import { useEffect, useRef, useState } from 'react';
import { basketFor } from './Shopping';
import { answer, startDoIt, type DoIt, type DoItContext, type Ready } from '../core/intent/doit';
import type { Order } from '../core/model';
import { markRequested } from '../core/orders/flow';
import { canListen, listen, speak, stopSpeaking } from '../platform/speech';
import { usePA } from './context';
import { useFlows } from './flows';
import { Card, Chip } from './kit';
import { useRecipients } from './Message';
import { MicButton } from './Mic';

const YES = /^(ja|jawohl|passt|ok|okay|genau|gerne|bitte|mach|los)/i;

export interface DoItStart { orderId: string | null; said?: string | null }

/**
 * "PA erledigt das": one question at a time until PA knows enough, then one confirm and the hand-off to the
 * feature that does it (check on Meine Anbieter, message composer, basket, phone). Voice first; every question
 * can also be answered by tapping or typing.
 */
export function DoItSheet({ start, onClose }: { start: DoItStart; onClose: () => void }) {
  const { store, today, refresh } = usePA();
  const flows = useFlows();
  const recipients = useRecipients();
  const order: Order | null = start.orderId ? store.get('order', start.orderId) ?? null : null;
  const ctx = (): DoItContext => ({ today, favourites: store.list('favourite'), providers: store.list('provider'), recipients });
  const [s, setS] = useState<DoIt>(() => startDoIt(order, start.said ?? null, ctx()));
  const [typed, setTyped] = useState('');
  const [heard, setHeard] = useState('');
  const [listening, setListening] = useState(false);
  const stop = useRef<() => void>(() => {});
  const live = useRef(s);
  live.current = s;

  const hear = (onFinal: (t: string) => void) => {
    if (!canListen()) return;
    stop.current();
    setListening(true);
    stop.current = listen({ onInterim: setHeard, onFinal: (t) => { setHeard(t); onFinal(t); }, onEnd: () => setListening(false), onError: () => setListening(false) });
  };

  const go = (r: Ready) => {
    stop.current(); stopSpeaking();
    if (!flows) return;
    const o = order;
    switch (r.to) {
      case 'book':
        onClose(); flows.openFinder({ text: r.text });
        return;
      case 'message':
        onClose();
        flows.openMessage({ recipient: r.recipient, template: r.template, body: r.body, when: r.when, voice: true }, () => {
          if (o && o.state === 'open') { store.save('order', markRequested(o, today, r.recipient.name)); refresh(); }
        });
        return;
      case 'order': {
        const draft = basketFor(store, r.intent, today);
        if (!draft.list) return;
        const l = draft.saved ? draft.list : store.save('shopList', draft.list);
        for (const x of draft.also) store.save('shopList', x.list);
        refresh(); onClose(); flows.openBasket(l.id);
        return;
      }
      case 'call':
        location.href = `tel:${r.phone.replace(/[^\d+]/g, '')}`;
        onClose();
        return;
    }
  };

  // Say the question (or the confirm) and listen for the answer.
  const talk = (x: DoIt) => {
    if (x.cancelled) { void speak('Gut, nichts gemacht.'); onClose(); return; }
    const line = x.question?.ask ?? x.confirm;
    if (!line) return;
    void speak(line).then(() => hear((t) => {
      const cur = live.current;
      if (cur.ready) { if (YES.test(t.trim())) go(cur.ready); else reply(t); return; }
      reply(t);
    }));
  };
  const reply = (t: string) => {
    const n = answer(live.current, t, ctx());
    setS(n); setTyped('');
    talk(n);
  };

  useEffect(() => {
    talk(s);
    return () => { stop.current(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div><h2>PA erledigt das</h2><div className="meta">{s.title}</div></div>
          <button className="link" onClick={onClose}>Schließen</button>
        </div>
        <Card tone="accent">
          <div className="hint-text">{s.question?.ask ?? s.confirm}</div>
          {s.question?.choices && (
            <div className="chips">{s.question.choices.map((c) => <Chip key={c.value} onClick={() => reply(c.value)}>{c.label}</Chip>)}</div>
          )}
          {s.ready ? (
            <div className="actions">
              <button className="primary big" onClick={() => go(s.ready!)}>Ja</button>
              <button onClick={onClose}>Nein</button>
            </div>
          ) : (
            <div className="row add">
              <input value={typed} placeholder="Antwort sagen oder tippen" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) reply(typed); }} />
              <button disabled={!typed.trim()} onClick={() => reply(typed)}>OK</button>
            </div>
          )}
        </Card>
        <div className="voice-bar">
          {canListen() && <MicButton active={listening} onClick={() => (listening ? stop.current() : talk(s))} />}
          <div className="voice-hint">{heard ? `„${heard}“` : listening ? 'Ich höre …' : 'Antwort sprechen'}</div>
        </div>
        <p className="hint-line">PA fragt nur, was fehlt. Buchen, senden, bestellen und anrufen machst am Ende du mit einem Tipp.</p>
      </div>
    </div>
  );
}
