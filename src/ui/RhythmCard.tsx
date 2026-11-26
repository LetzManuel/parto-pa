import { useEffect, useRef, useState } from 'react';
import { interpretReply, type RhythmSuggestion, type SuggestionAction } from '../core/rhythms/engine';
import { applySuggestionAction, suggestionsFor } from '../core/rhythms/touch';
import { canListen, listen } from '../platform/speech';
import { hasHandler, runHandoff } from './handoffs';
import { usePA } from './context';
import { Card } from './kit';
import { MicButton } from './Rhythms';

/**
 * One suggestion at a time, on top of "Heute": "Friseurtermin buchen?", "Anna anrufen?". One tap or one spoken
 * word ("ja", "später", "nein"). The primary action hands off to booking or calling/messaging; PA never acts itself.
 */
export function RhythmCard({ onOpenProvider, onOpenMe, suggestions }: { onOpenProvider: (id: string) => void; onOpenMe: () => void; suggestions: RhythmSuggestion[] }) {
  const { store, today, refresh } = usePA();
  const [after, setAfter] = useState<RhythmSuggestion | null>(null);
  const [askPhone, setAskPhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [heard, setHeard] = useState('');
  const stopRef = useRef<() => void>();
  useEffect(() => () => stopRef.current?.(), []);

  const s = after ?? suggestions[0];
  if (!s) return null;

  const act = (id: SuggestionAction) => {
    setHeard('');
    if (after) {
      applySuggestionAction(store, after, id, today);
      setAfter(null);
      refresh();
      return;
    }
    if (id === 'go' && s.handoff) {
      if (s.handoff.type === 'contact' && !s.handoff.phone && !hasHandler('contact')) { setAskPhone(true); return; }
      applySuggestionAction(store, s, 'go', today);
      runHandoff(s.handoff, { store, today, openProvider: onOpenProvider, openMe: onOpenMe, refresh });
      setAfter(s);
      refresh();
      return;
    }
    applySuggestionAction(store, s, id, today);
    refresh();
  };

  const savePhone = () => {
    const r = s.rhythmId ? store.get('rhythm', s.rhythmId) : undefined;
    if (!r || !phone.trim()) return;
    store.save('rhythm', { ...r, phone: phone.trim(), updatedAt: new Date().toISOString() });
    setAskPhone(false);
    const fresh = suggestionsFor(store, today).find((x) => x.key === s.key) ?? s;
    applySuggestionAction(store, fresh, 'go', today);
    if (fresh.handoff) runHandoff(fresh.handoff, { store, today, openProvider: onOpenProvider, openMe: onOpenMe, refresh });
    setAfter(fresh);
    refresh();
  };

  // After the hand-off: did it happen? (A phone call or a booking page cannot tell PA by itself.)
  const actions: RhythmSuggestion['actions'] = after
    ? after.handoff?.type === 'book'
      ? [{ id: 'done', label: 'Termin steht' }, { id: 'later', label: 'Noch nicht' }]
      : [{ id: 'done', label: 'Ja, erledigt' }, { id: 'later', label: 'Nicht erreicht' }]
    : s.actions;

  const voice = () => {
    if (!canListen()) return;
    setHeard('…');
    stopRef.current = listen({
      onInterim: (t) => setHeard(t),
      onFinal: (t) => {
        setHeard(t);
        const a = interpretReply(t, after ? 'due' : s.source);
        if (!a) return;
        if (after) act(a === 'go' ? 'done' : a === 'stop' ? 'later' : a);
        else act(a);
      },
      onError: () => setHeard(''),
    });
  };

  return (
    <Card tone="accent">
      <div className="suggest-head">
        <span className="suggest-label">{s.source === 'learned' ? 'PA hat ein Muster erkannt' : 'Vorschlag'}</span>
      </div>
      <div className="suggest-title">{after ? (after.handoff?.type === 'book' ? 'Hat es mit dem Termin geklappt?' : `Mit ${after.handoff?.type === 'contact' ? after.handoff.person : ''} gesprochen?`) : s.title}</div>
      {!after && <div className="hint-text">{s.text}</div>}
      {askPhone ? (
        <div className="row add">
          <input type="tel" inputMode="tel" autoFocus value={phone} placeholder="Nummer" onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePhone()} />
          <button className="primary" disabled={!phone.trim()} onClick={savePhone}>{s.handoff?.type === 'contact' && s.handoff.channel === 'message' ? 'Schreiben' : 'Anrufen'}</button>
        </div>
      ) : (
        <div className="actions">
          {actions.map((a, i) => <button key={a.id} className={i === 0 ? 'primary' : ''} onClick={() => act(a.id)}>{a.label}</button>)}
          {canListen() && <MicButton onClick={voice} label="Per Sprache antworten" />}
        </div>
      )}
      {heard && <p className="hint-line">„{heard}“{heard !== '…' && !interpretReply(heard, after ? 'due' : s.source) ? ' – sag „ja“, „später“ oder „nein“.' : ''}</p>}
    </Card>
  );
}
