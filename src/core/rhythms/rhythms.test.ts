import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { Store } from '../db/store';
import { stamp, type Provider } from '../model';
import { addDays } from '../time/dates';
import { occurrences, type Occurrence } from './history';
import { learnRhythms, roundInterval } from './learn';
import { createRhythm, dueDate, interpretReply, intervalText, rhythmSuggestions } from './engine';
import { findInterval, findPerson, parseRhythmSentence } from './say';
import { personKey, subjectsInTitle } from './subjects';
import { applyCommand, applySuggestionAction, logTouch, suggestionsFor } from './touch';

const T = '2026-11-26'; // Thursday

const ev = (title: string, date: string) => ({ title, date });
const provider = (p: Partial<Provider> & { name: string }): Provider => stamp({
  category: 'beauty', service: null, phone: null, email: null, website: null, bookingWay: 'phone', everyN: null, everyUnit: null,
  lastVisit: null, contactPerson: null, notes: null, ...p,
}) as Provider;

async function open() {
  const SQL = await initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') });
  return new Store(new SQL.Database(), 'space-1');
}

describe('subjects in calendar titles', () => {
  it('finds services, providers and people, never health appointments', () => {
    expect(subjectsInTitle('Friseur 15:00').map((s) => s.key)).toEqual(['friseur']);
    expect(subjectsInTitle('Haarschnitt bei Salon X').map((s) => s.key)).toEqual(['friseur']);
    const nails = provider({ name: 'Studio Nails', service: 'Maniküre Gel' });
    expect(subjectsInTitle('Studio Nails', [nails]).map((s) => s.key)).toEqual(['manikuere']);
    expect(subjectsInTitle('Kaffee mit Lisa').map((s) => s.key)).toEqual(['person:lisa']);
    expect(subjectsInTitle('Anna anrufen').map((s) => s.key)).toEqual(['person:anna']);
    expect(subjectsInTitle('Besuch bei Oma').map((s) => s.label)).toEqual(['Oma']);
    expect(subjectsInTitle('Meeting mit Team')).toEqual([]);
    expect(subjectsInTitle('Zahnarzt mit Lisa')).toEqual([]);
  });
});

describe('learning rhythms from the history', () => {
  const every5w = [-140, -105, -70, -36, -2].map((d) => ev('Friseur', addDays(T, d)));
  it('proposes a regular habit with a rounded interval', () => {
    const hist = occurrences({ touches: [], events: every5w, providers: [] }, T);
    const [c] = learnRhythms(hist, [], T);
    expect(c).toMatchObject({ key: 'friseur', label: 'Friseur', kind: 'booking', everyN: 5, everyUnit: 'week', count: 5, lastDone: addDays(T, -2) });
    expect(c.confidence).toBeGreaterThan(0.8);
  });

  it('needs three times, regular gaps and a habit that is still alive', () => {
    const two = occurrences({ touches: [], events: every5w.slice(-2), providers: [] }, T);
    expect(learnRhythms(two, [], T)).toEqual([]);
    const irregular = occurrences({ touches: [], events: [-200, -190, -100, -20].map((d) => ev('Kaffee mit Lisa', addDays(T, d))), providers: [] }, T);
    expect(learnRhythms(irregular, [], T)).toEqual([]);
    const old = occurrences({ touches: [], events: [-300, -265, -230, -195].map((d) => ev('Friseur', addDays(T, d))), providers: [] }, T);
    expect(learnRhythms(old, [], T)).toEqual([]);
  });

  it('learns people from calendar and logged touches together, and respects a "no"', () => {
    const touches = [stamp({ subject: personKey('Anna'), kind: 'contact' as const, date: addDays(T, -42), source: 'voice' as const, direction: 'out' as const })];
    const events = [-63, -21].map((d) => ev('Telefonat Anna', addDays(T, d)));
    const hist = occurrences({ touches, events, providers: [] }, T);
    const [c] = learnRhythms(hist, [], T);
    expect(c).toMatchObject({ key: 'person:anna', kind: 'contact', everyN: 3, everyUnit: 'week' });
    expect(learnRhythms(hist, [{ subject: 'person:anna' }], T)).toEqual([]);
  });

  it('rounds to what people say', () => {
    expect(roundInterval(10)).toEqual({ everyN: 10, everyUnit: 'day' });
    expect(roundInterval(36)).toEqual({ everyN: 5, everyUnit: 'week' });
    expect(roundInterval(91)).toEqual({ everyN: 3, everyUnit: 'month' });
  });
});

describe('suggestions', () => {
  const hist: Occurrence[] = [];
  it('suggests booking a week ahead and calling when due, with hand-offs', () => {
    const hair = createRhythm({ subject: 'friseur', label: 'Friseur', kind: 'booking', everyN: 5, everyUnit: 'week', lastDone: addDays(T, -30) });
    const anna = createRhythm({ subject: 'person:anna', label: 'Anna', kind: 'contact', everyN: 3, everyUnit: 'week', lastDone: addDays(T, -35), phone: '+43 660 1234567' });
    const ben = createRhythm({ subject: 'person:ben', label: 'Ben', kind: 'contact', everyN: 4, everyUnit: 'week', lastDone: addDays(T, -10) });
    const nails = provider({ name: 'Salon Haarmonie', service: 'Haarschnitt' });
    const out = rhythmSuggestions({ rhythms: [hair, anna, ben], history: hist, providers: [nails], candidates: [] }, T);
    expect(out.map((s) => s.title)).toEqual(['Anna anrufen?', 'Friseurtermin buchen?']);
    expect(out[0].text).toBe('Seit 5 Wochen kein Kontakt mit Anna. Sonst etwa alle 3 Wochen.');
    expect(out[0].handoff).toMatchObject({ type: 'contact', person: 'Anna', phone: '+43 660 1234567', channel: 'call' });
    expect(out[1].handoff).toMatchObject({ type: 'book', serviceKey: 'friseur', category: 'beauty', providerId: nails.id });
    expect(out[1].text).toBe('Letztes Mal vor 4 Wochen, du gehst etwa alle 5 Wochen.');
  });

  it('stays quiet while snoozed, paused, or when the provider already has its own rhythm', () => {
    const r = createRhythm({ subject: 'friseur', label: 'Friseur', kind: 'booking', everyN: 5, everyUnit: 'week', lastDone: addDays(T, -40) });
    const run = (rh: typeof r, providers: Provider[] = []) => rhythmSuggestions({ rhythms: [rh], history: hist, providers, candidates: [] }, T);
    expect(run(r)).toHaveLength(1);
    expect(run({ ...r, snoozedUntil: addDays(T, 1) })).toHaveLength(0);
    expect(run({ ...r, status: 'paused' })).toHaveLength(0);
    expect(run(r, [provider({ name: 'Salon', service: 'Haarschnitt', everyN: 6, everyUnit: 'week' })])).toHaveLength(0);
  });

  it('counts from the newest history entry', () => {
    const r = createRhythm({ subject: 'person:anna', label: 'Anna', kind: 'contact', everyN: 3, everyUnit: 'week', lastDone: addDays(T, -60) });
    const h: Occurrence[] = [{ key: 'person:anna', label: 'Anna', kind: 'contact', date: addDays(T, -3), from: 'calendar' }];
    expect(dueDate(r, h)).toBe(addDays(T, 18));
  });

  it('understands short spoken answers', () => {
    expect(interpretReply('Ja, ruf sie an', 'due')).toBe('go');
    expect(interpretReply('später', 'due')).toBe('later');
    expect(interpretReply('hab schon', 'due')).toBe('done');
    expect(interpretReply('nein danke', 'due')).toBe('stop');
    expect(interpretReply('ja merken', 'learned')).toBe('accept');
    expect(interpretReply('nein', 'learned')).toBe('reject');
    expect(interpretReply('Wetter morgen', 'learned')).toBe(null);
  });

  it('says intervals in German', () => {
    expect(intervalText(1, 'week')).toBe('jede Woche');
    expect(intervalText(1, 'month')).toBe('jeden Monat');
    expect(intervalText(5, 'week')).toBe('alle 5 Wochen');
  });
});

describe('spoken rhythm sentences', () => {
  it('finds intervals', () => {
    expect(findInterval('alle drei Wochen')).toMatchObject({ everyN: 3, everyUnit: 'week' });
    expect(findInterval('alle paar Wochen')).toMatchObject({ everyN: 3, everyUnit: 'week' });
    expect(findInterval('jeden Monat')).toMatchObject({ everyN: 1, everyUnit: 'month' });
    expect(findInterval('zweimal im Monat')).toMatchObject({ everyN: 2, everyUnit: 'week' });
    expect(findInterval('alle 14 Tage')).toMatchObject({ everyN: 14, everyUnit: 'day' });
  });

  it('finds people', () => {
    expect(findPerson('Mit Anna alle drei Wochen telefonieren')).toBe('Anna');
    expect(findPerson('Ruf Mama jede Woche an')).toBe('Mama');
    expect(findPerson('Ich will Ben jeden Monat schreiben')).toBe('Ben');
    expect(findPerson('Lisa hat sich gemeldet')).toBe('Lisa');
  });

  it('parses set, change, log, pause', () => {
    expect(parseRhythmSentence('Friseur alle 5 Wochen', T)).toMatchObject({ type: 'set', subject: 'friseur', kind: 'booking', everyN: 5, everyUnit: 'week' });
    expect(parseRhythmSentence('Mit Anna alle drei Wochen telefonieren', T)).toMatchObject({ type: 'set', subject: 'person:anna', kind: 'contact', everyN: 3, channel: 'call' });
    expect(parseRhythmSentence('Ich will Ben jeden Monat schreiben', T)).toMatchObject({ type: 'set', subject: 'person:ben', channel: 'message', everyN: 1, everyUnit: 'month' });
    expect(parseRhythmSentence('Mich alle 2 Wochen bei Mama melden, zuletzt vor 3 Wochen', T)).toMatchObject({ subject: 'person:mama', everyN: 2, lastDone: addDays(T, -21) });
    expect(parseRhythmSentence('Auto waschen alle 4 Wochen', T)).toMatchObject({ type: 'set', kind: 'task', label: 'Auto waschen', subject: 'task:auto waschen' });
    expect(parseRhythmSentence('Hab gestern mit Anna telefoniert', T)).toMatchObject({ type: 'log', subject: 'person:anna', date: addDays(T, -1), direction: 'out' });
    expect(parseRhythmSentence('Anna hat sich gemeldet', T)).toMatchObject({ type: 'log', subject: 'person:anna', date: T, direction: 'in' });
    expect(parseRhythmSentence('War heute beim Friseur', T)).toMatchObject({ type: 'log', subject: 'friseur', date: T });
    expect(parseRhythmSentence('Hab Lisa am Montag getroffen', T)).toMatchObject({ type: 'log', subject: 'person:lisa', date: '2026-11-23' });
    expect(parseRhythmSentence('Friseur pausieren', T)).toMatchObject({ type: 'pause', subject: 'friseur' });
    expect(parseRhythmSentence('Anna nicht mehr erinnern', T)).toMatchObject({ type: 'pause', subject: 'person:anna' });
    expect(parseRhythmSentence('Wie wird das Wetter', T)).toBe(null);
  });
});

describe('store flow', () => {
  it('from a sentence to a suggestion to a logged call', async () => {
    const store = await open();
    expect(applyCommand(store, parseRhythmSentence('Mit Anna alle 3 Wochen telefonieren, zuletzt vor 4 Wochen', T)!, T)).toBe('Rhythmus gespeichert.');
    let [s] = suggestionsFor(store, T);
    expect(s.title).toBe('Anna anrufen?');
    applySuggestionAction(store, s, 'later', T);
    expect(suggestionsFor(store, T)).toEqual([]);
    expect(suggestionsFor(store, addDays(T, 2))[0].title).toBe('Anna anrufen?');
    [s] = suggestionsFor(store, addDays(T, 2));
    applySuggestionAction(store, s, 'done', addDays(T, 2));
    expect(suggestionsFor(store, addDays(T, 3))).toEqual([]);
    expect(store.list('touch')).toHaveLength(1);
    // "Lieber alle 2 Wochen" changes the same rhythm
    applyCommand(store, parseRhythmSentence('Mit Anna lieber alle 2 Wochen telefonieren', T)!, T);
    expect(store.list('rhythm')).toHaveLength(1);
    expect(store.list('rhythm')[0]).toMatchObject({ everyN: 2 });
  });

  it('proposes a learned rhythm once; accept starts it, no keeps it away', async () => {
    const store = await open();
    for (const d of [-105, -70, -35]) store.save('event', stamp({ title: 'Friseur', date: addDays(T, d), start: '10:00', end: '11:00', tentative: false, orderId: null }));
    let [s] = suggestionsFor(store, T);
    expect(s).toMatchObject({ source: 'learned', title: 'Friseur etwa alle 5 Wochen?' });
    applySuggestionAction(store, s, 'accept', T);
    [s] = suggestionsFor(store, T);
    expect(s).toMatchObject({ source: 'due', title: 'Friseurtermin buchen?' });
    // "Nein" to a learned person
    for (const d of [-42, -28, -14]) store.save('event', stamp({ title: 'Kaffee mit Lisa', date: addDays(T, d), start: null, end: null, tentative: false, orderId: null }));
    const lisa = suggestionsFor(store, T).find((x) => x.source === 'learned')!;
    expect(lisa.title).toBe('Lisa etwa alle 2 Wochen?');
    applySuggestionAction(store, lisa, 'reject', T);
    expect(suggestionsFor(store, T).find((x) => x.source === 'learned')).toBeUndefined();
  });

  it('logTouch from other modules resets the count', async () => {
    const store = await open();
    applyCommand(store, { type: 'set', subject: 'person:ben', label: 'Ben', kind: 'contact', everyN: 2, everyUnit: 'week', channel: 'message', lastDone: addDays(T, -20) }, T);
    expect(suggestionsFor(store, T)[0].title).toBe('Ben schreiben?');
    logTouch(store, { subject: personKey('Ben'), date: T, source: 'message' });
    expect(suggestionsFor(store, T)).toEqual([]);
  });
});

describe('confirm line', () => {
  it('reads as one sentence', async () => {
    const { describeCommand } = await import('./say');
    const c = parseRhythmSentence('Friseur alle 5 Wochen, zuletzt am 5.11.', T)!;
    expect(describeCommand(c, intervalText, () => 'Do., 5.11.')).toBe('Friseur etwa alle 5 Wochen, zuletzt Do., 5.11.');
  });
});
