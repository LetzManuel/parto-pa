import type { Deadline, DeadlineKind } from '../model';
import { stamp } from '../model';
import { addDays, addInterval, type ISODate, type Unit } from '../time/dates';

export interface DeadlineKindInfo {
  label: string;
  leadDays: number;
  every: [number, Unit] | null;
  /** Health-related (Art. 9 GDPR): never handed to the AI, marked in the UI. */
  health?: boolean;
  hint: string;
}

/** Defaults for Austrian everyday deadlines. The user can change every value. */
export const DEADLINE_KINDS: Record<DeadlineKind, DeadlineKindInfo> = {
  pickerl: { label: '§57a-Pickerl', leadDays: 30, every: [1, 'year'], hint: 'Begutachtung ist ab einem Monat vor dem Lochmonat möglich' },
  passport: { label: 'Reisepass', leadDays: 120, every: [10, 'year'], hint: 'Neuer Pass braucht einige Wochen' },
  idcard: { label: 'Personalausweis', leadDays: 60, every: [10, 'year'], hint: '' },
  warranty: { label: 'Garantie-Ende', leadDays: 30, every: null, hint: 'Mängel vor dem Ende melden' },
  contract: { label: 'Kündigungsfrist', leadDays: 30, every: [1, 'year'], hint: 'Datum = letzter Tag zum Kündigen' },
  checkup: { label: 'Vorsorge', leadDays: 30, every: [1, 'year'], health: true, hint: '' },
  other: { label: 'Frist', leadDays: 14, every: null, hint: '' },
};

export function createDeadline(d: { title?: string; kind: DeadlineKind; dueDate: ISODate; note?: string }, now = new Date()): Deadline {
  const info = DEADLINE_KINDS[d.kind];
  return stamp({
    title: d.title?.trim() || info.label,
    kind: d.kind,
    dueDate: d.dueDate,
    leadDays: info.leadDays,
    everyN: info.every?.[0] ?? null,
    everyUnit: info.every?.[1] ?? null,
    note: d.note ?? null,
  }, now);
}

export function remindFrom(d: Deadline): ISODate {
  return addDays(d.dueDate, -d.leadDays);
}

/** Renewed / handled: a recurring deadline moves to its next date, a one-off one returns null (delete it). */
export function renew(d: Deadline, now = new Date()): Deadline | null {
  if (!d.everyN || !d.everyUnit) return null;
  return { ...d, dueDate: addInterval(d.dueDate, d.everyN, d.everyUnit), updatedAt: now.toISOString() };
}
