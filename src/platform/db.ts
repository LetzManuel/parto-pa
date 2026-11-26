// Browser preview: sql.js in memory, saved to localStorage after each change.
// The phone app (Tauri, as in Parto Projects) will use a SQLite file instead; Store stays the same.
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Store } from '../core/db/store';

const KEY = 'parto-pa.db';
const SPACE_KEY = 'parto-pa.space';

function load(): Uint8Array | undefined {
  try {
    const b64 = localStorage.getItem(KEY);
    if (!b64) return undefined;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

export async function openStore(): Promise<Store> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(load());
  let space = '';
  try { space = localStorage.getItem(SPACE_KEY) ?? ''; } catch { /* private mode */ }
  if (!space) {
    space = crypto.randomUUID();
    try { localStorage.setItem(SPACE_KEY, space); } catch { /* private mode */ }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const bytes = db.export();
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try { localStorage.setItem(KEY, btoa(s)); } catch { /* storage full or blocked */ }
    }, 200);
  };
  return new Store(db, space, persist);
}
