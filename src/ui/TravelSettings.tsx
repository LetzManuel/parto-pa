// Ich › Wege & Erinnerungen: usual way of getting around, start address, how early PA reminds.
import { useState } from 'react';
import { getPrefs, MODE_LABEL, MODES, setPrefs, type NavApp, type TravelPrefs } from '../core/travel/prefs';
import { tick } from '../platform/reminders';
import { askNotify, notifyState, type NotifyState } from '../platform/notify';
import { usePA } from './context';
import { Chip, Field, Section } from './kit';

const NOTIFY_TEXT: Record<NotifyState, string> = {
  granted: 'Mitteilungen sind an.',
  default: 'Mitteilungen sind noch aus.',
  denied: 'Mitteilungen sind in den Einstellungen des Telefons blockiert.',
  unsupported: 'Dieser Browser zeigt keine Mitteilungen. Installiere PA auf dem Home-Bildschirm.',
};

export function TravelSettings() {
  const { store, today, refresh } = usePA();
  const p = getPrefs(store);
  const [home, setHome] = useState(p.home);
  const [notify, setNotify] = useState(notifyState());
  const [geo, setGeo] = useState<'idle' | 'ok' | 'no'>('idle');
  const save = (patch: Partial<TravelPrefs>) => { setPrefs(store, patch, today); refresh(); tick(store).then(refresh).catch(() => { /* next round */ }); };
  const num = (k: 'bufferMin' | 'preMin' | 'plainMin', opts: number[], zero?: string) => (
    <select value={p[k]} onChange={(e) => save({ [k]: Number(e.target.value) })}>
      {opts.map((n) => <option key={n} value={n}>{n === 0 && zero ? zero : `${n} min`}</option>)}
    </select>
  );

  return (
    <Section title="Wege & Erinnerungen">
      <div className="form">
        <Field label="Meistens unterwegs">
          <div className="chips tight">{MODES.map((m) => <Chip key={m} active={p.mode === m} onClick={() => save({ mode: m })}>{MODE_LABEL[m]}</Chip>)}</div>
        </Field>
        <Field label="Start, wenn PA nicht weiß, wo du bist">
          <input value={home} placeholder="z. B. Praterstraße 10, 1020 Wien" autoComplete="street-address"
            onChange={(e) => setHome(e.target.value)} onBlur={() => save({ home: home.trim() })} />
        </Field>
        <div className="row">
          <Field label="Puffer">{num('bufferMin', [0, 5, 10, 15, 20, 30])}</Field>
          <Field label="Vorwarnung vor dem Losgehen">{num('preMin', [0, 5, 10, 15, 20, 30], 'keine')}</Field>
        </div>
        <div className="row">
          <Field label="Termine ohne Ort">{num('plainMin', [5, 10, 15, 30, 60])}</Field>
          <Field label="Navigation mit">
            <select value={p.navApp} onChange={(e) => save({ navApp: e.target.value as NavApp })}>
              <option value="google">Google Maps</option><option value="apple">Apple Karten</option>
            </select>
          </Field>
        </div>
        <label className="remember">
          <input type="checkbox" checked={p.speak} onChange={(e) => save({ speak: e.target.checked })} />
          Erinnerungen vorlesen
        </label>
        <p className="hint-line">{NOTIFY_TEXT[notify]}</p>
        <div className="actions">
          {notify === 'default' && <button className="primary" onClick={async () => setNotify(await askNotify())}>Mitteilungen erlauben</button>}
          {geo !== 'ok' && 'geolocation' in navigator && (
            <button onClick={() => navigator.geolocation.getCurrentPosition(() => setGeo('ok'), () => setGeo('no'))}>Standort verwenden</button>
          )}
        </div>
        {geo === 'no' && <p className="hint-line">Ohne Standort rechnet PA ab deiner Startadresse oder dem Termin davor.</p>}
        <p className="hint-line">Auch per Memo oder Diktat: „Heute bin ich mit dem Auto unterwegs“, „Zum Zahnarzt gehe ich zu Fuß“,
          „Plane 10 Minuten Puffer ein“.</p>
      </div>
    </Section>
  );
}
