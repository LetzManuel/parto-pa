// What a calendar LOCATION means for travel, and links into the navigation app (no key, no cost).
import type { Mode, NavApp } from './prefs';

export type PlaceKind = 'none' | 'online' | 'place';

const ONLINE = /\b(zoom|teams|microsoft teams|google meet|meet\.google|webex|skype|whereby|jitsi|online|virtuell|telefon(?:isch)?|anruf|call)\b/i;
const URL_RE = /https?:\/\/[^\s,;<>"]+/i;

export function classifyLocation(loc: string | null | undefined): { kind: PlaceKind; url?: string } {
  const s = (loc ?? '').trim();
  if (!s) return { kind: 'none' };
  const url = s.match(URL_RE)?.[0];
  if (url) return { kind: 'online', url };
  if (ONLINE.test(s) && s.split(/\s+/).length <= 4) return { kind: 'online' };
  return { kind: 'place' };
}

const GOOGLE_MODE: Record<Mode, string> = { car: 'driving', transit: 'transit', walk: 'walking', bike: 'bicycling' };
const APPLE_MODE: Record<Mode, string> = { car: 'd', transit: 'r', walk: 'w', bike: 'w' };

/** Opens directions from where the phone is to the place. */
export function navUrl(dest: string, mode: Mode, app: NavApp): string {
  const d = encodeURIComponent(dest);
  return app === 'apple'
    ? `https://maps.apple.com/?daddr=${d}&dirflg=${APPLE_MODE[mode]}`
    : `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=${GOOGLE_MODE[mode]}`;
}
