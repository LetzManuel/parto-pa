import { diffDays, fromISO, MONTH_NAMES, WEEKDAY_NAMES, type ISODate } from '../time/dates';

/** "heute", "morgen", "am Freitag, 27. November": the way a date is written in a message. */
export function formatSpokenDate(d: ISODate, today: ISODate): string {
  const diff = diffDays(today, d);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === 2) return 'übermorgen';
  const dt = fromISO(d);
  return `am ${WEEKDAY_NAMES[dt.getDay()]}, ${dt.getDate()}. ${MONTH_NAMES[dt.getMonth()]}`;
}
