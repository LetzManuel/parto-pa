import type { Database, SqlValue } from 'sql.js';
import type { CalEvent, Deadline, MemoryEntry, Memo, Order, Provider, ShopList, ShopRun } from '../model';
import type { Favourite } from '../favourites/model';
import { MIGRATIONS, TABLES, type TableKey } from './schema';

export interface RowTypes {
  order: Order;
  provider: Provider;
  deadline: Deadline;
  memory: MemoryEntry;
  event: CalEvent;
  memo: Memo;
  shopList: ShopList;
  shopRun: ShopRun;
  favourite: Favourite;
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const q = (col: string) => `"${col}"`;

/** Thin data access over the local SQLite database. All reads skip soft-deleted rows. */
/** A row as stored and synced: all columns in snake_case, including space_id and deleted. */
export type RawRow = Record<string, SqlValue>;

export class Store {
  constructor(private db: Database, private space: string, private onChange: () => void = () => {}) {
    migrate(db);
  }

  get spaceId(): string {
    return this.space;
  }

  list<K extends TableKey>(table: K): RowTypes[K][] {
    const t = TABLES[table];
    const res = this.db.exec(`SELECT * FROM ${t.name} WHERE deleted = 0 AND space_id = ? ORDER BY created_at`, [this.spaceId]);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const o: Record<string, unknown> = {};
      columns.forEach((c, i) => {
        if (c === 'deleted' || c === 'space_id' || c === 'dirty') return;
        const k = camel(c);
        o[k] = (t.bools as readonly string[]).includes(k) ? row[i] === 1 : row[i];
      });
      return o as unknown as RowTypes[K];
    });
  }

  get<K extends TableKey>(table: K, id: string): RowTypes[K] | undefined {
    return this.list(table).find((r) => r.id === id);
  }

  save<K extends TableKey>(table: K, row: RowTypes[K]): RowTypes[K] {
    const t = TABLES[table];
    const entries = Object.entries(row).filter(([, v]) => v !== undefined);
    const cols = ['space_id', ...entries.map(([k]) => snake(k))];
    const vals: SqlValue[] = [this.spaceId, ...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as SqlValue)))];
    const updates = cols.filter((c) => c !== 'id' && c !== 'created_at').map((c) => `${q(c)} = excluded.${q(c)}`);
    this.db.run(
      `INSERT INTO ${t.name} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}, deleted = 0, dirty = 1`,
      vals,
    );
    this.onChange();
    return row;
  }

  /** Soft delete, so a later sync can pass the deletion on. */
  remove(table: TableKey, id: string): void {
    this.db.run(`UPDATE ${TABLES[table].name} SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
    this.onChange();
  }

  /** "Alles vergessen": deletes memory and memos at once (assistant history follows in Phase 2). */
  forgetAll(): void {
    const now = new Date().toISOString();
    for (const t of ['memory', 'memo'] as const) {
      this.db.run(`UPDATE ${TABLES[t].name} SET deleted = 1, dirty = 1, updated_at = ? WHERE space_id = ? AND deleted = 0`, [now, this.spaceId]);
    }
    this.onChange();
  }

  // ---- sync support ----

  /** Rows changed on this device and not pushed yet (deleted ones included, so deletions reach the cloud). */
  dirtyRows(table: TableKey): RawRow[] {
    const res = this.db.exec(`SELECT * FROM ${TABLES[table].name} WHERE dirty = 1 AND space_id = ?`, [this.spaceId]);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((v) => Object.fromEntries(columns.filter((c) => c !== 'dirty').map((c) => [c, v[columns.indexOf(c)]])));
  }

  /** After a push: clean, unless the row changed again meanwhile. */
  markClean(table: TableKey, id: string, updatedAt: string): void {
    this.db.run(`UPDATE ${TABLES[table].name} SET dirty = 0 WHERE id = ? AND updated_at = ?`, [id, updatedAt]);
  }

  /**
   * Rows from the cloud. The newer updated_at wins; a local change that is newer stays and is pushed later.
   * Returns how many rows changed locally.
   */
  applyRemote(table: TableKey, rows: RawRow[]): number {
    const t = TABLES[table].name;
    let n = 0;
    for (const r of rows) {
      const local = this.db.exec(`SELECT updated_at FROM ${t} WHERE id = ?`, [r.id as string])[0]?.values[0]?.[0] as string | undefined;
      if (local && local > (r.updated_at as string)) continue;
      const cols = Object.keys(r);
      const updates = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`);
      this.db.run(
        `INSERT INTO ${t} (${cols.map(q).join(', ')}, dirty) VALUES (${cols.map(() => '?').join(', ')}, 0)
         ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}, dirty = 0`,
        cols.map((c) => r[c]),
      );
      n++;
    }
    if (n) this.onChange();
    return n;
  }

  /** First sign-in: rows made before (in the device-only space) move into the person's cloud space. */
  adoptSpace(cloudSpace: string): void {
    if (cloudSpace === this.space) return;
    for (const { name } of Object.values(TABLES)) {
      this.db.run(`UPDATE ${name} SET space_id = ?, dirty = 1 WHERE space_id = ?`, [cloudSpace, this.space]);
    }
    this.space = cloudSpace;
    this.onChange();
  }

  getMeta(key: string): string | null {
    const r = this.db.exec('SELECT value FROM meta WHERE key = ?', [key]);
    return (r[0]?.values[0]?.[0] as string | undefined) ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
    this.onChange();
  }
}

export function migrate(db: Database): void {
  db.run('PRAGMA foreign_keys = ON');
  const v = (db.exec('PRAGMA user_version')[0]?.values[0]?.[0] as number) ?? 0;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.run('BEGIN');
    db.run(MIGRATIONS[i]);
    db.run(`PRAGMA user_version = ${i + 1}`);
    db.run('COMMIT');
  }
}
