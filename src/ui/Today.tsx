import logoDark from '../assets/logo-dark.svg';
import logoLight from '../assets/logo-light.svg';
import { activeHints, buildBriefing, type Hint } from '../core/briefing/briefing';
import { formatLong, fromISO, WEEKDAY_NAMES, formatShort } from '../core/time/dates';
import { allEvents } from '../core/calendar/feeds';
import { DEADLINE_KINDS } from '../core/deadlines/deadlines';
import { runAction } from './actions';
import { usePA } from './context';
import { Card, Empty, Section } from './kit';

export function Today({ onOpenProvider, onFind }: { onOpenProvider: (id: string) => void; onFind: () => void }) {
  const { store, today, refresh } = usePA();
  const b = buildBriefing({
    orders: store.list('order'), deadlines: store.list('deadline'), providers: store.list('provider'),
    memory: store.list('memory'), events: allEvents(store),
  }, today);
  const active = activeHints(b);
  const quiet = b.decisions.slice(active.length);

  const act = (h: Hint, id: Parameters<typeof runAction>[2]) => {
    if (id === 'book') {
      const o = store.get('order', h.target.id);
      if (o?.providerId) onOpenProvider(o.providerId);
      return;
    }
    runAction(store, h, id, today);
    refresh();
  };

  return (
    <div className="screen">
      <img className="brand-logo on-light" src={logoLight} alt="Parto PA" />
      <img className="brand-logo on-dark" src={logoDark} alt="" aria-hidden="true" />
      <header className="hero">
        <div className="hero-day">{WEEKDAY_NAMES[fromISO(today).getDay()]}</div>
        <div className="hero-date">{formatLong(today)}</div>
        <p className="hero-sum">
          {b.decisions.length === 0 ? 'Nichts wartet auf dich. PA behält alles im Blick.'
            : `${b.decisions.length} ${b.decisions.length === 1 ? 'Sache wartet' : 'Sachen warten'} auf dich, ${b.paHandles.length} erledigt PA.`}
        </p>
      </header>
      <button className="find" onClick={onFind}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3" /></svg>
        <span><b>Termin, Tisch, Tickets …</b><br /><span className="meta">Sag, was du brauchst. PA prüft deine Favoriten.</span></span>
      </button>

      <Section title="Wartet auf dich">
        {active.length === 0 && <Empty>Keine Entscheidungen heute.</Empty>}
        {active.map((h) => <HintCard key={h.key} h={h} onAction={(id) => act(h, id)} />)}
        {quiet.length > 0 && (
          <details className="more">
            <summary>{quiet.length} weitere im Briefing</summary>
            {quiet.map((h) => <HintCard key={h.key} h={h} onAction={(id) => act(h, id)} />)}
          </details>
        )}
      </Section>

      <Section title="Heute im Kalender">
        {b.events.length === 0 ? <Empty>Keine Termine.</Empty> : (
          <ul className="list">
            {b.events.map((e) => (
              <li key={e.id} className={e.tentative ? 'tentative' : ''}>
                <span className="time">{e.start ?? 'ganztags'}</span>{e.title}{e.tentative && <em> · vorläufig</em>}{feedOf(e) && <em className="muted"> · {feedOf(e)}</em>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Heute erledigt PA">
        {b.paHandles.length === 0 ? <Empty>Noch keine offenen Aufträge.</Empty> : (
          <ul className="list check">{b.paHandles.map((t, i) => <li key={i}>{t}</li>)}</ul>
        )}
      </Section>

      {b.upcoming.length > 0 && (
        <Section title="Fristen demnächst">
          <ul className="list">
            {b.upcoming.map((d) => (
              <li key={d.id}><span className="time">{formatShort(d.dueDate, today)}</span>{d.title}
                {DEADLINE_KINDS[d.kind].health && <em> · Gesundheit</em>}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function HintCard({ h, onAction }: { h: Hint; onAction: (id: Hint['actions'][number]['id']) => void }) {
  return (
    <Card tone={h.priority >= 80 ? 'warn' : 'accent'}>
      <div className="hint-title">{h.title}</div>
      <div className="hint-text">{h.text}</div>
      <div className="actions">
        {h.actions.map((a, i) => (
          <button key={a.id} className={i === 0 ? 'primary' : ''} onClick={() => onAction(a.id)}>{a.label}</button>
        ))}
      </div>
    </Card>
  );
}

const feedOf = (e: object): string | undefined => (e as { feed?: string }).feed;
