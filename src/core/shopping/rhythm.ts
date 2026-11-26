// Rhythms → recurring orders: when the same basket was ordered at regular gaps ("Pizza Freitag" four Fridays in a
// row), PA proposes to make it a recurring basket. Same statistics as the personal rhythms (rhythms/learn.ts), fed
// with the order history (shop_run). Only a proposal: nothing changes before "Ja", and a "Nein" sticks.
import { learnRhythms } from '../rhythms/learn';
import type { Occurrence } from '../rhythms/history';
import type { ShopList, ShopRun } from '../model';
import { fromISO, type ISODate, type Unit } from '../time/dates';
import { onWeekday } from './lists';

export interface BasketProposal {
  list: ShopList;
  everyN: number;
  everyUnit: Unit;
  /** Set when nearly every order fell on the same weekday (0 = Sunday). */
  weekday: number | null;
  count: number;
}

const key = (id: string) => `shop:${id}`;

export function basketProposals(lists: ShopList[], runs: ShopRun[], today: ISODate, declined: Set<string> = new Set()): BasketProposal[] {
  const oneOff = lists.filter((l) => !l.everyN && !declined.has(l.id));
  const ids = new Set(oneOff.map((l) => l.id));
  const occ: Occurrence[] = runs.filter((r) => r.listId && ids.has(r.listId))
    .map((r) => ({ key: key(r.listId!), label: '', kind: 'task', date: r.date, from: 'touch' }));
  return learnRhythms(occ, [], today).flatMap((c) => {
    const list = oneOff.find((l) => key(l.id) === c.key);
    if (!list) return [];
    // Orders think in weeks: 6–8 days is "jede Woche" (personal rhythms would say "alle 7 Tage").
    const weekly = c.everyUnit === 'day' && c.gapDays >= 6 && c.gapDays <= 8;
    const everyN = weekly ? 1 : c.everyN, everyUnit: Unit = weekly ? 'week' : c.everyUnit;
    const days = runs.filter((r) => r.listId === list.id).map((r) => fromISO(r.date).getDay());
    const top = [0, 1, 2, 3, 4, 5, 6].map((d) => [d, days.filter((x) => x === d).length] as const).sort((a, b) => b[1] - a[1])[0];
    const weekday = everyUnit === 'week' && top[1] / days.length >= 0.75 ? top[0] : null;
    return [{ list, everyN, everyUnit, weekday, count: c.count }];
  });
}

/** The basket after "Ja": recurring, next round prepared one day ahead as usual. */
export function acceptProposal(p: BasketProposal, today: ISODate): ShopList {
  return {
    ...p.list, everyN: p.everyN, everyUnit: p.everyUnit, weekday: p.weekday, state: 'active',
    nextDate: onWeekday(today, p.weekday), updatedAt: new Date().toISOString(),
  };
}
