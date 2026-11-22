import { useState } from 'react';
import { allEvents } from '../core/calendar/feeds';
import { describeWindows, freeWindows } from '../core/calendar/free';
import { createOrder, markRequested } from '../core/orders/flow';
import { mailLink, requestSentence, telLink, webLink, WAY_LABEL } from '../core/providers/contact';
import { addDays } from '../core/time/dates';
import { usePA } from './context';
import { Card, Field } from './kit';
import { recordVisit } from './providers';

/** "Anrufen mit Spickzettel" / e-mail / booking page. PA prepares, the user calls, sends or books. */
export function ProviderSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { store, today, refresh } = usePA();
  const p = store.get('provider', id);
  const [from, setFrom] = useState('17:00');
  const [to, setTo] = useState('20:00');
  const [done, setDone] = useState<string | null>(null);
  if (!p) return null;

  const windows = freeWindows(allEvents(store, { busyOnly: true }), { from: addDays(today, 1), days: 10, dayStart: from, dayEnd: to, minMinutes: 60, skipWeekends: true });
  const sentence = requestSentence(p, describeWindows(windows, today));
  const tel = telLink(p), mail = mailLink(p, sentence, store.getMeta('name') ?? ''), web = webLink(p);

  const requested = () => {
    const existing = store.list('order').find((o) => o.providerId === p.id && o.kind !== 'recurring' && o.state !== 'done' && o.state !== 'cancelled');
    const o = existing ?? createOrder({ title: `Termin bei ${p.name}`, kind: 'followup', providerId: p.id, source: 'aus Meine Dienstleister' });
    store.save('order', markRequested(o, today, p.name));
    refresh();
    setDone('PA fasst nach, wenn bis übermorgen (Werktage) keine Antwort da ist.');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{p.name}</h2>
            <div className="meta">{p.service ?? ''}{p.service ? ' · ' : ''}am besten: {WAY_LABEL[p.bookingWay]}</div>
          </div>
          <button className="link" onClick={onClose}>Schließen</button>
        </div>

        <div className="row">
          <Field label="Frühestens"><input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Spätestens"><input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        <Card tone="accent">
          <div className="meta">Spickzettel</div>
          <div className="say">„{sentence}“</div>
          {p.contactPerson && <div className="meta">Ansprechperson: {p.contactPerson}</div>}
        </Card>

        <div className="actions wrap">
          {tel && <a className="button primary" href={tel}>Anrufen {p.phone}</a>}
          {mail && <a className="button" href={mail}>E-Mail vorbereiten</a>}
          {web && <a className="button" href={web} target="_blank" rel="noreferrer">Buchungsseite öffnen</a>}
        </div>
        <p className="hint-line">PA ruft nicht selbst an und sendet nichts. Die E-Mail öffnet sich in deinem Postfach.</p>

        <div className="actions wrap">
          <button onClick={requested}>Angefragt, warte auf Antwort</button>
          <button onClick={() => { recordVisit(store, p, today); refresh(); setDone('Besuch eingetragen. PA meldet sich zum nächsten Termin.'); }}>Termin steht / war dort</button>
        </div>
        {done && <p className="ok">{done}</p>}
      </div>
    </div>
  );
}
