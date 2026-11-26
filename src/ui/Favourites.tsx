import { useState } from 'react';
import { listFor } from '../core/favourites/check';
import { KIND_LABEL, MAX_PER_LIST, type FavKind, type Favourite, type SystemId } from '../core/favourites/model';
import { detectSystem, refFromUrl, systemInfo } from '../core/favourites/systems';
import { stamp } from '../core/model';
import { usePA } from './context';
import { Chip, Empty, Field, Section } from './kit';

const KINDS = Object.keys(KIND_LABEL) as FavKind[];
const TOPIC_HINT: Partial<Record<FavKind, string>> = { doctor: 'Zahnarzt', salon: 'Herrenschnitt' };
const EMPTY = { name: '', topic: '', bookingUrl: '', phone: '', systemRef: '', durationMin: '' };

/** Up to three favourites per list, in the order PA asks them. Doctors have one list per field. */
export function Favourites({ onCheck }: { onCheck: (kind: FavKind, topic: string | null) => void }) {
  const { store, refresh } = usePA();
  const [kind, setKind] = useState<FavKind>('salon');
  const [f, setF] = useState<typeof EMPTY | null>(null);
  const all = store.list('favourite');
  const mine = all.filter((x) => x.kind === kind);
  const groups = [...new Set(mine.map((x) => x.topic ?? ''))].sort();
  const set = (patch: Partial<typeof EMPTY>) => setF((x) => x && { ...x, ...patch });
  const detected = f ? detectSystem(f.bookingUrl) : null;
  const sys: SystemId = detected?.id ?? 'manual';
  const needsRef = sys === 'resmio' || sys === 'salonized' || sys === 'ticketmaster';
  const listOf = (topic: string) => listFor(all, { kind, topic: topic || null }).filter((x) => (x.topic ?? '') === topic);
  const full = f ? listOf(f.topic.trim()).length >= MAX_PER_LIST : false;

  const save = () => {
    if (!f) return;
    const topic = f.topic.trim() || null;
    const ref = f.systemRef.trim() || refFromUrl(sys, f.bookingUrl);
    store.save('favourite', stamp<Omit<Favourite, 'id' | 'createdAt' | 'updatedAt'>>({
      kind, topic, priority: listOf(topic ?? '').length + 1, name: f.name.trim(), system: sys, systemRef: ref || null,
      bookingUrl: f.bookingUrl.trim() || null, phone: f.phone.trim() || null, durationMin: f.durationMin ? Number(f.durationMin) : null, note: null,
    }));
    setF(null); refresh();
  };

  const move = (list: Favourite[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[i], next[j]] = [next[j], next[i]];
    const t = new Date().toISOString();
    next.forEach((x, k) => { if (x.priority !== k + 1) store.save('favourite', { ...x, priority: k + 1, updatedAt: t }); });
    refresh();
  };

  const remove = (list: Favourite[], x: Favourite) => {
    store.remove('favourite', x.id);
    const t = new Date().toISOString();
    list.filter((y) => y.id !== x.id).forEach((y, k) => { if (y.priority !== k + 1) store.save('favourite', { ...y, priority: k + 1, updatedAt: t }); });
    refresh();
  };

  return (
    <Section title="Meine Favoriten" aside={!f && <button className="link" onClick={() => setF(EMPTY)}>+ Neu</button>}>
      <div className="chips">{KINDS.map((k) => <Chip key={k} active={kind === k} onClick={() => { setKind(k); setF(null); }}>{KIND_LABEL[k]}</Chip>)}</div>
      {mine.length === 0 && !f && <Empty>Bis zu drei pro Liste. PA fragt sie der Reihe nach und schlägt den ersten freien Termin vor.</Empty>}
      {groups.map((g) => {
        const list = listOf(g);
        return (
          <div key={g} className="fav-group">
            <div className="fav-head">
              <span className="strong">{g || KIND_LABEL[kind]}</span>
              <button className="link" onClick={() => onCheck(kind, g || null)}>Jetzt prüfen</button>
            </div>
            <ol className="list fav">
              {list.map((x, i) => {
                const s = systemInfo(x.system);
                return (
                  <li key={x.id}>
                    <span className="rank">{i + 1}</span>
                    <span className="grow">{x.name}<span className="meta"> · {x.system === 'demo' ? 'Beispiel: PA liest freie Termine' : s ? (s.readable ? `${s.label}: PA liest freie Termine` : `${s.label}: Link`) : x.phone ? 'Anruf/Nachricht' : 'Website'}</span></span>
                    <button className="link" aria-label="Nach oben" disabled={i === 0} onClick={() => move(list, i, -1)}>↑</button>
                    <button className="link" aria-label="Nach unten" disabled={i === list.length - 1} onClick={() => move(list, i, 1)}>↓</button>
                    <button className="link" onClick={() => remove(list, x)}>Löschen</button>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
      {f && (
        <div className="form">
          <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind === 'babysitter' ? 'Lena Huber' : kind === 'doctor' ? 'Dr. Muster' : 'Salon Haarmonie'} /></Field>
          {(kind === 'doctor' || kind === 'salon') && (
            <Field label={kind === 'doctor' ? 'Fachrichtung (eigene Liste)' : 'Leistung (optional, eigene Liste)'}>
              <input value={f.topic} onChange={(e) => set({ topic: e.target.value })} placeholder={TOPIC_HINT[kind]} />
            </Field>
          )}
          <Field label={kind === 'babysitter' ? 'Profil-Link (optional)' : 'Buchungsseite oder Website'}>
            <input value={f.bookingUrl} onChange={(e) => set({ bookingUrl: e.target.value })} placeholder={kind === 'tickets' ? 'ticketmaster.at' : kind === 'doctor' ? 'doctolib.at/…' : 'treatwell.at/…'} />
          </Field>
          {f.bookingUrl.trim() && (
            <p className="hint-line">{detected ? (detected.readable ? `${detected.label}: PA kann hier freie Termine lesen.` : `${detected.label}: PA öffnet die Seite, du siehst dort die freien Termine.`) : 'Eigene Website: PA öffnet sie, buchen oder anrufen machst du dort.'}</p>
          )}
          {needsRef && (
            <Field label={sys === 'salonized' ? 'Salonized: Salon:Leistungs-Nr.' : sys === 'resmio' ? 'resmio-Kennung' : 'Veranstaltungsort-ID (optional)'}>
              <input value={f.systemRef} onChange={(e) => set({ systemRef: e.target.value })} placeholder={refFromUrl(sys, f.bookingUrl) ?? ''} />
            </Field>
          )}
          <div className="row">
            <Field label="Telefon"><input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            {(kind === 'salon' || kind === 'doctor') && <Field label="Dauer (Min.)"><input type="number" min={5} value={f.durationMin} onChange={(e) => set({ durationMin: e.target.value })} placeholder={kind === 'salon' ? '60' : '30'} /></Field>}
          </div>
          {full && <p className="hint-line">Diese Liste hat schon {MAX_PER_LIST} Favoriten. Lösche einen, um Platz zu machen.</p>}
          <div className="actions">
            <button onClick={() => setF(null)}>Abbrechen</button>
            <button className="primary" disabled={!f.name.trim() || full} onClick={save}>Speichern</button>
          </div>
        </div>
      )}
    </Section>
  );
}
