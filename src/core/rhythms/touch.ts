// Store-level operations for rhythms. Every function here only changes the user's own data; nothing is sent.
// Other modules use logTouch when something happened: the message flow after a confirmed send, the booking flow
// once an appointment is fixed.
import type { Store } from '../db/store';
import type { Rhythm, RhythmKind, Touch } from '../model';
import { allEvents } from '../calendar/feeds';
import { addDays, type ISODate } from '../time/dates';
import { createTouch, lastOccurrence, occurrences, type Occurrence } from './history';
import { learnRhythms, type Candidate } from './learn';
import { createRhythm, fromCandidate, rhythmSuggestions, type RhythmSuggestion, type SuggestionAction } from './engine';
import type { RhythmCommand } from './say';
import { findService, isPersonKey } from './subjects';

export function logTouch(store: Store, d: { subject: string; kind?: RhythmKind; date: ISODate; source: Touch['source']; direction?: Touch['direction'] }): Touch {
  const kind = d.kind ?? (isPersonKey(d.subject) ? 'contact' : findService(d.subject) ? 'booking' : 'task');
  const t = store.save('touch', createTouch({ ...d, kind }));
  // A logged touch also clears a pending "Später" for that rhythm.
  const r = rhythmBySubject(store, d.subject);
  if (r && r.snoozedUntil) store.save('rhythm', { ...r, snoozedUntil: null, updatedAt: new Date().toISOString() });
  return t;
}

export function rhythmBySubject(store: Store, subject: string): Rhythm | undefined {
  return store.list('rhythm').find((r) => r.subject === subject);
}

export function history(store: Store, today: ISODate): Occurrence[] {
  return occurrences({ touches: store.list('touch'), events: allEvents(store), providers: store.list('provider') }, today);
}

export function candidates(store: Store, today: ISODate, hist = history(store, today)): Candidate[] {
  return learnRhythms(hist, store.list('rhythm'), today);
}

export function suggestionsFor(store: Store, today: ISODate): RhythmSuggestion[] {
  const hist = history(store, today);
  return rhythmSuggestions({ rhythms: store.list('rhythm'), history: hist, providers: store.list('provider'), candidates: candidates(store, today, hist) }, today);
}

const touched = (r: Rhythm, patch: Partial<Rhythm>): Rhythm => ({ ...r, ...patch, updatedAt: new Date().toISOString() });

/** "Später": booking rhythms come back in 3 days, people in 2, anything else in 7. */
export function snoozeDays(r: Pick<Rhythm, 'kind'>): number {
  return r.kind === 'booking' ? 3 : r.kind === 'contact' ? 2 : 7;
}

/**
 * Runs a suggestion button (or spoken answer). 'go' itself does not touch data: the UI hands off to the
 * booking or message flow; it only pauses the card for a day so it does not nag while the user is on it.
 */
export function applySuggestionAction(store: Store, s: RhythmSuggestion, action: SuggestionAction, today: ISODate): void {
  if (s.source === 'learned' && s.candidate) {
    if (action === 'accept') store.save('rhythm', fromCandidate(s.candidate));
    if (action === 'reject') store.save('rhythm', { ...fromCandidate(s.candidate), status: 'dismissed' });
    return;
  }
  const r = s.rhythmId ? store.get('rhythm', s.rhythmId) : undefined;
  if (!r) return;
  switch (action) {
    case 'go': store.save('rhythm', touched(r, { snoozedUntil: addDays(today, 1) })); break;
    case 'done': logTouch(store, { subject: r.subject, kind: r.kind, date: today, source: 'suggestion', direction: r.kind === 'contact' ? 'out' : null }); break;
    case 'later': store.save('rhythm', touched(r, { snoozedUntil: addDays(today, snoozeDays(r)) })); break;
    case 'stop': store.save('rhythm', touched(r, { status: 'paused' })); break;
    default: break;
  }
}

/** Applies a confirmed spoken/typed command. Returns a short German confirmation. */
export function applyCommand(store: Store, c: RhythmCommand, today: ISODate): string {
  const existing = rhythmBySubject(store, c.subject);
  switch (c.type) {
    case 'set': {
      if (existing) {
        store.save('rhythm', touched(existing, {
          everyN: c.everyN, everyUnit: c.everyUnit, status: 'active', lastDone: c.lastDone ?? existing.lastDone,
          channel: c.kind === 'contact' ? c.channel ?? existing.channel : existing.channel, label: c.label || existing.label,
        }));
        return 'Rhythmus geändert.';
      }
      // Without a "zuletzt" PA takes the last time from the history, else counts from today.
      const last = c.lastDone ?? lastOccurrence(history(store, today), c.subject) ?? today;
      store.save('rhythm', createRhythm({ subject: c.subject, label: c.label, kind: c.kind, everyN: c.everyN, everyUnit: c.everyUnit, channel: c.channel, lastDone: last }));
      return 'Rhythmus gespeichert.';
    }
    case 'log':
      logTouch(store, { subject: c.subject, kind: c.kind, date: c.date, source: 'voice', direction: c.direction });
      return existing ? 'Eingetragen. PA zählt ab jetzt neu.' : 'Eingetragen.';
    case 'pause':
      if (existing) store.save('rhythm', touched(existing, { status: 'paused' }));
      return existing ? 'Pausiert.' : 'Dazu gibt es keinen Rhythmus.';
    case 'resume':
      if (existing) store.save('rhythm', touched(existing, { status: 'active', snoozedUntil: null }));
      return existing ? 'Wieder aktiv.' : 'Dazu gibt es keinen Rhythmus.';
    case 'delete':
      if (existing) store.remove('rhythm', existing.id);
      return existing ? 'Gelöscht.' : 'Dazu gibt es keinen Rhythmus.';
  }
}
