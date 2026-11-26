import { useEffect, useRef, useState } from 'react';
import { allEvents } from '../core/calendar/feeds';
import { checkInOrder, listFor, proposal, spokenSummary, type Outcome } from '../core/favourites/check';
import { handoffActions, requestText, windowText } from '../core/favourites/handoff';
import { addAppointment } from '../core/calendar/appointments';
import { useFlows } from './flows';
import type { Favourite } from '../core/favourites/model';
import { KIND_LABEL, KIND_NOUN, type BookingRequest, type FavKind, type Slot } from '../core/favourites/model';
import { parseRequest } from '../core/favourites/request';
import { kindWords } from '../core/anbieter/lists';
import { createOrder, markRequested } from '../core/orders/flow';
import { addDays, formatShort } from '../core/time/dates';
import { slotContext } from '../platform/slots';
import { usePA } from './context';
import { Card, Chip, Field } from './kit';
import { canListen, listen, speak, stopSpeaking } from './voice';

export interface FinderStart { text?: string; kind?: FavKind; topic?: string | null }

const KINDS = Object.keys(KIND_LABEL) as FavKind[];
const ICON_MIC = 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3';

/**
 * "Sag, was du brauchst": one spoken sentence in, PA checks the favourites in order, one card out with the best
 * slot and one button to finish the booking in the other app. Made for the phone in one hand, on the go.
 */
export function Finder({ start, onClose }: { start: FinderStart; onClose: () => void }) {
  const { store, today, refresh } = usePA();
  const [text, setText] = useState(start.text ?? '');
  const [req, setReq] = useState<BookingRequest | null>(null);
  const [listening, setListening] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [talk, setTalk] = useState(store.getMeta('voice:speak') !== '0');
  const stop = useRef<() => void>(() => {});
  const favs = store.list('favourite');
  const sender = store.getMeta('name') ?? '';

  const run = async (r: BookingRequest, all = false) => {
    setReq(r); setOutcomes([]); setBusy(true); setDone(null);
    const list = listFor(favs, r);
    const out = await checkInOrder(list, r, slotContext(today), {
      all, busy: allEvents(store, { busyOnly: true }),
      onProgress: (o) => setOutcomes((x) => [...(x ?? []), o]),
    });
    setOutcomes(out); setBusy(false);
    if (talk) void speak(spokenSummary(out, r, today));
  };

  const understand = (t: string, kind?: FavKind) => {
    const r = parseRequest(t, today, kind ?? start.kind, kindWords(favs));
    if (!r) { setReq(null); setEdit(true); return; }
    if (start.topic && !r.topic) r.topic = start.topic;
    void run(r);
  };

  const mic = () => {
    if (listening) { stop.current(); return; }
    setListening(true); setOutcomes(null); setDone(null);
    stop.current = listen(setText, (t) => { setListening(false); if (t) understand(t); });
  };

  // Opening the finder starts listening right away (or checks the sentence it was opened with).
  useEffect(() => {
    if (start.text) understand(start.text);
    else if (start.kind) void run(parseRequest(KIND_NOUN[start.kind], today, start.kind)!);
    else if (canListen()) mic();
    return () => { stop.current(); stopSpeaking(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const best = outcomes && !busy ? proposal(outcomes) : null;
  const set = (patch: Partial<BookingRequest>) => setReq((r) => r && { ...r, ...patch });

  const booked = (slot: Slot | null) => {
    if (!best || !req) return;
    const title = `${req.kind === 'tickets' && slot?.label ? slot.label : KIND_NOUN[req.kind]} · ${best.fav.name}`;
    if (slot) {
      const len = best.fav.durationMin ?? (req.kind === 'restaurant' ? 120 : 60);
      const m = Number(slot.start.slice(0, 2)) * 60 + Number(slot.start.slice(3)) + len;
      const end = `${String(Math.min(23, Math.floor(m / 60))).padStart(2, '0')}:${String(m >= 24 * 60 ? 59 : m % 60).padStart(2, '0')}`;
      addAppointment(store, { title, date: slot.date, start: slot.start, end, subject: req.kind === 'salon' ? 'friseur' : null });
      setDone(`Im Kalender: ${formatShort(slot.date, today)} ${slot.start}.`);
    } else {
      const o = createOrder({ title: `${KIND_NOUN[req.kind]} bei ${best.fav.name}`, kind: 'followup', source: 'aus Meine Anbieter', note: requestText(best.fav, req, today) });
      store.save('order', markRequested(o, today, best.fav.name));
      setDone('Angefragt. PA fasst nach, wenn bis übermorgen (Werktage) nichts kommt.');
    }
    refresh();
  };

  // Babysitter and doctors: ask by message with the shared templates (read back, "senden"), not a bare link.
  const flows = useFlows();
  const viaMessage = (f: Favourite, r: BookingRequest) => !!flows && !!f.phone && (r.kind === 'babysitter' || r.kind === 'doctor');
  const writeMessage = (f: Favourite, r: BookingRequest) => {
    if (!flows) return;
    const formal = r.kind !== 'babysitter';
    flows.openMessage({
      recipient: { key: `favourite:${f.id}`, name: f.name, formal, phone: f.phone, email: null, channel: r.kind === 'babysitter' ? 'whatsapp' : 'sms', service: r.topic ?? undefined },
      template: r.kind === 'babysitter' ? 'availability' : 'request', when: windowText(r, today), body: '', voice: true,
    }, () => {
      const o = createOrder({ title: `${KIND_NOUN[r.kind]} bei ${f.name}`, kind: 'followup', source: 'aus Meine Anbieter', note: requestText(f, r, today) });
      store.save('order', markRequested(o, today, f.name));
      refresh();
    });
  };

  const planCall = () => {
    if (!best || !req) return;
    store.save('order', createOrder({ title: `Anrufen: ${best.fav.name}${best.fav.phone ? ` (${best.fav.phone})` : ''}`, kind: 'reminder', dueDate: today,
      source: 'aus Meine Anbieter', note: requestText(best.fav, req, today) }));
    refresh();
    setDone('Anruf für heute eingeplant, mit Spickzettel.');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet finder" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Bei meinen Anbietern prüfen</h2>
          <button className="link" onClick={onClose}>Schließen</button>
        </div>

        <div className="ask">
          <button className={`mic ${listening ? 'on' : ''}`} onClick={mic} aria-label={listening ? 'Zuhören beenden' : 'Sprechen'} disabled={!canListen()}>
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_MIC} /></svg>
          </button>
          <input className="ask-text" value={text} placeholder={listening ? 'Ich höre zu …' : '„Friseur morgen 14 bis 17 Uhr“'}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) understand(text); }} />
        </div>

        {req && (
          <div className="understood">
            <span><b>{req.topic ?? KIND_LABEL[req.kind]}</b> · {req.dateFrom === req.dateTo ? formatShort(req.dateFrom, today) : `${formatShort(req.dateFrom, today)} – ${formatShort(req.dateTo, today)}`}
              {req.to >= '23:59' ? (req.from > '00:00' ? ` · ab ${req.from}` : '') : ` · ${req.from}–${req.to}`}{req.people && req.kind !== 'salon' ? ` · ${req.people} ${req.kind === 'tickets' ? 'Tickets' : 'Pers.'}` : ''}{req.keyword ? ` · ${req.keyword}` : ''}</span>
            <button className="link" onClick={() => setEdit((x) => !x)}>{edit ? 'Fertig' : 'Ändern'}</button>
          </div>
        )}

        {edit && (
          <div className="form">
            <div className="chips">{KINDS.map((k) => <Chip key={k} active={req?.kind === k} onClick={() => setReq(parseRequest(text || KIND_NOUN[k], today, k))}>{KIND_LABEL[k]}</Chip>)}</div>
            {req && <>
              <div className="row">
                <Field label="Von Tag"><input type="date" value={req.dateFrom} onChange={(e) => set({ dateFrom: e.target.value, dateTo: e.target.value > req.dateTo ? e.target.value : req.dateTo })} /></Field>
                <Field label="Bis Tag"><input type="date" value={req.dateTo} onChange={(e) => set({ dateTo: e.target.value })} /></Field>
              </div>
              <div className="row">
                <Field label="Frühestens"><input type="time" value={req.from} onChange={(e) => set({ from: e.target.value })} /></Field>
                <Field label="Spätestens"><input type="time" value={req.to} onChange={(e) => set({ to: e.target.value })} /></Field>
                {(req.kind === 'restaurant' || req.kind === 'tickets') && <Field label={req.kind === 'tickets' ? 'Tickets' : 'Personen'}><input type="number" min={1} value={req.people ?? 1} onChange={(e) => set({ people: Number(e.target.value) })} /></Field>}
              </div>
              {req.kind === 'tickets' && <Field label="Künstler oder Event"><input value={req.keyword ?? ''} onChange={(e) => set({ keyword: e.target.value || null })} /></Field>}
              {req.kind === 'doctor' && <Field label="Fachrichtung"><input value={req.topic ?? ''} placeholder="Zahnarzt" onChange={(e) => set({ topic: e.target.value || null })} /></Field>}
              <div className="actions"><button className="primary" onClick={() => { setEdit(false); void run(req); }}>Prüfen</button></div>
            </>}
          </div>
        )}

        {outcomes && req && listFor(favs, req).length === 0 && (
          <Card tone="warn">Für {req.topic ?? KIND_LABEL[req.kind]} hast du noch niemanden eingetragen. Lege sie unter <b>Ich › Meine Anbieter</b> an.</Card>
        )}

        {outcomes && outcomes.length > 0 && (
          <ol className="checked">
            {outcomes.map((o) => (
              <li key={o.fav.id} className={o.result.status}>
                <span className="grow">{o.fav.name}</span>
                <span className="meta">{o.result.status === 'slots' ? `${o.result.slots.length} frei` : o.result.status === 'full' ? 'nichts frei' : o.result.status === 'manual' ? (req?.kind === 'babysitter' ? 'fragen' : 'selbst ansehen') : 'nicht erreichbar'}</span>
              </li>
            ))}
            {busy && <li className="meta">prüfe …</li>}
          </ol>
        )}

        {best && req && (
          <Card tone="accent">
            <div className="meta">{best.slot ? 'Vorschlag' : req.kind === 'babysitter' ? 'Zuerst fragen' : 'Hier kann PA nicht nachsehen'}</div>
            <div className="proposal">{best.fav.name}{best.slot && <> · {req.kind === 'tickets' && best.slot.label ? `${best.slot.label}, ` : ''}{formatShort(best.slot.date, today)} {best.slot.start !== '00:00' && best.slot.start}</>}</div>
            {best.more.length > 0 && <div className="meta">Auch: {best.more.slice(0, 4).map((s) => (s.date === best.slot?.date ? s.start : `${formatShort(s.date, today)} ${s.start}`)).join(', ')}</div>}
            {!best.slot && <div className="say">„{requestText(best.fav, req, today, sender)}“</div>}
            <div className="actions wrap">
              {viaMessage(best.fav, req) && <button className="primary big" onClick={() => writeMessage(best.fav, req)}>Nachricht an {best.fav.name.split(' ')[0]}</button>}
              {handoffActions(best.fav, req, today, best.slot, sender).filter((a) => !(viaMessage(best.fav, req) && (a.kind === 'whatsapp' || a.kind === 'sms'))).map((a, i) => (
                <a key={a.kind} className={`button ${i === 0 && !viaMessage(best.fav, req) ? 'primary big' : ''}`} href={a.url} target={a.kind === 'book' || a.kind === 'web' || a.kind === 'whatsapp' ? '_blank' : undefined} rel="noreferrer">{a.label}</a>
              ))}
            </div>
            <div className="actions wrap">
              {best.slot ? <button onClick={() => booked(best.slot)}>Gebucht, in den Kalender</button>
                : <>
                    <button onClick={() => booked(null)}>Angefragt, warte auf Antwort</button>
                    {best.fav.phone && req.kind !== 'babysitter' && <button onClick={planCall}>Anruf einplanen</button>}
                  </>}
            </div>
          </Card>
        )}
        {outcomes && !busy && outcomes.length > 0 && !best && <Card tone="warn">Bei deinen Anbietern ist im gewünschten Zeitraum nichts frei.</Card>}
        {outcomes && !busy && req && outcomes.length < listFor(favs, req).length && (
          <button className="link" onClick={() => void run(req, true)}>Auch die anderen prüfen</button>
        )}
        {req && !busy && outcomes && !best && (
          <button className="link" onClick={() => void run({ ...req, dateFrom: addDays(req.dateTo, 1), dateTo: addDays(req.dateTo, 1 + (req.dateTo > req.dateFrom ? 6 : 0)) }, true)}>Am nächsten Tag weiter suchen</button>
        )}
        {done && <p className="ok">{done}</p>}

        <label className="remember">
          <input type="checkbox" checked={talk} onChange={(e) => { setTalk(e.target.checked); store.setMeta('voice:speak', e.target.checked ? '1' : '0'); }} />
          Ergebnis vorlesen
        </label>
        <p className="hint-line">PA bucht, kauft und sendet nichts selbst. Du schließt mit einem Tipp in der Buchungsseite, am Telefon oder in WhatsApp ab.</p>
      </div>
    </div>
  );
}
