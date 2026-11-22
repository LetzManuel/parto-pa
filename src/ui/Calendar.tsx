import { useState } from 'react';
import { stamp } from '../core/model';
import { addDays, formatShort } from '../core/time/dates';
import { usePA } from './context';
import { Empty, Field, Section } from './kit';

/** Phase 1 keeps a simple own calendar. Import (Google, Apple, Outlook, ICS) comes with the shared core. */
export function Calendar() {
  const { store, today, refresh } = usePA();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const until = addDays(today, 14);
  const events = store.list('event').filter((e) => e.date >= today && e.date <= until)
    .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
  const days = [...new Set(events.map((e) => e.date))];

  const add = () => {
    store.save('event', stamp({ title: title.trim(), date, start: start || null, end: end || null, tentative: false, orderId: null }));
    setTitle(''); setStart(''); setEnd(''); refresh();
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
                  <span className="grow">{e.title}{e.tentative && <em> · vorläufig</em>}</span>
                  <button className="link" onClick={() => { store.remove('event', e.id); refresh(); }}>Löschen</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
      <Section title="Neuer Termin">
        <div className="form">
          <Field label="Titel"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="row">
            <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
          <div className="actions"><button className="primary" disabled={!title.trim() || !date} onClick={add}>Eintragen</button></div>
        </div>
      </Section>
    </div>
  );
}
