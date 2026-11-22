import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Store } from '../core/db/store';
import { today as todayISO, type ISODate } from '../core/time/dates';

interface Ctx {
  store: Store;
  today: ISODate;
  /** Increments on every change, so screens re-read the store. */
  version: number;
  refresh: () => void;
}

const C = createContext<Ctx | null>(null);

/** ?heute=2026-11-22 pins the date (demos, screenshots, tests). */
function startDate(): ISODate {
  const p = new URLSearchParams(location.search).get('heute');
  return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : todayISO();
}

export function Provider({ store, children }: { store: Store; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ store, today: startDate(), version, refresh }), [store, version, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function usePA(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('usePA outside Provider');
  return c;
}
