import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { refreshFeeds } from '../platform/calendar';
import { syncNow } from '../platform/cloud';
import { tick } from '../platform/reminders';
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
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const runSync = useCallback(() => {
    syncNow(store).then((r) => { if (r?.pulled) setVersion((v) => v + 1); }).catch(() => { /* offline: next try later */ });
    // Subscribed calendars: at most every 30 minutes.
    refreshFeeds(store, todayISO(), 30).then((any) => { if (any) setVersion((v) => v + 1); }).catch(() => { /* next try later */ });
  }, [store]);

  // Local change: show it now, sync a few seconds later.
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(runSync, 3000);
  }, [runSync]);

  // Sync on start, when the app comes back to the front, and every minute.
  useEffect(() => {
    runSync();
    const onFocus = () => runSync();
    window.addEventListener('focus', onFocus);
    const iv = setInterval(runSync, 60_000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(iv); };
  }, [runSync]);

  // Appointment reminders and leave-by times: every half minute, and right away when PA comes to the front.
  useEffect(() => {
    const run = () => { tick(store).then((ch) => { if (ch) setVersion((v) => v + 1); }).catch(() => { /* next round */ }); };
    const t = setTimeout(run, 1500);
    const iv = setInterval(run, 30_000);
    document.addEventListener('visibilitychange', run);
    return () => { clearTimeout(t); clearInterval(iv); document.removeEventListener('visibilitychange', run); };
  }, [store]);
  const value = useMemo(() => ({ store, today: startDate(), version, refresh }), [store, version, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function usePA(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('usePA outside Provider');
  return c;
}
