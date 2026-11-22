import { useState } from 'react';
import type { Store } from '../core/db/store';
import { Calendar } from './Calendar';
import { Capture } from './Capture';
import { Provider, usePA } from './context';
import { Me } from './Me';
import { Orders } from './Orders';
import { ProviderSheet } from './ProviderSheet';
import { Today } from './Today';

type Tab = 'today' | 'calendar' | 'capture' | 'orders' | 'me';

const TABS: Array<[Tab, string, string]> = [
  ['today', 'Heute', 'M4 6h16M4 12h10M4 18h7'],
  ['calendar', 'Kalender', 'M5 5h14v14H5zM5 9h14M9 3v4M15 3v4'],
  ['capture', '', 'M12 5v14M5 12h14'],
  ['orders', 'Aufträge', 'M5 6l2 2 4-4M5 13l2 2 4-4M13 7h6M13 14h6M5 20h14'],
  ['me', 'Ich', 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 20c1.5-4 4.5-6 8-6s6.5 2 8 6'],
];

export function App({ store }: { store: Store }) {
  return <Provider store={store}><Shell /></Provider>;
}

function Shell() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('tab') as Tab) || 'today');
  const [sheet, setSheet] = useState<string | null>(null);
  usePA(); // re-render on data changes
  return (
    <div className="app">
      <main>
        {tab === 'today' && <Today onOpenProvider={setSheet} />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'capture' && <Capture onDone={() => setTab('orders')} />}
        {tab === 'orders' && <Orders />}
        {tab === 'me' && <Me onOpenProvider={setSheet} />}
      </main>
      <nav className="tabbar">
        {TABS.map(([id, label, d]) => (
          <button key={id} className={`${tab === id ? 'on' : ''} ${id === 'capture' ? 'plus' : ''}`} onClick={() => setTab(id)} aria-label={label || 'Neues Memo'}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
            {label && <span>{label}</span>}
          </button>
        ))}
      </nav>
      {sheet && <ProviderSheet id={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
