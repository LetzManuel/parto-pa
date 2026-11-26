import { useState } from 'react';
import type { Store } from '../core/db/store';
import type { ShopList } from '../core/model';
import { applyCommand, dueLists, findList, handoff, listFromIntent, markHanded, markOrdered, parseBasketCommand, readBack, rhythmLabel, skip, UNIT_LABEL } from '../core/shopping/lists';
import { parseShopping, textToItems, type ShopIntent } from '../core/shopping/parse';
import { DEFAULT_ENABLED, defaultPlatform, platform, PLATFORMS } from '../core/shopping/platforms';
import { formatShort, type Unit } from '../core/time/dates';
import { usePA } from './context';
import { Card, Chip, Empty, Field, Section } from './kit';

const META = 'shop.platforms';
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function enabledPlatforms(store: Store): string[] {
  try { return JSON.parse(store.getMeta(META) ?? 'null') ?? DEFAULT_ENABLED; } catch { return DEFAULT_ENABLED; }
}

/** Copy the list, open the platform, remember it. The user orders there; PA never buys. */
function openPlatform(store: Store, l: ShopList, today: string): void {
  const h = handoff(l);
  navigator.clipboard?.writeText(h.text).catch(() => { /* no clipboard: list is visible on screen */ });
  if (h.url) window.open(h.url, '_blank', 'noopener');
  store.save('shopList', markHanded(l, today));
}

function confirmOrdered(store: Store, l: ShopList, today: string): void {
  const { list, run } = markOrdered(l, today);
  store.save('shopList', list);
  store.save('shopRun', run);
}

/** Today: prepared baskets, one confirm each. */
export function ShoppingToday({ onOpen }: { onOpen: (id: string) => void }) {
  const { store, today, refresh } = usePA();
  const due = dueLists(store.list('shopList'), today);
  if (!due.length) return null;
  return (
    <Section title="Einkauf & Essen">
      {due.map((l) => {
        const p = platform(l.platformId);
        const act = (f: () => void) => { f(); refresh(); };
        return (
          <Card key={l.id} tone="accent">
            <div className="hint-title">{l.name}{l.nextDate && l.everyN ? <span className="muted"> · für {formatShort(l.nextDate, today)}</span> : null}</div>
            <div className="hint-text">{l.handedOn ? `${p?.name ?? 'Liste'} geöffnet. Hast du bestellt?` : readBack(l, p)}</div>
            <div className="actions">
              {l.handedOn
                ? <button className="primary" onClick={() => act(() => confirmOrdered(store, l, today))}>Bestellt</button>
                : <button className="primary" onClick={() => act(() => openPlatform(store, l, today))}>{p ? `${p.name} öffnen` : 'Erledigt'}</button>}
              <button onClick={() => onOpen(l.id)}>Ändern</button>
              <button onClick={() => act(() => store.save('shopList', skip(l, today)))}>{l.everyN ? 'Diesmal nicht' : 'Verwerfen'}</button>
            </div>
          </Card>
        );
      })}
    </Section>
  );
}

/** Capture: a spoken order becomes a basket. Returns null when the text is not a shopping order. */
export function ShoppingCapture({ intent, onSaved }: { intent: ShopIntent; onSaved: (id: string) => void }) {
  const { store, today, refresh } = usePA();
  const enabled = enabledPlatforms(store);

  if (intent.reuse) {
    const found = findList(store.list('shopList'), intent.reuse, store.list('shopRun'));
    return (
      <Card tone="accent">
        {found ? <>
          <div className="hint-text">{readBack(found, platform(found.platformId))}</div>
          <div className="actions">
            <button className="primary" onClick={() => { openPlatform(store, found, today); refresh(); onSaved(found.id); }}>{platform(found.platformId)?.name ?? 'Liste'} öffnen</button>
            <button onClick={() => onSaved(found.id)}>Ansehen</button>
          </div>
        </> : <div className="hint-text">Keine gespeicherte Liste „{intent.reuse}“ gefunden. Sag z. B. „Jeden Freitag Wocheneinkauf bei gurkerl: Milch, Eier“.</div>}
      </Card>
    );
  }

  const fallback = defaultPlatform(intent.kind, enabled)?.id;
  const draft = listFromIntent(intent, today, fallback);
  const p = platform(draft.platformId);
  const save = (open: boolean) => {
    const l = store.save('shopList', draft);
    if (open) openPlatform(store, l, today);
    refresh();
    onSaved(l.id);
  };
  return (
    <Card tone="accent">
      <div className="hint-title">{draft.name}{p ? ` · ${p.name}` : ' · Liste fürs Geschäft'}{rhythmLabel(draft) ? ` · ${rhythmLabel(draft)}` : ''}</div>
      <ul className="list basket">{textToItems(draft.items).map((i, n) => <li key={n}>{[i.qty, i.unit, i.name].filter(Boolean).join(' ')}</li>)}</ul>
      {intent.platformNote && <p className="hint-line">{intent.platformNote}</p>}
      {intent.platformId === undefined && p && <p className="hint-line">Keine Plattform genannt, PA nimmt {p.name}.</p>}
      <div className="actions">
        {draft.everyN
          ? <button className="primary" onClick={() => save(false)}>Korb anlegen</button>
          : p ? <button className="primary" onClick={() => save(true)}>{p.name} öffnen</button> : <button className="primary" onClick={() => save(false)}>Liste speichern</button>}
        {!draft.everyN && p && <button onClick={() => save(false)}>Nur speichern</button>}
      </div>
    </Card>
  );
}

/** One basket: items, platform, rhythm, saved store page. Spoken edits: "noch Butter dazu", "ohne Eier", "ja". */
export function BasketSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { store, today, refresh } = usePA();
  const l = store.get('shopList', id);
  const [say, setSay] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!l) return null;
  const p = platform(l.platformId);
  const h = handoff(l);
  const save = (patch: Partial<ShopList>) => { store.save('shopList', { ...l, ...patch, updatedAt: new Date().toISOString() }); refresh(); };

  const command = () => {
    const cmd = parseBasketCommand(say);
    if (!cmd) { setMsg('Nicht verstanden. Z. B. „noch Butter dazu“, „ohne Eier“, „ja“.'); return; }
    if (cmd.type === 'add' || cmd.type === 'remove') save({ items: applyCommand(l.items, cmd) });
    if (cmd.type === 'confirm') { openPlatform(store, l, today); refresh(); }
    if (cmd.type === 'ordered') { confirmOrdered(store, l, today); refresh(); onClose(); }
    if (cmd.type === 'skip') { store.save('shopList', skip(l, today)); refresh(); onClose(); }
    if (cmd.type === 'cancel') onClose();
    setMsg(cmd.type === 'read' ? readBack(l, p) : null);
    setSay('');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{l.name}</h2>
            <div className="meta">{p?.name ?? 'Liste fürs Geschäft'}{rhythmLabel(l) ? ` · ${rhythmLabel(l)}` : ''}{l.nextDate && l.everyN ? ` · nächstes Mal ${formatShort(l.nextDate, today)}` : ''}</div>
          </div>
          <button className="link" onClick={onClose}>Schließen</button>
        </div>

        <div className="row add">
          <input value={say} placeholder="„noch Butter dazu“, „ohne Eier“, „ja“" onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && command()} />
          <button onClick={command} disabled={!say.trim()}>OK</button>
        </div>
        {msg && <p className="hint-line">{msg}</p>}

        <div className="form">
          <Field label="Artikel (einer pro Zeile)">
            <textarea className="memo" rows={Math.max(4, textToItems(l.items).length + 1)} value={l.items} onChange={(e) => save({ items: e.target.value })} />
          </Field>
          <Field label="Name"><input value={l.name} onChange={(e) => save({ name: e.target.value })} /></Field>
          <div className="chips">
            {PLATFORMS.filter((x) => x.kinds.includes(l.kind)).map((x) => <Chip key={x.id} active={l.platformId === x.id} onClick={() => save({ platformId: x.id })}>{x.name}</Chip>)}
            <Chip active={!l.platformId} onClick={() => save({ platformId: null })}>Im Geschäft</Chip>
          </div>
          {p && <Field label={`Lieblings-Shop oder Restaurant bei ${p.name} (Link, optional)`}>
            <input value={l.storeUrl ?? ''} placeholder={p.web} onChange={(e) => save({ storeUrl: e.target.value.trim() || null })} />
          </Field>}
          <div className="row">
            <Field label="Alle"><input type="number" min={0} value={l.everyN ?? 0} onChange={(e) => { const n = Number(e.target.value); save(n ? { everyN: n, everyUnit: l.everyUnit ?? 'week', nextDate: l.nextDate ?? today, state: 'active' } : { everyN: null, everyUnit: null, weekday: null }); }} /></Field>
            <Field label="&nbsp;">
              <select value={l.everyUnit ?? 'week'} disabled={!l.everyN} onChange={(e) => save({ everyUnit: e.target.value as Unit })}>
                {(['week', 'month'] as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u][1]}</option>)}
              </select>
            </Field>
            <Field label="Tag">
              <select value={l.weekday ?? ''} disabled={!l.everyN} onChange={(e) => save({ weekday: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">egal</option>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </Field>
          </div>
          {l.everyN ? <Field label="Nächste Lieferung"><input type="date" value={l.nextDate ?? ''} onChange={(e) => save({ nextDate: e.target.value || null })} /></Field> : null}
        </div>

        <div className="actions wrap">
          {p && <button className="primary" onClick={() => { openPlatform(store, l, today); refresh(); setMsg('Liste kopiert. Bestell in Ruhe und tipp dann „Bestellt“.'); }}>{p.name} öffnen</button>}
          <button onClick={() => { confirmOrdered(store, l, today); refresh(); onClose(); }}>Bestellt</button>
          {l.everyN ? <button onClick={() => { store.save('shopList', skip(l, today)); refresh(); onClose(); }}>Diesmal nicht</button> : null}
          <button className="danger" onClick={() => { store.remove('shopList', l.id); refresh(); onClose(); }}>Löschen</button>
        </div>
        {h.itemLinks.length > 0 && (
          <details className="more">
            <summary>Einzeln suchen bei {p?.name}</summary>
            <ul className="list">{h.itemLinks.map((x) => <li key={x.item}><a href={x.url} target="_blank" rel="noreferrer">{x.item}</a></li>)}</ul>
          </details>
        )}
        <p className="hint-line">PA bestellt und bezahlt nie selbst. Die Liste wird kopiert und {p?.name ?? 'die Plattform'} geöffnet, du bestellst dort.{h.note ? ` ${h.note}` : ''}</p>
      </div>
    </div>
  );
}

/** Ich › Einkauf & Bestellen: which platforms are connected, saved baskets. */
export function ShoppingSettings({ onOpen }: { onOpen: (id: string) => void }) {
  const { store, today, refresh } = usePA();
  const enabled = enabledPlatforms(store);
  const lists = store.list('shopList').filter((l) => l.state !== 'done');
  const toggle = (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((x) => x !== id) : PLATFORMS.map((p) => p.id).filter((x) => x === id || enabled.includes(x));
    store.setMeta(META, JSON.stringify(next));
    refresh();
  };
  return (
    <Section title="Einkauf & Bestellen">
      {lists.length === 0 ? <Empty>Noch keine Listen. Sag z. B. „Jeden Freitag Wocheneinkauf bei gurkerl: Milch, Eier, Brot“.</Empty> : (
        <ul className="list">
          {lists.map((l) => (
            <li key={l.id} onClick={() => onOpen(l.id)} className="tap">
              <span className="grow">{l.name}<em className="muted"> · {platform(l.platformId)?.name ?? 'Geschäft'}{rhythmLabel(l) ? ` · ${rhythmLabel(l)}` : ''}</em></span>
              {l.everyN && l.nextDate ? <span className="time">{formatShort(l.nextDate, today)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Angebunden (ohne eigenes Konto bei PA, du bestellst in deinem Konto der Plattform):</p>
      <div className="chips">
        {PLATFORMS.map((p) => <Chip key={p.id} active={enabled.includes(p.id)} onClick={() => toggle(p.id)}>{p.name}</Chip>)}
      </div>
      <p className="hint">Reihenfolge = Standard, wenn du keine Plattform nennst. BILLA kommt über foodora, SPAR, INTERSPAR und HOFER liefern nicht mehr zu.</p>
    </Section>
  );
}

export { parseShopping };
