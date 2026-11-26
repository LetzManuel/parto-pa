// Travel time without a routing service: straight-line distance, a detour factor and typical speeds in and around
// Vienna. Used when no route service is set up or reachable; shown to the person as "geschätzt".
import type { Mode } from './prefs';

export interface LatLng { lat: number; lng: number }

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minutes door to door, rounded up to 5 (an estimate should not look more exact than it is). */
export function estimateMinutes(a: LatLng, b: LatLng, mode: Mode): number {
  const km = distanceKm(a, b);
  let min: number;
  switch (mode) {
    case 'walk': min = (km * 1.25) / 4.8 * 60; break;
    case 'bike': min = (km * 1.25) / 15 * 60 + 2; break;
    // Town traffic ~25 km/h, longer trips mostly on fast roads; plus parking.
    case 'car': min = (km < 15 ? (km * 1.35) / 25 : 15 * 1.35 / 25 + ((km - 15) * 1.25) / 75) * 60 + 5; break;
    // Walk to the stop and wait, then ~22 km/h in town, faster on regional trains.
    case 'transit': min = 10 + (km < 20 ? (km * 1.3) / 22 : 20 * 1.3 / 22 + ((km - 20) * 1.2) / 55) * 60; break;
  }
  return Math.max(5, Math.ceil(min / 5) * 5);
}
