import { useMemo, useState } from 'react';
import { stamp, type Order } from '../core/model';
import { createOrder } from '../core/orders/flow';
import { createMemory, sourceFromMemo, CATEGORY_LABEL, guessCategory } from '../core/memory/memory';
import { suggest, TEMPLATES, type Suggestion, type TemplateId } from '../core/templates/templates';
import type { Unit } from '../core/time/dates';
import { usePA } from './context';
import { Chip, Field } from './kit';

const UNITS: Array<[Unit, string]> = [['week', 'Wochen'], ['month', 'Monate'], ['year', 'Jahre']];

/** "+" — a memo becomes an order through a fixed template. Nothing is saved before "Speichern". */
export function Capture({ onDone }: { onDone: () => void }) {
  const { store, today, refresh } = usePA();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const [edit, setEdit] = useState<Partial<Suggestion>>({});
  const [remember, setRemember] = useState(true);

  const suggestions = useMemo(() => suggest(text, today), [text, today]);
  const base = suggestions.find((s) => s.template === picked) ?? (picked ? { template: picked, title: text, dueDate: null, confidence: 0 } : suggestions[0]);
  const s: Suggestion | undefined = base ? { ...base, ...edit } as Suggestion : undefined;
  const tpl = s?.template;
  const set = (patch: Partial<Suggestion>) => setEdit((e) => ({ ...e, ...patch }));
  const choose = (id: TemplateId) => { setPicked(id); setEdit({}); };

  const save = () => {
    const source = sourceFromMemo(today);
    const memo = store.save('memo', stamp({ text: text.trim(), result: null }));
    if (!s || !tpl) {
      store.save('memo', { ...memo, result: 'note' });
    } else {
      const kind = TEMPLATES.find((t) => t.id === tpl)!.kind;
      const draft: Partial<Order> = { title: s.title || text.trim(), kind, dueDate: s.dueDate ?? null, source };
      if (tpl === 'location') draft.place = s.place ?? null;
      if (tpl === 'conditional') Object.assign(draft, { waitingFor: s.waitingFor ?? null, fallback: s.fallback ?? null });
      if (tpl === 'recurring') Object.assign(draft, { everyN: s.everyN ?? 1, everyUnit: s.everyUnit ?? 'week', lastDone: s.dueDate ?? today, dueDate: null });
      const o = store.save('order', createOrder({ ...draft, title: draft.title!, kind }));
      if (s.memory && remember) store.save('memory', createMemory(s.memory, source));
      store.save('memo', { ...memo, result: `order:${o.id}` });
    }
    refresh();
    setText(''); setPicked(null); setEdit({});
    onDone();
  };

  return (
    <div className="screen">
      <h1>Neues Memo</h1>
      <textarea
        className="memo" autoFocus value={text} rows={3}
        placeholder="z. B. „Wenn der Installateur bis Freitag nicht zurückruft, such einen anderen“"
        onChange={(e) => { setText(e.target.value); setEdit({}); setPicked(null); }}
      />
      <p className="hint-line">Diktat und KI kommen später. Jetzt erkennt PA ein paar feste Formen direkt auf dem Gerät.</p>

      <div className="chips">
        {TEMPLATES.map((t) => <Chip key={t.id} active={tpl === t.id} onClick={() => choose(t.id)}>{t.label}</Chip>)}
      </div>
      {!tpl && text.trim() && <p className="hint-line">Keine Form erkannt. Wähle eine aus oder speichere es als Notiz.</p>}
      {!text.trim() && (
        <ul className="patterns">{TEMPLATES.map((t) => <li key={t.id}>{t.pattern}</li>)}</ul>
      )}

      {s && tpl && (
        <div className="form">
          <Field label={tpl === 'birthday' ? 'Wer' : 'Was'}>
            <input value={tpl === 'birthday' ? s.person ?? '' : s.title}
              onChange={(e) => tpl === 'birthday' ? set({ person: e.target.value, title: `Geburtstag ${e.target.value}` }) : set({ title: e.target.value })} />
          </Field>
          {tpl === 'location' && <Field label="Wo"><input value={s.place ?? ''} onChange={(e) => set({ place: e.target.value })} /></Field>}
          {tpl === 'conditional' && <>
            <Field label="Warten auf"><input value={s.waitingFor ?? ''} onChange={(e) => set({ waitingFor: e.target.value })} /></Field>
            <Field label="Plan B"><input value={s.fallback ?? ''} onChange={(e) => set({ fallback: e.target.value })} /></Field>
          </>}
          {tpl === 'recurring' ? (
            <div className="row">
              <Field label="Alle"><input type="number" min={1} value={s.everyN ?? 1} onChange={(e) => set({ everyN: Number(e.target.value) })} /></Field>
              <Field label="&nbsp;">
                <select value={s.everyUnit ?? 'week'} onChange={(e) => set({ everyUnit: e.target.value as Unit })}>
                  {UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}
                </select>
              </Field>
              <Field label="Zuletzt"><input type="date" value={s.dueDate ?? today} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
            </div>
          ) : tpl !== 'location' && (
            <Field label={tpl === 'conditional' ? 'Bis' : tpl === 'birthday' ? 'Datum' : 'Wann'}>
              <input type="date" value={s.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
          )}
          {s.memory && (
            <label className="remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Merken: „{s.memory}“ <em>({CATEGORY_LABEL[guessCategory(s.memory)]})</em>
            </label>
          )}
        </div>
      )}

      <div className="actions sticky">
        <button disabled={!text.trim()} onClick={save} hidden={!!tpl}>Als Notiz speichern</button>
        <button className="primary" disabled={!text.trim() || !tpl || (tpl !== 'location' && tpl !== 'recurring' && !s?.dueDate)} onClick={save}>Speichern</button>
      </div>
    </div>
  );
}
