import { useEffect, useRef, useState } from 'react';
import type { Rhythm } from '../core/model';
import { agoText, dueDate, effectiveLast, interpretReply, intervalText } from '../core/rhythms/engine';
import { describeCommand, parseRhythmSentence, type RhythmCommand } from '../core/rhythms/say';
import { applyCommand, history, logTouch } from '../core/rhythms/touch';
import type { Occurrence } from '../core/rhythms/history';
import { diffDays, formatShort, type Unit } from '../core/time/dates';
import { canListen, listen } from '../platform/speech';
import { usePA } from './context';
import { Empty, Field, Section } from './kit';

export function MicButton({ onClick, label, active }: { onClick: () => void; label: string; active?: boolean }) {
  return (
    <button type="button" className={`mic ${active ? 'on' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}

/** One line to confirm a spoken rhythm sentence: "Anna etwa alle 3 Wochen anrufen. Speichern?" */
export function RhythmConfirm({ command, onSaved, onCancel }: { command: RhythmCommand; onSaved: (msg: string) => void; onCancel?: () => void }) {
  const { store, today, refresh } = usePA();
  const save = () => { const msg = applyCommand(store, command, today); refresh(); onSaved(msg); };
  return (
    <div className="card accent">
      <div className="suggest-label">Rhythmus</div>
      <div className="suggest-title">{describeCommand(command, intervalText, (d) => formatShort(d, today))}</div>
      <div className="actions">
        <button className="primary" onClick={save}>{command.type === 'set' ? 'Speichern' : command.type === 'log' ? 'Eintragen' : 'Ja'}</button>
        {onCancel && <button onClick={onCancel}>Abbrechen</button>}
      </div>
    </div>
  );
}

const UNITS: Array<[Unit, string]> = [['day', 'Tage'], ['week', 'Wochen'], ['month', 'Monate']];

/** "Meine Rhythmen": say one sentence, see what PA keeps an eye on, change or pause it. */
export function Rhythms() {
  const { store, today, refresh } = usePA();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const stopRef = useRef<() => void>();
  useEffect(() => () => stopRef.current?.(), []);

  const command = text.trim() ? parseRhythmSentence(text, today) : null;
  const hist = history(store, today);
  const list = store.list('rhythm').filter((r) => r.status !== 'dismissed')
    .sort((a, b) => (a.status === b.status ? dueDate(a, hist).localeCompare(dueDate(b, hist)) : a.status === 'active' ? -1 : 1));

  const mic = () => {
    if (listening) { stopRef.current?.(); return; }
    setMsg(null);
    setListening(true);
    stopRef.current = listen({
      onInterim: (t) => setText(t),
      onFinal: (t) => {
        // A pending sentence plus "ja" saves it: voice all the way.
        if (command && interpretReply(t, 'learned') === 'accept') { setMsg(applyCommand(store, command, today)); setText(''); refresh(); return; }
        setText(t);
      },
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
  };

  return (
    <Section title="Meine Rhythmen">
      <div className="row add">
        <input value={text} placeholder="z. B. „Mit Anna alle 3 Wochen telefonieren“" onChange={(e) => { setText(e.target.value); setMsg(null); }} />
        {canListen() && <MicButton onClick={mic} active={listening} label={listening ? 'Zuhören beenden' : 'Rhythmus sagen'} />}
      </div>
      {command && <RhythmConfirm command={command} onSaved={(m) => { setMsg(m); setText(''); }} />}
      {text.trim() && !command && <p className="hint-line">Nicht erkannt. Zum Beispiel: „Friseur alle 5 Wochen“, „Hab gestern mit Ben telefoniert“, „Anna pausieren“.</p>}
      {msg && <p className="ok">{msg}</p>}
      {list.length === 0 && !text && (
        <Empty>Wie oft willst du etwas machen oder von jemandem hören? PA erkennt Muster auch selbst aus deinem Kalender und fragt, bevor es sich etwas merkt.</Empty>
      )}
      <ul className="list">
        {list.map((r) => <RhythmRow key={r.id} r={r} hist={hist} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />)}
      </ul>
      <p className="hint-line">Kontakte zählt PA aus Kalendereinträgen („Kaffee mit Lisa“), aus deinen Einträgen („Hab mit Anna telefoniert“) und aus gesendeten Nachrichten. Anrufliste und Chats liest PA nicht.</p>
    </Section>
  );
}

function RhythmRow({ r, hist, open, onToggle }: { r: Rhythm; hist: Occurrence[]; open: boolean; onToggle: () => void }) {
  const { store, today, refresh } = usePA();
  const last = effectiveLast(r, hist);
  const due = dueDate(r, hist);
  const days = diffDays(today, due);
  const save = (patch: Partial<Rhythm>) => { store.save('rhythm', { ...r, ...patch, updatedAt: new Date().toISOString() }); refresh(); };
  const status = r.status === 'paused' ? 'pausiert' : days < 0 ? `seit ${agoText(-days)} fällig` : days === 0 ? 'heute fällig' : `fällig ${formatShort(due, today)}`;
  return (
    <li className="rhythm">
      <div className="rhythm-line">
        <span className="grow">
          <button className="link strong" onClick={onToggle}>{r.label}</button>
          <span className="meta"> · {intervalText(r.everyN, r.everyUnit)}{last ? ` · zuletzt ${formatShort(last, today)}` : ''} · {status}{r.origin === 'learned' ? ' · erkannt' : ''}</span>
        </span>
      </div>
      {open && (
        <div className="rhythm-edit">
          <div className="row">
            <Field label="Alle"><input type="number" min={1} value={r.everyN} onChange={(e) => Number(e.target.value) > 0 && save({ everyN: Number(e.target.value) })} /></Field>
            <Field label="&nbsp;">
              <select value={r.everyUnit} onChange={(e) => save({ everyUnit: e.target.value as Unit })}>
                {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
              </select>
            </Field>
          </div>
          {r.kind === 'contact' && (
            <div className="row">
              <Field label="Telefon"><input type="tel" defaultValue={r.phone ?? ''} onBlur={(e) => save({ phone: e.target.value.trim() || null })} /></Field>
              <Field label="Am liebsten">
                <select value={r.channel ?? 'call'} onChange={(e) => save({ channel: e.target.value as Rhythm['channel'] })}>
                  <option value="call">anrufen</option><option value="message">schreiben</option>
                </select>
              </Field>
            </div>
          )}
          <div className="actions wrap">
            <button onClick={() => { logTouch(store, { subject: r.subject, kind: r.kind, date: today, source: 'manual', direction: r.kind === 'contact' ? 'out' : null }); refresh(); }}>
              {r.kind === 'contact' ? 'Heute Kontakt gehabt' : 'Heute erledigt'}
            </button>
            {r.status === 'paused'
              ? <button onClick={() => save({ status: 'active', snoozedUntil: null })}>Wieder aktiv</button>
              : <button onClick={() => save({ status: 'paused' })}>Pausieren</button>}
            <button className="danger" onClick={() => { store.remove('rhythm', r.id); refresh(); }}>Löschen</button>
          </div>
          {last && <p className="hint-line">Zuletzt vor {agoText(diffDays(last, today))}.</p>}
        </div>
      )}
    </li>
  );
}
