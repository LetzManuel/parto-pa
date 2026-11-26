// Subject keys: one stable key per thing a rhythm is about, so calendar titles, spoken sentences and providers
// all land on the same rhythm. 'friseur' (a service), 'person:anna' (a person), 'task:auto waschen' (anything else).
import type { Provider, ProviderCategory } from '../model';

export interface Service {
  key: string;
  label: string;
  category: ProviderCategory;
  re: RegExp;
}

/** Services PA recognises in calendar titles and speech. Pilot scope: beauty and trades (no doctors, PA14). */
export const SERVICES: Service[] = [
  { key: 'friseur', label: 'Friseur', category: 'beauty', re: /(fris(?:eu|ö)r|haarschnitt|haare\s+schneiden|barber|haarmonie)/i },
  { key: 'manikuere', label: 'Maniküre', category: 'beauty', re: /(manik[üu]re|n[äa]gel|nails)/i },
  { key: 'pedikuere', label: 'Pediküre', category: 'beauty', re: /(pedik[üu]re|fu(?:ß|ss)pflege)/i },
  { key: 'massage', label: 'Massage', category: 'beauty', re: /massage/i },
  { key: 'kosmetik', label: 'Kosmetik', category: 'beauty', re: /(kosmetik|gesichtsbehandlung|wimpern|augenbrauen)/i },
  { key: 'werkstatt', label: 'Werkstatt', category: 'trades', re: /(werkstatt|autoservice|reifenwechsel|[öo]lwechsel)/i },
  { key: 'therme', label: 'Thermenwartung', category: 'trades', re: /(therme|heizung\s*wart|rauchfangkehrer)/i },
];

/** Health words: never learned from the calendar (pilot has no doctors; health stays out of suggestions by default, PA7). */
export const HEALTH_RE = /(arzt|ärztin|zahn|physio|therapie|praxis|klinik|labor|impf|vorsorge|gyn|ordination)/i;

const FAMILY = ['mama', 'papa', 'mutti', 'vati', 'oma', 'opa', 'omi', 'opi', 'tante', 'onkel'];

/** Capitalised words after "mit" that are not people. German capitalises every noun, so this list matters. */
const NOT_PEOPLE = new Set([
  'team', 'kollegen', 'kollegin', 'kolleginnen', 'kunde', 'kunden', 'kundin', 'chef', 'chefin', 'firma', 'abteilung',
  'gruppe', 'klasse', 'verein', 'kinder', 'kindern', 'familie', 'eltern', 'freunden', 'freunde', 'nachbarn', 'auto',
  'bahn', 'zug', 'bus', 'rad', 'hund', 'termin', 'besprechung', 'meeting', 'call', 'zoom', 'teams', 'vorstand', 'partner',
  'anwalt', 'steuerberater', 'bank', 'versicherung', 'elternabend', 'kindergarten', 'schule', 'jour', 'review', 'workshop',
  // words that start a spoken sentence with a capital letter
  'hab', 'habe', 'hatte', 'war', 'bin', 'ich', 'mit', 'mich', 'mir', 'wir', 'und', 'heute', 'gestern', 'vorgestern', 'morgen',
  'bitte', 'ruf', 'rufe', 'will', 'möchte', 'sollte', 'muss', 'alle', 'jede', 'jeden', 'jedes', 'einmal', 'lieber', 'zuletzt',
  'friseur', 'rhythmus', 'erinner', 'erinnere', 'schreib', 'schreibe', 'treffen', 'wieder', 'noch', 'schon',
]);

export function serviceByKey(key: string): Service | undefined {
  return SERVICES.find((s) => s.key === key);
}

export function findService(text: string): Service | undefined {
  return SERVICES.find((s) => s.re.test(text));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function personKey(name: string): string {
  return `person:${norm(name)}`;
}

export function taskKey(label: string): string {
  return `task:${norm(label)}`;
}

export function isPersonKey(key: string): boolean {
  return key.startsWith('person:');
}

/** "anna" → "Anna", "mama" → "Mama". */
export function displayName(name: string): string {
  return name.trim().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

export function isPlausibleName(word: string): boolean {
  const w = word.toLowerCase();
  if (FAMILY.includes(w)) return true;
  return /^\p{Lu}[\p{Ll}-]{1,20}$/u.test(word) && !NOT_PEOPLE.has(w);
}

export const FAMILY_RE = `(?:${FAMILY.join('|')})`;

/** Key of a provider: its service if PA knows it ("Salon Haarmonie · Haarschnitt" → 'friseur'), else its own key. */
export function providerKey(p: Pick<Provider, 'id' | 'name' | 'service'>): string {
  return findService(`${p.service ?? ''} ${p.name}`)?.key ?? `provider:${p.id}`;
}

/** Who a calendar title is about: "Kaffee mit Lisa", "Anna anrufen", "Telefonat Mama", "Besuch bei Oma". */
export function peopleInTitle(title: string): string[] {
  const out = new Set<string>();
  const NAME = `(\\p{Lu}[\\p{Ll}-]+|${FAMILY_RE})`;
  const patterns = [
    new RegExp(`\\b(?:mit|bei|für)\\s+${NAME}`, 'giu'),
    new RegExp(`^${NAME}\\s+(?:anrufen|treffen|besuchen|zurückrufen)`, 'giu'),
    new RegExp(`(?:telefonat|anruf|call|treffen|kaffee|essen|lunch|abendessen|besuch|geburtstag)\\s+${NAME}\\b`, 'giu'),
  ];
  for (const re of patterns) {
    for (const m of title.matchAll(re)) {
      const name = m[1];
      if (isPlausibleName(name) || FAMILY.includes(name.toLowerCase())) out.add(displayName(name));
    }
  }
  return [...out];
}

/** Every subject a calendar title counts for (a service visit, people met). Health appointments count for nothing. */
export function subjectsInTitle(title: string, providers: Provider[] = []): Array<{ key: string; label: string; kind: 'booking' | 'contact' }> {
  if (HEALTH_RE.test(title)) return [];
  const out: Array<{ key: string; label: string; kind: 'booking' | 'contact' }> = [];
  const prov = providers.find((p) => p.name.length > 2 && title.toLowerCase().includes(p.name.toLowerCase()));
  const svc = findService(title);
  if (prov) out.push({ key: providerKey(prov), label: serviceByKey(providerKey(prov))?.label ?? prov.name, kind: 'booking' });
  else if (svc) out.push({ key: svc.key, label: svc.label, kind: 'booking' });
  if (!out.length) for (const name of peopleInTitle(title)) out.push({ key: personKey(name), label: name, kind: 'contact' });
  return out;
}
