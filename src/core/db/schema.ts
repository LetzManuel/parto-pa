// Local SQLite schema (sql.js in the browser, later tauri-plugin-sql on the phone).
// Same rules as Parto Projects: uuid ids, created_at/updated_at, soft delete (deleted = 1), MIGRATIONS append only.
// Every row carries space_id: the person's own space (group of kind 'personal'), so cloud RLS can use
// is_group_member(space_id) exactly like Parto People.

export const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE pa_order (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    due_date TEXT, wait_days INTEGER NOT NULL DEFAULT 2, waiting_for TEXT, fallback TEXT, place TEXT,
    every_n INTEGER, every_unit TEXT, lead_days INTEGER NOT NULL DEFAULT 14, last_done TEXT,
    provider_id TEXT, source TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE provider (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, service TEXT,
    phone TEXT, email TEXT, website TEXT, booking_way TEXT NOT NULL, every_n INTEGER, every_unit TEXT,
    last_visit TEXT, contact_person TEXT, notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE deadline (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, due_date TEXT NOT NULL,
    lead_days INTEGER NOT NULL, every_n INTEGER, every_unit TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE memory (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, text TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE cal_event (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, start TEXT, "end" TEXT,
    tentative INTEGER NOT NULL DEFAULT 0, order_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE memo (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL, text TEXT NOT NULL, result TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX pa_order_due ON pa_order (state, due_date);
  CREATE INDEX cal_event_date ON cal_event (date);
  `,
  /* v2: sync – rows changed on this device since the last push */ `
  ALTER TABLE pa_order ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE provider ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE deadline ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE memory ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE cal_event ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE memo ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  `,
];

export const TABLES = {
  order: { name: 'pa_order', bools: [] as string[] },
  provider: { name: 'provider', bools: [] as string[] },
  deadline: { name: 'deadline', bools: [] as string[] },
  memory: { name: 'memory', bools: [] as string[] },
  event: { name: 'cal_event', bools: ['tentative'] },
  memo: { name: 'memo', bools: [] as string[] },
} as const;

export type TableKey = keyof typeof TABLES;
