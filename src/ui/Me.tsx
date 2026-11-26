import { useState } from 'react';
import { CATEGORY_LABEL as MEM_LABEL, createMemory } from '../core/memory/memory';
import { stamp, type BookingWay, type Provider, type ProviderCategory } from '../core/model';
import { CATEGORY_LABEL, WAY_LABEL } from '../core/providers/contact';
import { formatShort, type Unit } from '../core/time/dates';
import { usePA } from './context';
import { Empty, Field, Section } from './kit';
import { syncProviderOrder } from './providers';
import { loadDemo } from './demo';
import { Account } from './Account';
import { ShoppingSettings } from './Shopping';
import { Favourites } from './Favourites';
import type { FavKind } from '../core/favourites/model';

export function Me({ onOpenProvider, onOpenBasket, onFind }: { onOpenProvider: (id: string) => void; onOpenBasket: (id: string) => void; onFind: (kind: FavKind, topic: string | null) => void }) {
  const { store, refresh } = usePA();
  const [name, setName] = useState(store.getMeta('name') ?? '');
  const [sure, setSure] = useState(false);
  return (
    <div className="screen">
      <h1>Ich</h1>
      <Account />
      <Section title="Mein Name">
        <div className="form">
          <Field label="Für Unterschrift in E-Mails">
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { store.setMeta('name', name.trim()); refresh(); }} />
          </Field>
        </div>
      </Section>
      <Favourites onCheck={onFind} />
      <Providers onOpen={onOpenProvider} />
      <ShoppingSettings onOpen={onOpenBasket} />
      <Memory />
      <Section title="Daten">
        <div className="actions wrap">
          <button onClick={() => { loadDemo(store); refresh(); }}>Beispieldaten laden</button>
          {!sure
            ? <button className="danger" onClick={() => setSure(true)}>Alles vergessen</button>
            : <>
                <button className="danger" onClick={() => { store.forgetAll(); setSure(false); refresh(); }}>Ja, Gedächtnis und Memos löschen</button>
                <button onClick={() => setSure(false)}>Abbrechen</button>
              </>}
        </div>
        <p className="hint-line">„Alles vergessen“ löscht Gedächtnis und Memos auf einmal. Aufträge, Termine und Fristen bleiben.</p>
      </Section>
    </div>
  );
}

const EMPTY = { name: '', category: 'beauty' as ProviderCategory, service: '', phone: '', email: '', website: '', bookingWay: 'phone' as BookingWay, everyN: '', everyUnit: 'week' as Unit, lastVisit: '', contactPerson: '' };

function Providers({ onOpen }: { onOpen: (id: string) => void }) {
  const { store, today, refresh } = usePA();
  const [f, setF] = useState<typeof EMPTY | null>(null);
  const list = store.list('provider').sort((a, b) => a.name.localeCompare(b.name));
  const set = (patch: Partial<typeof EMPTY>) => setF((x) => x && { ...x, ...patch });
  const or = (s: string) => s.trim() || null;

  const save = () => {
    if (!f) return;
    const p = store.save('provider', stamp<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>({
      name: f.name.trim(), category: f.category, service: or(f.service), phone: or(f.phone), email: or(f.email), website: or(f.website),
      bookingWay: f.bookingWay, everyN: f.everyN ? Number(f.everyN) : null, everyUnit: f.everyN ? f.everyUnit : null,
      lastVisit: or(f.lastVisit), contactPerson: or(f.contactPerson), notes: null,
    }));
    syncProviderOrder(store, p);
    setF(null); refresh();
  };

  return (
    <Section title="Meine Dienstleister" aside={!f && <button className="link" onClick={() => setF(EMPTY)}>+ Neu</button>}>
      {list.length === 0 && !f && <Empty>Friseur, Maniküre, Werkstatt, Installateur: Kontakt, Buchungsweg und üblicher Abstand.</Empty>}
      <ul className="list">
        {list.map((p) => (
          <li key={p.id}>
            <span className="grow">
              <button className="link strong" onClick={() => onOpen(p.id)}>{p.name}</button>
              <span className="meta"> · {CATEGORY_LABEL[p.category]}{p.service ? ` · ${p.service}` : ''}
                {p.everyN ? ` · alle ${p.everyN} ${p.everyUnit === 'week' ? 'Wochen' : p.everyUnit === 'month' ? 'Monate' : 'Jahre'}` : ''}
                {p.lastVisit ? ` · zuletzt ${formatShort(p.lastVisit, today)}` : ''}</span>
            </span>
            <button className="link" onClick={() => { store.remove('provider', p.id); syncProviderOrder(store, { ...p, everyN: null }); refresh(); }}>Löschen</button>
          </li>
        ))}
      </ul>
      {f && (
        <div className="form">
          <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Studio Nails" /></Field>
          <div className="row">
            <Field label="Bereich">
              <select value={f.category} onChange={(e) => set({ category: e.target.value as ProviderCategory })}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Leistung"><input value={f.service} onChange={(e) => set({ service: e.target.value })} placeholder="Maniküre Gel" /></Field>
          </div>
          <div className="row">
            <Field label="Telefon"><input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="E-Mail"><input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          </div>
          <Field label="Buchungsseite"><input value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="fresha.com/…" /></Field>
          <div className="row">
            <Field label="Bucht am besten per">
              <select value={f.bookingWay} onChange={(e) => set({ bookingWay: e.target.value as BookingWay })}>
                {Object.entries(WAY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Ansprechperson"><input value={f.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} /></Field>
          </div>
          <div className="row">
            <Field label="Üblich alle"><input type="number" min={1} value={f.everyN} onChange={(e) => set({ everyN: e.target.value })} placeholder="6" /></Field>
            <Field label="&nbsp;">
              <select value={f.everyUnit} onChange={(e) => set({ everyUnit: e.target.value as Unit })}>
                <option value="week">Wochen</option><option value="month">Monate</option><option value="year">Jahre</option>
              </select>
            </Field>
            <Field label="Zuletzt dort"><input type="date" value={f.lastVisit} onChange={(e) => set({ lastVisit: e.target.value })} /></Field>
          </div>
          <div className="actions">
            <button onClick={() => setF(null)}>Abbrechen</button>
            <button className="primary" disabled={!f.name.trim()} onClick={save}>Speichern</button>
          </div>
        </div>
      )}
    </Section>
  );
}

function Memory() {
  const { store, refresh } = usePA();
  const [text, setText] = useState('');
  const list = store.list('memory').slice().reverse();
  return (
    <Section title="Was PA über mich weiß">
      {list.length === 0 && <Empty>Noch nichts. PA lernt nichts heimlich: neue Einträge kommen nur von dir oder als Vorschlag zum Bestätigen.</Empty>}
      <ul className="list">
        {list.map((m) => (
          <li key={m.id}>
            <span className="grow">{m.text}<span className="meta"> · <span className={`tag ${m.category}`}>{MEM_LABEL[m.category]}</span> · {m.source}</span></span>
            <button className="link" onClick={() => { store.remove('memory', m.id); refresh(); }}>Löschen</button>
          </li>
        ))}
      </ul>
      <div className="row add">
        <input value={text} placeholder="z. B. „Nie vor 9 Uhr“" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { store.save('memory', createMemory(text, 'von Hand')); setText(''); refresh(); } }} />
        <button disabled={!text.trim()} onClick={() => { store.save('memory', createMemory(text, 'von Hand')); setText(''); refresh(); }}>Merken</button>
      </div>
      <p className="hint-line">Einträge der Art „Gesundheit“ gehen auch später nie an die KI.</p>
    </Section>
  );
}
