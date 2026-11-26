import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { applyMove, entries, groups, KEYWORD_HINT, keywords, LIST_KINDS, newEntry, newKeyword, removeEntry, shopEntry } from '../core/anbieter/lists';
import { applyAnbieterCommand, parseAnbieterCommand, type AnbieterCommand } from '../core/anbieter/voice';
import { isFavKind, LIST_LABEL, MAX_PER_LIST, type FavKind, type Favourite, type ListKind, type SystemId } from '../core/favourites/model';
import { detectSystem, refFromUrl, systemInfo } from '../core/favourites/systems';
import { platform, PLATFORMS } from '../core/shopping/platforms';
import { CATEGORIES, CUISINES, normalizeTopic, shopEntries, WEEKEND, WORKDAYS } from '../core/shopping/choose';

/** Headings of the shop lists: general order, then rules by category/cuisine and time. */
function shopTopicLabel(kind: ListKind, topic: string): string {
  if (!topic) return kind === 'food' ? 'Essen allgemein' : 'Einkauf allgemein';
  if (topic === WEEKEND) return 'Am Wochenende';
  if (topic === WORKDAYS) return 'Unter der Woche';
  return kind === 'food' ? `${topic} (Rangliste)` : `${topic} (Regel)`;
}
import { canListen, listen, speak } from '../platform/speech';
import { usePA } from './context';
import { Card, Chip, Empty, Field, Section } from './kit';
import { MicButton } from './Mic';

const TOPIC_HINT: Partial<Record<ListKind, string>> = { doctor: 'Zahnarzt', salon: 'Herrenschnitt', beauty: 'Maniküre' };
const EMPTY = { name: '', topic: '', bookingUrl: '', phone: '', systemRef: '', durationMin: '', platformId: '' };
const YES = /^(ja|jawohl|passt|ok|okay|genau|gerne|bitte|mach|speicher|übernehmen)/i;

/**
 * Ich › Meine Anbieter: shops, salons, beauty, doctors, restaurants, tickets, babysitters, each list in the person's
 * own order. PA asks / opens them in that order. Reorder by dragging the handle, with the arrows, or by voice
 * ("gurkerl zuerst"). Own keywords per list help PA understand speech ("Spitzen" → Friseur).
 */
export function Anbieter({ onCheck }: { onCheck: (kind: FavKind, topic: string | null) => void }) {
  const { store, refresh } = usePA();
  const [kind, setKind] = useState<ListKind>('grocery');
  const [f, setF] = useState<typeof EMPTY | null>(null);
  const [word, setWord] = useState('');
  const [cmd, setCmd] = useState<AnbieterCommand | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const stop = useRef<() => void>(() => {});
  const all = store.list('favourite');
  const shop = kind === 'grocery' || kind === 'food';
  const fav = isFavKind(kind);

  // ----- voice -----
  const hear = (onFinal: (t: string) => void) => {
    stop.current();
    setListening(true);
    stop.current = listen({ onInterim: (t) => setNote(`„${t}“`), onFinal, onEnd: () => setListening(false), onError: () => setNote('Nicht verstanden. Nochmal tippen.') });
  };
  const confirm = (c: AnbieterCommand) => {
    const said = applyAnbieterCommand(store, c);
    setCmd(null); setNote(said); setKind(c.kind); refresh();
    void speak(said);
  };
  const mic = () => {
    if (listening) { stop.current(); return; }
    hear((t) => {
      const c = parseAnbieterCommand(t, store.list('favourite'));
      if (!c) { setNote(`„${t}“ – nicht erkannt. Z. B. „gurkerl zuerst“ oder „Neuer Friseur Salon Lisa“.`); void speak('Nicht erkannt.'); return; }
      setCmd(c); setNote(null); setKind(c.kind);
      void speak(c.confirm).then(() => hear((yes) => (YES.test(yes.trim()) ? confirm(c) : (setCmd(null), setNote('Nichts geändert.')))));
    });
  };

  // ----- edit -----
  const set = (patch: Partial<typeof EMPTY>) => setF((x) => x && { ...x, ...patch });
  const detected = f && !shop ? detectSystem(f.bookingUrl) : null;
  const sys: SystemId = detected?.id ?? 'manual';
  const needsRef = sys === 'resmio' || sys === 'salonized' || sys === 'ticketmaster';
  const platforms = PLATFORMS.filter((p) => p.kinds.includes(kind as 'grocery' | 'food'));

  const save = () => {
    if (!f) return;
    if (shop) {
      const pid = f.platformId || platforms[0]?.id;
      if (!pid) return;
      const k = kind as 'grocery' | 'food';
      const topic = f.topic.trim() ? normalizeTopic(f.topic) : null;
      store.save('favourite', { ...shopEntry(all, k, pid, f.bookingUrl.trim() || null, f.name.trim() || undefined), topic, priority: shopEntries(all, k, topic).length + 1 });
    } else {
      const ref = f.systemRef.trim() || refFromUrl(sys, f.bookingUrl);
      store.save('favourite', newEntry(all, {
        kind, topic: f.topic.trim() || null, name: f.name.trim(), system: sys, systemRef: ref || null,
        bookingUrl: f.bookingUrl.trim() || null, phone: f.phone.trim() || null, durationMin: f.durationMin ? Number(f.durationMin) : null,
      }));
    }
    setF(null); refresh();
  };
  const addWord = () => {
    const k = newKeyword(all, kind, word);
    if (k) store.save('favourite', k);
    setWord(''); refresh();
  };

  const subtitle = (x: Favourite) => {
    if (x.system === 'shop') return x.bookingUrl ? 'eigener Shop auf der Plattform' : platform(x.systemRef)?.area ?? '';
    if (x.system === 'demo') return 'Beispiel: PA liest freie Termine';
    const s = systemInfo(x.system);
    return s ? (s.readable ? `${s.label}: PA liest freie Termine` : `${s.label}: Link`) : x.phone ? 'Anruf/Nachricht' : 'Website';
  };

  return (
    <Section title="Meine Anbieter" aside={!f && <button className="link" onClick={() => setF(EMPTY)}>+ Neu</button>}>
      <div className="voice-bar">
        {canListen() && <MicButton active={listening} onClick={mic} label={listening ? 'Zuhören beenden' : 'Anbieter per Sprache ändern'} />}
        <div className="voice-hint">
          {note ?? (listening ? 'Ich höre …' : 'Reihenfolge bestimmt, wo PA zuerst bucht oder bestellt.')}
          <div className="meta">{shop
            ? '„gurkerl zuerst“ · „Alkohol bestelle ich bei Alfies“ · „Am Wochenende bei foodora“ · „Italienisch: Riva, Da Mario“ · „Riva war super“'
            : '„gurkerl zuerst“ · „Neuer Friseur Salon Lisa 01 234 56 78“ · „Stichwort Spitzen für Friseur“'}</div>
        </div>
      </div>
      {cmd && (
        <Card tone="accent">
          <div className="hint-text">{cmd.confirm}</div>
          <div className="actions"><button onClick={() => setCmd(null)}>Nein</button><button className="primary" onClick={() => confirm(cmd)}>Ja</button></div>
        </Card>
      )}

      <div className="chips scroll">{LIST_KINDS.map((k) => <Chip key={k} active={kind === k} onClick={() => { setKind(k); setF(null); }}>{LIST_LABEL[k]}{entries(all, k).length ? ` · ${entries(all, k).length}` : ''}</Chip>)}</div>

      {entries(all, kind).length === 0 && !f && (
        <Empty>{shop ? 'Noch kein Shop. Ohne Liste nimmt PA die eingeschalteten Plattformen unter Einkauf & Bestellen.' : 'Noch niemand. PA fragt die Liste der Reihe nach und schlägt den ersten freien Termin vor.'}</Empty>
      )}
      {groups(all, kind).map(({ topic, list }) => (
        <div key={topic} className="fav-group">
          <div className="fav-head">
            <span className="strong">{shop ? shopTopicLabel(kind, topic) : topic || LIST_LABEL[kind]}</span>
            {fav && <button className="link" onClick={() => onCheck(kind as FavKind, topic || null)}>Jetzt prüfen</button>}
          </div>
          <Ordered list={list} subtitle={subtitle}
            onMove={(id, to) => { applyMove(store, list, id, to); refresh(); }}
            onRemove={(x) => { removeEntry(store, all, x); refresh(); }} />
          {fav && list.length > MAX_PER_LIST && <p className="hint-line">PA prüft die ersten {MAX_PER_LIST}, die anderen auf Wunsch („Auch die anderen prüfen“).</p>}
        </div>
      ))}

      {f && (
        <div className="form">
          {shop ? <>
            <Field label="Plattform">
              <select value={f.platformId || platforms[0]?.id} onChange={(e) => set({ platformId: e.target.value })}>
                {platforms.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.area})</option>)}
              </select>
            </Field>
            <Field label="Name (optional)"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind === 'food' ? 'Pizzeria da Mario' : 'BILLA Praterstraße'} /></Field>
            <Field label={kind === 'food' ? 'Küche oder Zeit (optional, eigene Rangliste)' : 'Kategorie oder Zeit (optional, eigene Regel)'}>
              <input list={`topics-${kind}`} value={f.topic} onChange={(e) => set({ topic: e.target.value })} placeholder={kind === 'food' ? 'Italienisch' : 'Alkohol'} />
              <datalist id={`topics-${kind}`}>
                {[...(kind === 'food' ? CUISINES : CATEGORIES).map(([c]) => c), WEEKEND, WORKDAYS].map((t) => <option key={t} value={t} />)}
              </datalist>
            </Field>
            <Field label="Eigene Shop-Seite auf der Plattform (optional)"><input value={f.bookingUrl} onChange={(e) => set({ bookingUrl: e.target.value })} placeholder="https://www.foodora.at/restaurant/…" /></Field>
          </> : <>
            <Field label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={kind === 'babysitter' ? 'Lena Huber' : kind === 'doctor' ? 'Dr. Muster' : kind === 'beauty' ? 'Studio Nails' : 'Salon Haarmonie'} /></Field>
            {TOPIC_HINT[kind] && (
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
              {(kind === 'salon' || kind === 'beauty' || kind === 'doctor') && <Field label="Dauer (Min.)"><input type="number" min={5} value={f.durationMin} onChange={(e) => set({ durationMin: e.target.value })} placeholder={kind === 'doctor' ? '30' : '60'} /></Field>}
            </div>
          </>}
          <div className="actions">
            <button onClick={() => setF(null)}>Abbrechen</button>
            <button className="primary" disabled={!shop && !f.name.trim()} onClick={save}>Speichern</button>
          </div>
        </div>
      )}

      <div className="keywords">
        <div className="fav-head"><span className="strong">Stichwörter für {LIST_LABEL[kind]}</span></div>
        <div className="chips">
          {keywords(all, kind).map((k) => (
            <span key={k.id} className="chip on kw">{k.name}<button className="link" aria-label={`${k.name} entfernen`} onClick={() => { store.remove('favourite', k.id); refresh(); }}>×</button></span>
          ))}
        </div>
        <div className="row add">
          <input value={word} placeholder={KEYWORD_HINT[kind]} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addWord(); }} />
          <button disabled={word.trim().length < 2} onClick={addWord}>Hinzufügen</button>
        </div>
        <p className="hint-line">Wenn du eines dieser Wörter sagst, weiß PA, dass {LIST_LABEL[kind]} gemeint ist. Namen deiner Anbieter zählen automatisch.</p>
      </div>
    </Section>
  );
}

/** Ordered list with a drag handle (touch and mouse) and arrow buttons. */
function Ordered({ list, subtitle, onMove, onRemove }: {
  list: Favourite[]; subtitle: (x: Favourite) => string;
  onMove: (id: string, to: number) => void; onRemove: (x: Favourite) => void;
}) {
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const overAt = (y: number) => {
    let i = 0;
    refs.current.forEach((el, k) => { if (el && y > el.getBoundingClientRect().top + el.offsetHeight / 2) i = k + 1; });
    return i;
  };
  const down = (e: ReactPointerEvent, id: string, i: number) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, over: i });
  };
  const move = (e: ReactPointerEvent) => { if (drag) setDrag({ ...drag, over: overAt(e.clientY) }); };
  const up = () => {
    if (!drag) return;
    const from = list.findIndex((x) => x.id === drag.id);
    const to = drag.over > from ? drag.over - 1 : drag.over;
    if (to !== from) onMove(drag.id, to);
    setDrag(null);
  };
  return (
    <ol className="list fav">
      {list.map((x, i) => (
        <li key={x.id} ref={(el) => { refs.current[i] = el; }}
          className={`${drag?.id === x.id ? 'dragging' : ''} ${drag && drag.id !== x.id && drag.over === i ? 'drop-before' : ''} ${drag && i === list.length - 1 && drag.over === list.length ? 'drop-after' : ''}`}>
          <span className="handle" aria-hidden onPointerDown={(e) => down(e, x.id, i)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>⋮⋮</span>
          <span className="rank">{i + 1}</span>
          <span className="grow">{x.name}<span className="meta"> · {subtitle(x)}</span></span>
          <button className="link" aria-label="Nach oben" disabled={i === 0} onClick={() => onMove(x.id, i - 1)}>↑</button>
          <button className="link" aria-label="Nach unten" disabled={i === list.length - 1} onClick={() => onMove(x.id, i + 1)}>↓</button>
          <button className="link" onClick={() => onRemove(x)}>Löschen</button>
        </li>
      ))}
    </ol>
  );
}
