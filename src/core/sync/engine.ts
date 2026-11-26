// Sync between the local SQLite copy and the cloud (Supabase). Same idea as Parto Projects, simpler for the pilot:
// push rows marked dirty, pull rows the cloud stamped since the last pull, newer updated_at wins on both sides
// (cloud trigger pa_keep_newer, Store.applyRemote). Deletions travel as soft deletes.
import type { RawRow, Store } from '../db/store';
import { TABLES, type TableKey } from '../db/schema';

/** What the engine needs from the cloud. Supabase in the app, PGlite in tests. */
export interface Remote {
  /** Upsert rows (cloud column types: booleans for deleted/tentative). */
  push(table: string, rows: RawRow[]): Promise<void>;
  /** Rows with synced_at after the cursor, oldest first, at most `limit`. */
  pull(table: string, since: string | null, limit: number): Promise<RawRow[]>;
}

export const SYNC_ORDER: TableKey[] = ['provider', 'order', 'deadline', 'memory', 'event', 'memo', 'shopList', 'shopRun', 'favourite', 'rhythm', 'touch'];
const BOOLS = new Set(['deleted', 'tentative']);
const PAGE = 500;

export interface SyncResult { pushed: number; pulled: number }

export async function sync(store: Store, remote: Remote): Promise<SyncResult> {
  let pushed = 0, pulled = 0;
  for (const key of SYNC_ORDER) {
    const table = TABLES[key].name;

    const dirty = store.dirtyRows(key);
    if (dirty.length) {
      await remote.push(table, dirty.map(toCloud));
      for (const r of dirty) store.markClean(key, r.id as string, r.updated_at as string);
      pushed += dirty.length;
    }

    let cursor = store.getMeta(`pull:${table}`);
    for (;;) {
      const rows = await remote.pull(table, cursor, PAGE);
      if (!rows.length) break;
      pulled += store.applyRemote(key, rows.map(toLocal));
      cursor = String(rows[rows.length - 1].synced_at);
      store.setMeta(`pull:${table}`, cursor);
      if (rows.length < PAGE) break;
    }
  }
  return { pushed, pulled };
}

export function toCloud(r: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(r)) out[k] = BOOLS.has(k) ? ((v ? true : false) as unknown as RawRow[string]) : v;
  return out;
}

export function toLocal(r: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'synced_at') continue;
    const val = v as unknown;
    if (BOOLS.has(k)) out[k] = val ? 1 : 0;
    else if (val instanceof Date) out[k] = k.endsWith('_at') ? val.toISOString() : val.toISOString().slice(0, 10);
    else out[k] = v;
  }
  return out;
}
