import type { Database, SqlValue } from 'sql.js';
import type { CalEvent, Deadline, MemoryEntry, Memo, Order, Provider } from '../model';
import { MIGRATIONS, TABLES, type TableKey } from './schema';

export interface RowTypes {
  order: Order;
  provider: Provider;
  deadline: Deadline;
  memory: MemoryEntry;
  event: CalEvent;
  memo: Memo;
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const q = (col: string) => `"${col}"`;

/** Thin data access over the local SQLite database. All reads skip soft-deleted rows. */
export class Store {
  constructor(private db: Database, readonly spaceId: string, private onChange: () => void = () => {}) {
    migrate(db);
  }

  list<K extends TableKey>(table: K): RowTypes[K][] {
    const t = TABLES[table];
    const res = this.db.exec(`SELECT * FROM ${t.name} WHERE deleted = 0 AND space_id = ? ORDER BY created_at`, [this.spaceId]);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const o: Record<string, unknown> = {};
      columns.forEach((c, i) => {
        if (c === 'deleted' || c === 'space_id') return;
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
       ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}, deleted = 0`,
      vals,
    );
    this.onChange();
    return row;
  }

  /** Soft delete, so a later sync can pass the deletion on. */
  remove(table: TableKey, id: string): void {
    this.db.run(`UPDATE ${TABLES[table].name} SET deleted = 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
    this.onChange();
  }

  /** "Alles vergessen": deletes memory and memos at once (assistant history follows in Phase 2). */
  forgetAll(): void {
    const now = new Date().toISOString();
    for (const t of ['memory', 'memo'] as const) {
      this.db.run(`UPDATE ${TABLES[t].name} SET deleted = 1, updated_at = ? WHERE space_id = ?`, [now, this.spaceId]);
    }
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
