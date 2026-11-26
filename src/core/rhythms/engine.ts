// Suggestion engine: which rhythm is due, and what PA proposes. One short card, one confirm.
// PA never acts by itself: the primary action hands off to the booking flow or the message/call flow,
// where the user books, calls or sends.
import type { ContactChannel, Provider, ProviderCategory, Rhythm, RhythmKind, RhythmOrigin } from '../model';
import { stamp } from '../model';
import { addDays, addInterval, diffDays, type ISODate, type Unit } from '../time/dates';
import { lastOccurrence, type Occurrence } from './history';
import { intervalDays, type Candidate } from './learn';
import { providerKey, serviceByKey } from './subjects';

/** Hand-off to another module. The receiving flow shows what it does and waits for the user's tap. */
export type Handoff =
  | { type: 'book'; rhythmId: string; service: string; serviceKey: string; category: ProviderCategory | null; providerId: string | null }
  | { type: 'contact'; rhythmId: string; person: string; phone: string | null; channel: ContactChannel; draft: string };

export type SuggestionAction = 'go' | 'done' | 'later' | 'stop' | 'accept' | 'reject';

export interface RhythmSuggestion {
  key: string;
  source: 'due' | 'learned';
  rhythmId: string | null;
  candidate: Candidate | null;
  title: string;
  text: string;
  /** Buttons in order; the first is the primary one. */
  actions: Array<{ id: SuggestionAction; label: string }>;
  handoff: Handoff | null;
  priority: number;
}

export function createRhythm(d: {
  subject: string; label: string; kind: RhythmKind; everyN: number; everyUnit: Unit; origin?: RhythmOrigin;
  lastDone?: ISODate | null; providerId?: string | null; phone?: string | null; channel?: ContactChannel | null; note?: string | null;
}, now = new Date()): Rhythm {
  return stamp<Omit<Rhythm, 'id' | 'createdAt' | 'updatedAt'>>({
    subject: d.subject, label: d.label, kind: d.kind, status: 'active', origin: d.origin ?? 'manual',
    everyN: d.everyN, everyUnit: d.everyUnit, lastDone: d.lastDone ?? null, snoozedUntil: null,
    providerId: d.providerId ?? null, phone: d.phone ?? null, channel: d.kind === 'contact' ? d.channel ?? 'call' : null, note: d.note ?? null,
  }, now);
}

export function fromCandidate(c: Candidate, now = new Date()): Rhythm {
  return createRhythm({ subject: c.key, label: c.label, kind: c.kind, everyN: c.everyN, everyUnit: c.everyUnit, lastDone: c.lastDone, origin: 'learned' }, now);
}

/** Last time it happened: the newer of what the rhythm stores and what the history knows. */
export function effectiveLast(r: Rhythm, history: Occurrence[]): ISODate | null {
  const h = lastOccurrence(history, r.subject);
  if (!r.lastDone) return h;
  if (!h) return r.lastDone;
  return h > r.lastDone ? h : r.lastDone;
}

/** When it is due again. Without any history PA counts from the day the rhythm was set up. */
export function dueDate(r: Rhythm, history: Occurrence[]): ISODate {
  return addInterval(effectiveLast(r, history) ?? r.createdAt.slice(0, 10), r.everyN, r.everyUnit);
}

/** Booking needs a head start (salons are booked out); calling a friend does not. */
export function leadDays(r: Pick<Rhythm, 'kind' | 'everyN' | 'everyUnit'>): number {
  return r.kind === 'booking' ? Math.min(7, Math.round(intervalDays(r.everyN, r.everyUnit) * 0.2)) : 0;
}

export function suggestFrom(r: Rhythm, history: Occurrence[]): ISODate {
  return addDays(dueDate(r, history), -leadDays(r));
}

export function intervalText(n: number, unit: Unit): string {
  const names: Record<Unit, [string, string]> = { day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'], month: ['Monat', 'Monate'], year: ['Jahr', 'Jahre'] };
  return n === 1 ? `jede${unit === 'day' || unit === 'month' ? 'n' : unit === 'year' ? 's' : ''} ${names[unit][0]}` : `alle ${n} ${names[unit][1]}`;
}

/** "5 Wochen", "3 Monaten" (dative after "seit"/"vor"). */
export function agoText(days: number): string {
  if (days >= 60) { const m = Math.round(days / 30.44); return m === 1 ? 'einem Monat' : `${m} Monaten`; }
  if (days >= 14) return `${Math.round(days / 7)} Wochen`;
  if (days === 1) return 'einem Tag';
  return `${days} Tagen`;
}

function bookingTitle(r: Pick<Rhythm, 'subject' | 'label'>): string {
  return r.subject === 'friseur' ? 'Friseurtermin buchen?' : `${r.label}-Termin buchen?`;
}

export function messageDraft(person: string): string {
  return `Hallo ${person}, lange nichts gehört! Wie geht's dir? Hast du die nächsten Tage Zeit zum Telefonieren oder auf einen Kaffee?`;
}

/** Providers with their own rhythm already get "Termin ausmachen?" in the briefing (recurring order). */
export function providerCoveredKeys(providers: Provider[]): Set<string> {
  return new Set(providers.filter((p) => p.everyN && p.everyUnit).map(providerKey));
}

export function findProvider(r: Pick<Rhythm, 'providerId' | 'subject'>, providers: Provider[]): Provider | undefined {
  return providers.find((p) => p.id === r.providerId) ?? providers.find((p) => providerKey(p) === r.subject);
}

export function handoffFor(r: Rhythm, providers: Provider[]): Handoff | null {
  if (r.kind === 'booking') {
    const svc = serviceByKey(r.subject);
    return { type: 'book', rhythmId: r.id, service: r.label, serviceKey: r.subject, category: svc?.category ?? findProvider(r, providers)?.category ?? null, providerId: findProvider(r, providers)?.id ?? null };
  }
  if (r.kind === 'contact') {
    return { type: 'contact', rhythmId: r.id, person: r.label, phone: r.phone, channel: r.channel ?? 'call', draft: messageDraft(r.label) };
  }
  return null;
}

function dueSuggestion(r: Rhythm, history: Occurrence[], providers: Provider[], today: ISODate): RhythmSuggestion {
  const last = effectiveLast(r, history);
  const since = last ? diffDays(last, today) : null;
  const every = intervalText(r.everyN, r.everyUnit);
  const ratio = since !== null ? since / intervalDays(r.everyN, r.everyUnit) : 1;
  const base = { key: `r:${r.id}`, source: 'due' as const, rhythmId: r.id, candidate: null, handoff: handoffFor(r, providers), priority: Math.round(40 + Math.min(30, ratio * 20)) };
  if (r.kind === 'booking') {
    return { ...base, title: bookingTitle(r),
      text: since !== null ? `Letztes Mal vor ${agoText(since)}, du gehst etwa ${every}.` : `Du wolltest etwa ${every} gehen.`,
      actions: [{ id: 'go', label: 'Termin suchen' }, { id: 'later', label: 'Später' }, { id: 'done', label: 'Hab schon einen' }] };
  }
  if (r.kind === 'contact') {
    const verb = r.channel === 'message' ? 'schreiben' : 'anrufen';
    return { ...base, title: `${r.label} ${verb}?`,
      text: since !== null ? `Seit ${agoText(since)} kein Kontakt mit ${r.label}. Sonst etwa ${every}.` : `Du wolltest dich etwa ${every} bei ${r.label} melden.`,
      actions: [{ id: 'go', label: r.channel === 'message' ? 'Nachricht' : 'Anrufen' }, { id: 'later', label: 'Später' }, { id: 'done', label: 'Schon erledigt' }] };
  }
  return { ...base, title: `${r.label}?`,
    text: since !== null ? `Zuletzt vor ${agoText(since)}, sonst etwa ${every}.` : `Etwa ${every}.`,
    actions: [{ id: 'done', label: 'Erledigt' }, { id: 'later', label: 'Später' }] };
}

function learnedSuggestion(c: Candidate, providers: Provider[]): RhythmSuggestion {
  const every = intervalText(c.everyN, c.everyUnit);
  const prov = c.kind === 'booking' ? providers.find((p) => providerKey(p) === c.key) : undefined;
  const what = c.kind === 'contact' ? `Mit ${c.label} hast du etwa ${every} Kontakt` : `${c.label} etwa ${every}`;
  return {
    key: `c:${c.key}`, source: 'learned', rhythmId: null, candidate: c, handoff: null, priority: 30,
    title: `${c.label} etwa ${every}?`,
    text: `${what} (${c.count}-mal im Kalender${prov ? `, ${prov.name}` : ''}). Soll PA dich erinnern, wenn es wieder so weit ist?`,
    actions: [{ id: 'accept', label: 'Ja, merken' }, { id: 'reject', label: 'Nein' }],
  };
}

/**
 * All suggestions for today, most urgent first: due rhythms, then at most one learned proposal.
 * The Today screen shows only the first one.
 */
export function rhythmSuggestions(
  input: { rhythms: Rhythm[]; history: Occurrence[]; providers: Provider[]; candidates: Candidate[] },
  today: ISODate,
): RhythmSuggestion[] {
  const covered = providerCoveredKeys(input.providers);
  const out: RhythmSuggestion[] = [];
  for (const r of input.rhythms) {
    if (r.status !== 'active') continue;
    if (r.snoozedUntil && r.snoozedUntil > today) continue;
    if (r.kind === 'booking' && covered.has(r.subject)) continue;
    if (suggestFrom(r, input.history) > today) continue;
    out.push(dueSuggestion(r, input.history, input.providers, today));
  }
  out.sort((a, b) => b.priority - a.priority);
  const learned = input.candidates.find((c) => !covered.has(c.key));
  if (learned) out.push(learnedSuggestion(learned, input.providers));
  return out;
}

/** What a short spoken answer to a suggestion card means ("ja", "später", "nein danke"). */
export function interpretReply(text: string, source: 'due' | 'learned'): SuggestionAction | null {
  const t = text.toLowerCase().replace(/[.,!?]/g, ' ').trim();
  if (!t) return null;
  if (/\b(später|morgen|nicht jetzt|nächste woche|erinner mich später)\b/.test(t)) return source === 'due' ? 'later' : null;
  if (/\b(schon erledigt|hab schon|habe schon|erledigt|gemacht|schon gesprochen|war schon)\b/.test(t)) return source === 'due' ? 'done' : null;
  if (/\b(nein|nö|nee|nicht mehr|nie|stopp|stop|aufhören|lass das)\b/.test(t)) return source === 'due' ? 'stop' : 'reject';
  if (/\b(ja|jo|ok|okay|passt|gerne|gern|mach|los|anrufen|ruf|buchen|termin|schreib|nachricht|merken|genau|klar|bitte)\b/.test(t)) return source === 'due' ? 'go' : 'accept';
  return null;
}
