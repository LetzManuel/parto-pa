// Parto ID sign-in (e-mail code) and sync with the private cloud (Supabase, EU).
// Without VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY the app stays device-only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RawRow, Store } from '../core/db/store';
import { sync, type Remote, type SyncResult } from '../core/sync/engine';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const SPACE_KEY = 'parto-pa.space';

let client: SupabaseClient | null = null;

export function cloudConfigured(): boolean {
  return !!(URL_ && KEY);
}

export function cloud(): SupabaseClient | null {
  if (!cloudConfigured()) return null;
  client ??= createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export function supabaseRemote(c: SupabaseClient): Remote {
  return {
    async push(table: string, rows: RawRow[]) {
      const { error } = await c.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw new Error(`${table}: ${error.message}`);
    },
    async pull(table: string, since: string | null, limit: number) {
      let q = c.from(table).select('*').order('synced_at', { ascending: true }).limit(limit);
      if (since) q = q.gt('synced_at', since);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []) as RawRow[];
    },
  };
}

/** Step 1: Supabase mails a 6-digit code (the auth mail template must contain {{ .Token }}). */
export async function sendCode(email: string): Promise<string | null> {
  const c = cloud();
  if (!c) return 'Cloud ist nicht eingerichtet.';
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  return error ? error.message : null;
}

/** Step 2: code entered → signed in, personal space ready, device data moved into it. */
export async function verifyCode(store: Store, email: string, code: string): Promise<string | null> {
  const c = cloud();
  if (!c) return 'Cloud ist nicht eingerichtet.';
  const { error } = await c.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
  if (error) return error.message;
  return attachSpace(store);
}

export async function attachSpace(store: Store): Promise<string | null> {
  const c = cloud();
  if (!c) return null;
  const { data, error } = await c.rpc('ensure_personal_space');
  if (error) return error.message;
  store.adoptSpace(data as string);
  try { localStorage.setItem(SPACE_KEY, data as string); } catch { /* private mode */ }
  return null;
}

export async function signedInEmail(): Promise<string | null> {
  const c = cloud();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.user.email ?? null;
}

export async function signOut(): Promise<void> {
  await cloud()?.auth.signOut();
}

let running: Promise<SyncResult> | null = null;

/** One sync at a time; returns null when not signed in. */
export async function syncNow(store: Store): Promise<SyncResult | null> {
  const c = cloud();
  if (!c || !(await signedInEmail())) return null;
  running ??= sync(store, supabaseRemote(c)).finally(() => { running = null; });
  const r = await running;
  store.setMeta('lastSync', new Date().toISOString());
  return r;
}
