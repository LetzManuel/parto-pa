import { useEffect, useState } from 'react';
import { cloudConfigured, sendCode, signedInEmail, signOut, syncNow, verifyCode } from '../platform/cloud';
import { usePA } from './context';
import { Field, Section } from './kit';

/** Ich › Konto & Sync: Parto ID sign-in with an e-mail code. Data stays usable on the device without it. */
export function Account() {
  const { store, refresh } = usePA();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'loading' | 'out' | 'code' | 'in'>('loading');
  const [msg, setMsg] = useState<string | null>(null);
  const last = store.getMeta('lastSync');

  useEffect(() => {
    signedInEmail().then((e) => { if (e) setEmail(e); setStep(e ? 'in' : 'out'); });
  }, []);

  if (!cloudConfigured()) {
    return (
      <Section title="Konto & Sync">
        <p className="hint-line">Diese Version speichert nur auf dem Gerät. Die Cloud ist noch nicht eingerichtet.</p>
      </Section>
    );
  }

  const send = async () => {
    setMsg(null);
    const err = await sendCode(email.trim());
    if (err) setMsg(err); else setStep('code');
  };
  const verify = async () => {
    setMsg(null);
    const err = await verifyCode(store, email.trim(), code);
    if (err) { setMsg(err); return; }
    setStep('in');
    const r = await syncNow(store).catch((e: Error) => { setMsg(e.message); return null; });
    if (r) setMsg(`Angemeldet. ${r.pushed} Einträge hochgeladen, ${r.pulled} geladen.`);
    refresh();
  };

  return (
    <Section title="Konto & Sync">
      {step === 'in' ? (
        <div className="form">
          <div>Angemeldet als <strong>{email}</strong></div>
          <div className="meta">{last ? `Zuletzt synchronisiert ${new Date(last).toLocaleString('de-AT')}` : 'Noch nicht synchronisiert'}</div>
          <div className="actions">
            <button onClick={async () => {
              const r = await syncNow(store).catch((e: Error) => { setMsg(e.message); return null; });
              if (r) setMsg(`${r.pushed} hochgeladen, ${r.pulled} geladen.`);
              refresh();
            }}>Jetzt synchronisieren</button>
            <button onClick={async () => { await signOut(); setStep('out'); setCode(''); }}>Abmelden</button>
          </div>
        </div>
      ) : step === 'loading' ? null : (
        <div className="form">
          <p className="hint-line">Mit deiner Parto ID sind deine Daten auf allen Geräten gleich. Gespeichert wird in der EU, nur für dich sichtbar.</p>
          <Field label="E-Mail">
            <input type="email" value={email} autoComplete="email" disabled={step === 'code'} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {step === 'code' && (
            <Field label="Code aus der E-Mail">
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <div className="actions">
            {step === 'code' && <button onClick={() => { setStep('out'); setCode(''); }}>Andere E-Mail</button>}
            {step === 'out'
              ? <button className="primary" disabled={!/^\S+@\S+\.\S+$/.test(email)} onClick={send}>Code senden</button>
              : <button className="primary" disabled={code.trim().length < 6} onClick={verify}>Anmelden</button>}
          </div>
        </div>
      )}
      {msg && <p className="hint-line">{msg}</p>}
    </Section>
  );
}
