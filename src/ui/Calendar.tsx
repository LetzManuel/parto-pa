import { useState } from 'react';
import { addFeed, allEvents, listFeeds, removeFeed } from '../core/calendar/feeds';
import { stamp } from '../core/model';
import { refreshFeeds } from '../platform/calendar';
import { addDays, formatShort } from '../core/time/dates';
import { usePA } from './context';
import { Empty, Field, Section } from './kit';

/** Own events (synced) plus subscribed calendars (ICS links from Google, Outlook, Apple; read-only, on this device). */
export function Calendar() {
  const { store, today, refresh } = usePA();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [where, setWhere] = useState('');
  const until = addDays(today, 14);
  const events = allEvents(store).filter((e) => e.date >= today && e.date <= until)
    .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
  const days = [...new Set(events.map((e) => e.date))];

  const add = () => {
    store.save('event', stamp({ title: title.trim(), date, start: start || null, end: end || null, tentative: false, orderId: null, location: where.trim() || null }));
    setTitle(''); setStart(''); setEnd(''); setWhere(''); refresh();
  };

  return (
    <div className="screen">
      <h1>Kalender</h1>
      <Section title="Nächste zwei Wochen">
        {days.length === 0 && <Empty>Keine Termine.</Empty>}
        {days.map((d) => (
          <div key={d} className="day">
            <div className="day-head">{formatShort(d, today)}</div>
            <ul className="list">
              {events.filter((e) => e.date === d).map((e) => (
                <li key={e.id} className={e.tentative ? 'tentative' : ''}>
                  <span className="time">{e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : 'ganztags'}</span>
                  <span className="grow">{e.title}{e.tentative && <em> · vorläufig</em>}{e.location && <em> · {e.location}</em>}{e.feed && <em className="muted"> · {e.feed}</em>}</span>
                  {!e.feed && <button className="link" onClick={() => { store.remove('event', e.id); refresh(); }}>Löschen</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Feeds />
      <Section title="Neuer Termin">
        <div className="form">
          <Field label="Titel"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="row">
            <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <Field label="Ort (mit Adresse rechnet PA, wann du los musst)"><input value={where} placeholder="z. B. Mariahilfer Straße 1, 1060 Wien" onChange={(e) => setWhere(e.target.value)} /></Field>
          <div className="actions"><button className="primary" disabled={!title.trim() || !date} onClick={add}>Eintragen</button></div>
        </div>
      </Section>
    </div>
  );
}

/** Subscribed calendars: link in, PA reads it every 30 minutes. The link stays on this device. */
function Feeds() {
  const { store, today, refresh } = usePA();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const feeds = listFeeds(store);
  const valid = /^(https|webcals?):\/\/\S+$/i.test(url.trim());

  const load = async () => {
    setBusy(true);
    try { await refreshFeeds(store, today); } finally { setBusy(false); refresh(); }
  };
  const add = async () => {
    addFeed(store, label, url);
    setLabel(''); setUrl('');
    await load();
  };

  return (
    <Section title="Verbundene Kalender">
      {feeds.length === 0 && <Empty>Noch keiner. Mit einem Kalender-Link sieht PA deine echten freien Zeiten.</Empty>}
      <ul className="list">
        {feeds.map((f) => (
          <li key={f.id}>
            <span className="grow">
              {f.label}
              <em className="muted"> · {f.error ?? (f.fetchedAt ? `${f.count} Termine` : 'wird geladen …')}</em>
            </span>
            <button className="link" onClick={() => { removeFeed(store, f.id); refresh(); }}>Trennen</button>
          </li>
        ))}
      </ul>
      {feeds.length > 0 && <div className="actions"><button disabled={busy} onClick={load}>{busy ? 'Lädt …' : 'Jetzt aktualisieren'}</button></div>}
      <div className="form">
        <Field label="Name"><input value={label} placeholder="z. B. Arbeit" onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Kalender-Link (ICS)"><input value={url} inputMode="url" placeholder="https://… oder webcal://…" onChange={(e) => setUrl(e.target.value)} /></Field>
        <p className="hint">Google: Einstellungen › Kalender › „Privatadresse im iCal-Format“. Outlook: Einstellungen › Kalender ›
          Freigegebene Kalender › Kalender veröffentlichen › ICS-Link. Apple: Kalender teilen › Öffentlicher Kalender.
          Der Link bleibt auf diesem Gerät.</p>
        <div className="actions"><button className="primary" disabled={!valid || busy} onClick={add}>Verbinden</button></div>
      </div>
    </Section>
  );
}
