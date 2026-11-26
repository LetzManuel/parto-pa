// Shows reminders as system notifications with one action, and reads them out if wanted.
// Web version: works while PA is open or in the background on the phone. Reminders on the lock screen while PA is
// closed need the phone app shell (local notifications) or web push; both plug in here later.
import type { Reminder } from '../core/reminders/plan';

export type NotifyState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyState(): NotifyState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function askNotify(): Promise<NotifyState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export async function showReminder(r: Reminder): Promise<void> {
  if (notifyState() !== 'granted') return;
  const opts: NotificationOptions & { actions?: Array<{ action: string; title: string }> } = {
    body: r.body, tag: r.id, icon: './icon-192.png', badge: './favicon-64.png',
    data: { url: r.action?.url ?? null },
    actions: r.action ? [{ action: 'go', title: r.action.label }] : [],
  };
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) { await reg.showNotification(r.title, opts); return; }
  const n = new Notification(r.title, opts);
  n.onclick = () => { if (r.action) window.open(r.action.url, '_blank'); else window.focus(); n.close(); };
}

export function say(text: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-AT';
  speechSynthesis.speak(u);
}
