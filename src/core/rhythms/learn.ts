// Learning rhythms from the history, on the device, without AI: simple statistics on the gaps between occurrences.
// A learned rhythm is only a proposal ("Du warst etwa alle 5 Wochen beim Friseur. Merken?"). PA never starts
// suggesting from it until the user confirms it, and a "Nein" is kept so the proposal does not come back.
import type { Rhythm, RhythmKind } from '../model';
import { addDays, diffDays, type ISODate, type Unit } from '../time/dates';
import { byKey, type Occurrence } from './history';
import { isPersonKey } from './subjects';

export interface Candidate {
  key: string;
  label: string;
  kind: RhythmKind;
  everyN: number;
  everyUnit: Unit;
  /** Typical gap in days (median). */
  gapDays: number;
  lastDone: ISODate;
  count: number;
  /** 0..1 */
  confidence: number;
}

/** Look back one year; habits older than that do not count. */
export const LOOKBACK_DAYS = 365;
/** At least three times (two gaps) before PA dares to call it a rhythm. */
export const MIN_OCCURRENCES = 3;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Days → the interval a person would say: "alle 5 Wochen", "alle 3 Monate", "alle 10 Tage". */
export function roundInterval(days: number): { everyN: number; everyUnit: Unit } {
  if (days < 12) return { everyN: Math.max(1, Math.round(days)), everyUnit: 'day' };
  if (days <= 84) return { everyN: Math.max(1, Math.round(days / 7)), everyUnit: 'week' };
  if (days <= 540) return { everyN: Math.max(1, Math.round(days / 30.44)), everyUnit: 'month' };
  return { everyN: Math.max(1, Math.round(days / 365)), everyUnit: 'year' };
}

export function intervalDays(everyN: number, unit: Unit): number {
  return unit === 'day' ? everyN : unit === 'week' ? everyN * 7 : unit === 'month' ? everyN * 30.44 : everyN * 365;
}

/**
 * Candidates from the history. Skips keys that already have a rhythm (any status, so a "Nein" sticks)
 * and keys in `skip` (e.g. a provider that already has its own rhythm).
 */
export function learnRhythms(
  history: Occurrence[],
  existing: Pick<Rhythm, 'subject'>[],
  today: ISODate,
  skip: Set<string> = new Set(),
): Candidate[] {
  const known = new Set(existing.map((r) => r.subject));
  const since = addDays(today, -LOOKBACK_DAYS);
  const out: Candidate[] = [];
  for (const [key, all] of byKey(history)) {
    if (known.has(key) || skip.has(key)) continue;
    const occ = all.filter((o) => o.date >= since);
    if (occ.length < MIN_OCCURRENCES) continue;
    const gaps = occ.slice(1).map((o, i) => diffDays(occ[i].date, o.date));
    const m = median(gaps);
    if (m < 5 || m > 200) continue; // daily routines and yearly events are not what this is for
    // Regular enough: the typical gap varies by at most ~35 % (median absolute deviation).
    const spread = median(gaps.map((g) => Math.abs(g - m))) / m;
    if (spread > 0.35) continue;
    // ...and at least three in four gaps are close to it (one holiday gap is fine, a pattern of outliers is not).
    if (gaps.filter((g) => g >= 0.6 * m && g <= 1.5 * m).length / gaps.length < 0.75) continue;
    const last = occ[occ.length - 1].date;
    // Still a habit: the last time is not much longer ago than two gaps.
    if (diffDays(last, today) > 2.5 * m) continue;
    const label = [...occ].reverse().find((o) => o.label)?.label ?? key.replace(/^\w+:/, '');
    const confidence = Math.min(1, 0.45 + 0.1 * (occ.length - MIN_OCCURRENCES) + 0.4 * (1 - spread / 0.35));
    out.push({
      key, label, kind: occ[occ.length - 1].kind === 'task' ? 'task' : isPersonKey(key) ? 'contact' : occ[occ.length - 1].kind,
      ...roundInterval(m), gapDays: m, lastDone: last, count: occ.length, confidence: Math.round(confidence * 100) / 100,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
