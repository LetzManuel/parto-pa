import { useState } from 'react';
import { DEADLINE_KINDS, createDeadline, remindFrom } from '../core/deadlines/deadlines';
import type { DeadlineKind, Order } from '../core/model';
import { cancel, complete, isActive, markRequested, nextOccurrence } from '../core/orders/flow';
import { formatShort } from '../core/time/dates';
import { usePA } from './context';
import { Card, Chip, Empty, Field, Section } from './kit';

const KIND_LABEL: Record<Order['kind'], string> = {
  reminder: 'Erinnerung', location: 'Am Ort', followup: 'Nachfassen', conditional: 'Wenn-dann', recurring: 'Wiederkehrend', birthday: 'Geburtstag',
};

export function Orders() {
  const [tab, setTab] = useState<'orders' | 'deadlines'>('orders');
  return (
    <div className="screen">
      <h1>Aufträge</h1>
      <div className="chips">
        <Chip active={tab === 'orders'} onClick={() => setTab('orders')}>Aufträge</Chip>
        <Chip active={tab === 'deadlines'} onClick={() => setTab('deadlines')}>Fristen</Chip>
      </div>
      {tab === 'orders' ? <OrderList /> : <Deadlines />}
    </div>
  );
}

function OrderList() {
  const { store, today, refresh } = usePA();
  const all = store.list('order');
  const providers = store.list('provider');
  const active = all.filter(isActive).sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const closed = all.filter((o) => !isActive(o)).slice(-10).reverse();
  const save = (o: Order) => { store.save('order', o); refresh(); };

  const when = (o: Order) => {
    if (o.kind === 'recurring') { const n = nextOccurrence(o); return n ? `wieder ${formatShort(n, today)}` : ''; }
    if (o.kind === 'location') return `bei ${o.place}`;
    return o.dueDate ? formatShort(o.dueDate, today) : '';
  };

  return (
    <>
      <Section title={`Offen (${active.length})`}>
        {active.length === 0 && <Empty>Keine offenen Aufträge. Tippe auf + und sprich oder schreib ein Memo.</Empty>}
        {active.map((o) => (
          <Card key={o.id} tone="quiet">
            <div className="order-row">
              <div>
                <div className="hint-title">{o.title}</div>
                <div className="meta">
                  {KIND_LABEL[o.kind]} · {o.state === 'waiting' ? 'wartet auf Antwort' : 'offen'}
                  {when(o) && ` · ${when(o)}`}
                  {o.providerId && ` · ${providers.find((p) => p.id === o.providerId)?.name ?? ''}`}
                </div>
                {o.fallback && <div className="meta">Plan B: {o.fallback}</div>}
                {o.source && <div className="meta subtle">{o.source}</div>}
              </div>
            </div>
            <div className="actions">
              {o.state === 'open' && o.kind !== 'location' && o.kind !== 'birthday' &&
                <button onClick={() => save(markRequested(o, today))}>Angefragt</button>}
              <button className="primary" onClick={() => save(complete(o, today))}>Erledigt</button>
              <button onClick={() => save(cancel(o))}>Abbrechen</button>
            </div>
          </Card>
        ))}
      </Section>
      {closed.length > 0 && (
        <Section title="Zuletzt abgeschlossen">
          <ul className="list">{closed.map((o) => <li key={o.id} className="done">{o.title} <em>· {o.state === 'done' ? 'erledigt' : 'abgebrochen'}</em></li>)}</ul>
        </Section>
      )}
    </>
  );
}

function Deadlines() {
  const { store, today, refresh } = usePA();
  const [kind, setKind] = useState<DeadlineKind>('pickerl');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const list = store.list('deadline').sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const add = () => {
    store.save('deadline', createDeadline({ kind, title, dueDate: date }));
    setTitle(''); setDate(''); refresh();
  };

  return (
    <>
      <Section title="Fristen">
        {list.length === 0 && <Empty>Pickerl, Reisepass, Garantie, Kündigungsfristen: PA meldet sich rechtzeitig.</Empty>}
        <ul className="list">
          {list.map((d) => (
            <li key={d.id}>
              <span className="time">{formatShort(d.dueDate, today)}</span>
              <span className="grow">{d.title}{DEADLINE_KINDS[d.kind].health && <em> · Gesundheit</em>}
                <span className="meta"> · erinnert ab {formatShort(remindFrom(d), today)}{d.everyN ? `, alle ${d.everyN} ${d.everyUnit === 'year' ? (d.everyN === 1 ? 'Jahr' : 'Jahre') : 'Monate'}` : ''}</span>
              </span>
              <button className="link" onClick={() => { store.remove('deadline', d.id); refresh(); }}>Löschen</button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Neue Frist">
        <div className="form">
          <Field label="Art">
            <select value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)}>
              {Object.entries(DEADLINE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Bezeichnung (optional)"><input value={title} placeholder={DEADLINE_KINDS[kind].label} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Läuft ab am"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {DEADLINE_KINDS[kind].hint && <p className="hint-line">{DEADLINE_KINDS[kind].hint}</p>}
          <div className="actions"><button className="primary" disabled={!date} onClick={add}>Frist anlegen</button></div>
        </div>
      </Section>
    </>
  );
}
