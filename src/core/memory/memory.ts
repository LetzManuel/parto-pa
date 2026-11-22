import type { MemoryCategory, MemoryEntry } from '../model';
import { stamp } from '../model';
import { formatShort, type ISODate } from '../time/dates';

// Health words: entries that match are marked "Gesundheit" (Art. 9 GDPR) and never go to the AI (PA7).
const HEALTH = /(allerg|unverträglich|intoleran|medikament|tablette|diagnose|krank|arzt|ärztin|zahnarzt|zahnärztin|therapie|physio|blutdruck|diabet|schwanger|migräne|asthma|psych|kranken|rezept|impf)/i;
const PERSON = /^([A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?)\s+(mag|hasst|isst|trinkt|heißt|hat|ist|wohnt|arbeitet)\b/u;
const PREFERENCE = /\b(nie|immer|lieber|am liebsten|bevorzug|kein(?:e)?\s+termin|nicht\s+vor|nicht\s+nach|max(?:imal)?\.?|budget|größe|lieblings)/i;

export function guessCategory(text: string): MemoryCategory {
  if (HEALTH.test(text)) return 'health';
  if (PERSON.test(text.trim())) return 'person';
  if (PREFERENCE.test(text)) return 'preference';
  return 'fact';
}

export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  preference: 'Vorliebe',
  person: 'Person',
  fact: 'Fakt',
  health: 'Gesundheit',
};

export function sourceFromMemo(date: ISODate): string {
  return `aus Memo vom ${formatShort(date).split(', ')[1]}`;
}

export function createMemory(text: string, source: string, category?: MemoryCategory, now = new Date()): MemoryEntry {
  const t = text.trim();
  return stamp({ text: t, category: category ?? guessCategory(t), source }, now);
}

/** What may ever leave the device for an AI request (Phase 2+): everything except health entries. */
export function shareableWithAI(entries: MemoryEntry[]): MemoryEntry[] {
  return entries.filter((e) => e.category !== 'health');
}

/** Entries about a person ("Anna mag Orchideen"), for birthday hints. */
export function aboutPerson(entries: MemoryEntry[], person: string): MemoryEntry[] {
  const p = person.toLowerCase();
  return entries.filter((e) => e.text.toLowerCase().startsWith(p + ' ') || e.text.toLowerCase().includes(` ${p} `));
}
