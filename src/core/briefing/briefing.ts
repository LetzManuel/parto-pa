// Morning briefing and the daily hints. "Proaktiv, aber ruhig": at most three active hints a day,
// everything else waits in the briefing. Built from local data only, no AI, so it never counts as an order.
import type { CalEvent, Deadline, MemoryEntry, Order, Provider } from '../model';
import { isActive, nextOccurrence, suggestFrom } from '../orders/flow';
import { remindFrom } from '../deadlines/deadlines';
import { aboutPerson } from '../memory/memory';
import { diffDays, formatShort, workdaysBetween, type ISODate } from '../time/dates';

export type ActionId =
  | 'done' | 'snooze' | 'wait' | 'fallback' | 'requested' | 'cancel' | 'book' | 'renew' | 'plan';

export interface Action { id: ActionId; label: string }

export interface Hint {
  key: string;
  target: { type: 'order' | 'deadline'; id: string };
  priority: number;
  title: string;
  text: string;
  actions: Action[];
}

export interface Briefing {
  date: ISODate;
  events: CalEvent[];
  /** "Wartet auf dich": decisions, most important first. */
  decisions: Hint[];
  /** "Heute erledigt PA": what PA keeps running without the user. */
  paHandles: string[];
  /** Deadlines in the next 60 days that are not due for a decision yet. */
  upcoming: Deadline[];
}

export const MAX_ACTIVE_HINTS = 3;

const A = {
  done: { id: 'done', label: 'Erledigt' },
  snooze: { id: 'snooze', label: 'Später' },
  wait: { id: 'wait', label: 'Weiter warten' },
  fallback: { id: 'fallback', label: 'Plan B' },
  requested: { id: 'requested', label: 'Angefragt' },
  book: { id: 'book', label: 'Termin ausmachen' },
  renew: { id: 'renew', label: 'Erneuert' },
  plan: { id: 'plan', label: 'Als Auftrag' },
} satisfies Record<string, Action>;

export function buildBriefing(
  input: { orders: Order[]; deadlines: Deadline[]; providers: Provider[]; memory: MemoryEntry[]; events: CalEvent[] },
  today: ISODate,
): Briefing {
  const decisions: Hint[] = [];
  const paHandles: string[] = [];
  const providerName = (id: string | null) => input.providers.find((p) => p.id === id)?.name;

  for (const o of input.orders.filter(isActive)) {
    const t = { type: 'order' as const, id: o.id };
    if (o.kind === 'conditional') {
      const who = o.waitingFor ?? 'jemand';
      if (o.dueDate && o.dueDate <= today) {
        decisions.push({ key: o.id, target: t, priority: 90, title: o.title,
          text: `${cap(who)} hat sich bis ${formatShort(o.dueDate, today)} nicht gemeldet. Plan B: ${o.fallback ?? '–'}?`,
          actions: [A.fallback, A.wait, A.done] });
      } else {
        paHandles.push(`${o.title}: wartet${o.dueDate ? ` bis ${formatShort(o.dueDate, today)}` : ''}, dann Plan B: ${o.fallback ?? '–'}`);
      }
      continue;
    }
    if (o.state === 'waiting') {
      const who = o.waitingFor ?? providerName(o.providerId) ?? 'Antwort';
      if (o.dueDate && o.dueDate <= today) {
        const n = workdaysBetween(addBack(o), today);
        decisions.push({ key: o.id, target: t, priority: 80, title: o.title,
          text: `${cap(who)} hat ${n > 1 ? `seit ${n} Werktagen ` : ''}nicht geantwortet. Nachfassen, anders lösen oder warten?`,
          actions: [A.requested, A.wait, A.done] });
      } else {
        paHandles.push(`${o.title}: wartet auf Antwort${o.dueDate ? `, fasst ${formatShort(o.dueDate, today)} nach` : ''}`);
      }
      continue;
    }
    switch (o.kind) {
      case 'reminder':
      case 'followup':
        if (o.dueDate && o.dueDate <= today) {
          decisions.push({ key: o.id, target: t, priority: o.dueDate < today ? 75 : 70, title: o.title,
            text: o.dueDate < today ? `Fällig seit ${formatShort(o.dueDate, today)}` : 'Heute fällig', actions: [A.done, A.snooze] });
        } else if (o.dueDate) {
          paHandles.push(`Erinnert ${formatShort(o.dueDate, today)}: ${o.title}`);
        }
        break;
      case 'location':
        paHandles.push(`Erinnert dich bei ${o.place ?? '…'}: ${o.title}`);
        break;
      case 'recurring': {
        const from = suggestFrom(o);
        const next = nextOccurrence(o);
        if (from && from <= today) {
          const since = o.lastDone ? sinceText(o.lastDone, today) : null;
          decisions.push({ key: o.id, target: t, priority: 50, title: o.title,
            text: since ? `${o.title} ist ${since} her. Termin ausmachen?` : `Zeit für ${o.title}. Termin ausmachen?`,
            actions: o.providerId ? [A.book, A.done, A.snooze] : [A.done, A.snooze] });
        } else if (next) {
          paHandles.push(`Behält ${o.title} im Blick (wieder ab ${formatShort(from ?? next, today)})`);
        }
        break;
      }
      case 'birthday':
        if (o.dueDate && diffDays(today, o.dueDate) <= o.leadDays && o.dueDate >= today) {
          const facts = aboutPerson(input.memory, o.title.replace(/^Geburtstag\s+/, ''));
          const days = diffDays(today, o.dueDate);
          decisions.push({ key: o.id, target: t, priority: days === 0 ? 85 : 40, title: o.title,
            text: `${days === 0 ? 'Heute' : formatShort(o.dueDate, today)}${facts.length ? ` · Gedächtnis: ${facts.map((f) => f.text).join('; ')}` : ''}`,
            actions: [A.done, A.snooze] });
        }
        break;
    }
  }

  const upcoming: Deadline[] = [];
  for (const d of input.deadlines) {
    const t = { type: 'deadline' as const, id: d.id };
    if (remindFrom(d) <= today) {
      const days = diffDays(today, d.dueDate);
      decisions.push({ key: d.id, target: t, priority: days < 0 ? 95 : 60 + Math.max(0, 30 - days) / 3, title: d.title,
        text: days < 0 ? `Abgelaufen seit ${formatShort(d.dueDate, today)}!` : days === 0 ? 'Läuft heute ab' : `Läuft ${formatShort(d.dueDate, today)} ab (in ${days} Tagen)`,
        actions: [A.plan, A.renew, A.snooze] });
    } else if (diffDays(today, d.dueDate) <= 60) {
      upcoming.push(d);
    }
  }

  decisions.sort((a, b) => b.priority - a.priority);
  upcoming.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const events = input.events.filter((e) => e.date === today).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  return { date: today, events, decisions, paHandles, upcoming };
}

/** The hints that may notify today; the rest stays quietly in the briefing. */
export function activeHints(b: Briefing, alreadyShownToday = 0): Hint[] {
  return b.decisions.slice(0, Math.max(0, MAX_ACTIVE_HINTS - alreadyShownToday));
}

function sinceText(from: ISODate, to: ISODate): string {
  const d = diffDays(from, to);
  if (d >= 60) return `${Math.round(d / 30)} Monate`;
  if (d >= 14) return `${Math.round(d / 7)} Wochen`;
  return `${d} Tage`;
}

/** Start of the waiting period, for "seit n Werktagen". */
function addBack(o: Order): ISODate {
  return o.updatedAt.slice(0, 10);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
