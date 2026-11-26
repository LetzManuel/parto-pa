// "Als Nächstes" on Heute: the next appointment in one glance, when to leave and one button (navigation or join).
// The mode chips change the way for this appointment only.
import { hhmm, type EventPlan } from '../core/reminders/plan';
import { getPrefs, MODE_LABEL, MODE_WITH, MODES, setPrefs } from '../core/travel/prefs';
import { plansNow, tick } from '../platform/reminders';
import { usePA } from './context';
import { Chip } from './kit';

const MIN = 60000;

function headline(p: EventPlan, now: number): string {
  if (p.kind !== 'travel') {
    const m = Math.round((p.ev.startMs - now) / MIN);
    return m <= 60 ? `In ${Math.max(m, 0)} Min.` : `Um ${p.ev.start}`;
  }
  if (!p.leaveAtMs) return `Um ${p.ev.start}`;
  if (now >= p.leaveAtMs) return now > p.leaveAtMs + 2 * MIN ? 'Spät dran, jetzt los' : 'Jetzt los';
  const m = Math.round((p.leaveAtMs - now) / MIN);
  return m <= 45 ? `In ${m} Min. los` : `Los um ${hhmm(p.leaveAtMs)}`;
}

function detail(p: EventPlan): string {
  if (p.kind === 'online') return p.ev.location ?? 'Online';
  if (p.kind === 'plain') return p.ev.location ?? 'Ohne Ort';
  if (p.route) {
    return `${p.route.minutes} min ${MODE_WITH[p.mode]}${p.route.summary ? ` · ${p.route.summary}` : ''}${p.route.traffic ? ' · mit Verkehr' : ''}${p.route.source === 'estimate' ? ' · geschätzt' : ''}`;
  }
  if (p.routeError === 'no_origin') return 'Startadresse fehlt: Ich › Wege & Erinnerungen';
  if (p.routeError === 'not_found') return 'Ort nicht gefunden, ich erinnere dich eine Stunde vorher';
  if (p.routeError === 'offline') return 'Kein Netz, ich erinnere dich eine Stunde vorher';
  return 'Weg wird berechnet …';
}

export function NextUp() {
  const { store, today, refresh } = usePA();
  const now = Date.now();
  const plans = plansNow(store, now, 12).filter((p) => p.ev.startMs > now);
  if (!plans.length) return null;
  const [p, ...rest] = plans;
  const after = rest.find((x) => x.ev.date === p.ev.date);
  const prefs = getPrefs(store);
  const late = p.kind === 'travel' && p.leaveAtMs !== undefined && now >= p.leaveAtMs;

  return (
    <div className={`card next ${late ? 'warn' : 'accent'}`} aria-live="polite">
      <div className="next-when">{headline(p, now)}</div>
      <div className="next-what">{p.ev.title} <span className="meta">· {p.ev.date === today ? '' : 'morgen '}{p.ev.start}</span></div>
      <div className="meta">{detail(p)}{late && p.route ? ` · an ca. ${hhmm(now + p.route.minutes * MIN)}` : ''}</div>
      {p.kind === 'travel' && (
        <div className="chips tight" role="group" aria-label="Weg zu diesem Termin">
          {MODES.map((m) => (
            <Chip key={m} active={p.mode === m} onClick={() => { setPrefs(store, { eventModes: { ...prefs.eventModes, [p.ev.key]: m } }, today); refresh(); tick(store).then(refresh).catch(() => {}); }}>{MODE_LABEL[m]}</Chip>
          ))}
        </div>
      )}
      {p.action && (
        <div className="actions">
          <a className="button primary" href={p.action.url} target="_blank" rel="noreferrer">{p.action.label}</a>
        </div>
      )}
      {after && (
        <div className="meta next-after">Danach: {after.ev.start} {after.ev.title}{after.leaveAtMs ? `, los um ${hhmm(after.leaveAtMs)}` : ''}</div>
      )}
    </div>
  );
}
