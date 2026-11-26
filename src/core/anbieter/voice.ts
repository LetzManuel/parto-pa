// Voice editing of "Meine Anbieter", on the device, fixed patterns (no AI). Every command comes back with one
// sentence to read out and confirm ("gurkerl an erste Stelle bei Lebensmittel?"); nothing changes before "ja".
//   "gurkerl zuerst" · "Haarwerk an erster Stelle" · "Barber Joe auf Platz 2"
//   "Neuer Friseur Salon Lisa 01 234 56 78" · "Neue Zahnärztin Dr. Berger" · "Wolt als Lieferdienst"
//   "Barber Joe löschen" · "Stichwort Spitzen schneiden für Friseur" · "Nägel gehört zu Kosmetik"
import type { Store } from '../db/store';
import { LIST_LABEL, type Favourite, type ListKind } from '../favourites/model';
import { parseNumber } from '../templates/when';
import { ALIASES, PLATFORMS, platform } from '../shopping/platforms';
import { applyShopRule, parseShopRule, type ShopRule } from '../shopping/rules';
import { applyMove, entries, newEntry, newKeyword, removeEntry, shopEntry } from './lists';

export type AnbieterCommand =
  | { type: 'move'; kind: ListKind; id: string | null; platformId?: string; name: string; to: number; confirm: string }
  | { type: 'add'; kind: ListKind; name: string; topic: string | null; phone: string | null; platformId?: string; confirm: string }
  | { type: 'remove'; kind: ListKind; id: string; name: string; confirm: string }
  | { type: 'keyword'; kind: ListKind; word: string; confirm: string }
  /** Order rules and rankings for shops and restaurants (core/shopping/rules.ts). */
  | { type: 'shop'; kind: ListKind; rule: ShopRule; confirm: string };

/** Spoken list names. Doctors carry their field as topic. */
const LIST_WORDS: Array<[ListKind, RegExp, string | null]> = [
  ['doctor', /^zahn(?:arzt|ärztin)/i, 'Zahnarzt'], ['doctor', /^haus(?:arzt|ärztin)/i, 'Hausarzt'],
  ['doctor', /^haut(?:arzt|ärztin)/i, 'Hautarzt'], ['doctor', /^frauen(?:arzt|ärztin)/i, 'Frauenarzt'],
  ['doctor', /^augen(?:arzt|ärztin)/i, 'Augenarzt'], ['doctor', /^kinder(?:arzt|ärztin)/i, 'Kinderarzt'],
  ['doctor', /^(?:physio|physiotherapeut)/i, 'Physiotherapie'], ['doctor', /^(?:arzt|ärztin|ärzte|doktor)/i, null],
  ['salon', /^(?:friseur|frisör|friseurin|frisörin|barber)/i, null],
  ['beauty', /^(?:kosmetik|kosmetikerin|kosmetiker|nagelstudio|nägel|maniküre|pediküre|massage|beauty)/i, null],
  ['restaurant', /^(?:restaurant|lokal|wirtshaus|heurige)/i, null],
  ['tickets', /^(?:tickets?|karten|ticketshop)/i, null],
  ['babysitter', /^(?:babysitter|babysitterin|kinderbetreuung)/i, null],
  ['food', /^(?:lieferdienst|essen|essenslieferung|essen bestellen)/i, null],
  ['grocery', /^(?:shop|supermarkt|lebensmittel|einkauf|lebensmittelshop|lieferservice)/i, null],
];
const LIST_RE = '(zahn(?:arzt|ärztin)|haus(?:arzt|ärztin)|haut(?:arzt|ärztin)|frauen(?:arzt|ärztin)|augen(?:arzt|ärztin)|kinder(?:arzt|ärztin)|physio\\w*|arzt|ärztin|ärzte|doktor|friseur\\w*|frisör\\w*|barber|kosmetik\\w*|nagelstudio|nägel|maniküre|pediküre|massage|beauty|restaurant|lokal|wirtshaus|heurigen?|tickets?|karten|ticketshop|babysitter\\w*|kinderbetreuung|lieferdienst|essen(?: bestellen)?|essenslieferung|shop|supermarkt|lebensmittel\\w*|einkauf|lieferservice)';

function listOf(word: string): { kind: ListKind; topic: string | null } | null {
  const w = word.trim();
  for (const [kind, re, topic] of LIST_WORDS) if (re.test(w)) return { kind, topic };
  return null;
}

const ORDINAL: Record<string, number> = { erste: 1, ersten: 1, erster: 1, zweite: 2, zweiten: 2, zweiter: 2, dritte: 3, dritten: 3, dritter: 3, vierte: 4, vierten: 4, fünfte: 5, fünften: 5 };
const clean = (s: string) => s.trim().replace(/^(?:bitte\s+|den\s+|die\s+|das\s+)/i, '').replace(/[.!?,]+$/, '').trim();
const lc = (s: string) => s.toLowerCase().normalize('NFC');

/** Entry by spoken name: exact, then contained either way ("Haarwerk" ↔ "Haarwerk Neubau"). */
function findEntry(all: Favourite[], name: string, kind?: ListKind): Favourite | null {
  const n = lc(clean(name));
  const pool = all.filter((f) => f.system !== 'keyword' && (!kind || f.kind === kind));
  return pool.find((f) => lc(f.name) === n)
    ?? pool.find((f) => lc(f.name).includes(n) && n.length >= 3)
    ?? pool.find((f) => n.includes(lc(f.name)) && f.name.length >= 3)
    ?? null;
}

/** A platform by spoken name ("gurkerl", "Billa" → foodora). */
function findPlatform(name: string): string | null {
  const n = lc(clean(name));
  return PLATFORMS.find((p) => lc(p.name) === n)?.id ?? ALIASES[n]?.platformId ?? null;
}

function shopKindFor(all: Favourite[], platformId: string): 'grocery' | 'food' {
  const p = platform(platformId)!;
  const existing = all.find((f) => f.system === 'shop' && f.systemRef === platformId);
  if (existing && (existing.kind === 'grocery' || existing.kind === 'food')) return existing.kind;
  return p.kinds[0] === 'food' ? 'food' : 'grocery';
}

const label = (k: ListKind, topic?: string | null) => topic ?? LIST_LABEL[k];
const phoneIn = (s: string) => s.match(/(\+?\d[\d\s/-]{5,}\d)/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;

function moveCmd(all: Favourite[], name: string, to: number): AnbieterCommand | null {
  const e = findEntry(all, name);
  if (e) {
    const where = to === 1 ? 'an die erste Stelle' : `auf Platz ${to}`;
    return { type: 'move', kind: e.kind, id: e.id, name: e.name, to, confirm: `${e.name} ${where} bei ${label(e.kind, e.topic)}?` };
  }
  const pid = findPlatform(name);
  if (pid) {
    const kind = shopKindFor(all, pid);
    const p = platform(pid)!;
    return { type: 'move', kind, id: null, platformId: pid, name: p.name, to, confirm: `${p.name} ${to === 1 ? 'an die erste Stelle' : `auf Platz ${to}`} bei ${LIST_LABEL[kind]}?` };
  }
  return null;
}

export function parseAnbieterCommand(text: string, all: Favourite[]): AnbieterCommand | null {
  const s = text.trim().replace(/[.!?]+$/, '');
  let m: RegExpMatchArray | null;

  // Shops first: "Alkohol bestelle ich bei Alfies", "Italienisch: Riva, Da Mario", "Riva war super".
  const rule = parseShopRule(s, all);
  if (rule) return { type: 'shop', kind: rule.type === 'platform' ? rule.kinds[0] : 'food', rule, confirm: rule.confirm };

  // Keywords: "Stichwort Spitzen schneiden für Friseur", "Nägel gehört zu Kosmetik", "Barber heißt auch Friseur"
  m = s.match(new RegExp(`^(?:neues\\s+)?(?:stichwort|schlagwort|suchwort)\\s+[„"]?(.+?)[“"]?\\s+(?:für|bei|zu|zum|zur)\\s+(?:den\\s+|die\\s+|das\\s+)?${LIST_RE}$`, 'i'))
    ?? s.match(new RegExp(`^[„"]?(.+?)[“"]?\\s+(?:gehört\\s+zu(?:m|r)?|heißt(?:\\s+auch)?|bedeutet|ist\\s+ein\\s+stichwort\\s+für)\\s+(?:den\\s+|die\\s+|das\\s+)?${LIST_RE}$`, 'i'));
  if (m) {
    const l = listOf(m[2]);
    const word = clean(m[1]);
    if (l && word.length > 1) return { type: 'keyword', kind: l.kind, word, confirm: `„${word}“ als Stichwort für ${LIST_LABEL[l.kind]} merken?` };
  }

  // Reorder: "gurkerl zuerst", "Haarwerk an erster Stelle", "Barber Joe auf Platz 2"
  m = s.match(/^(.+?)\s+(?:zuerst|als erstes|als erste[rns]?|nach vorne|ganz nach oben|ganz oben|an (?:die )?erste(?:r)? stelle)$/i)
    ?? s.match(/^(?:zuerst|immer zuerst)\s+(.+)$/i);
  if (m) return moveCmd(all, m[1], 1);
  m = s.match(/^(.+?)\s+(?:an|auf)\s+(?:die\s+)?(?:stelle|platz|position|nummer)\s+(\d|zwei|drei|vier|fünf)$/i)
    ?? s.match(/^(.+?)\s+an\s+(?:die\s+)?(zweite[rn]?|dritte[rn]?|vierte[n]?|fünfte[n]?)\s+stelle$/i);
  if (m) {
    const n = ORDINAL[lc(m[2])] ?? parseNumber(m[2]);
    if (n) return moveCmd(all, m[1], n);
  }
  m = s.match(/^(.+?)\s+(?:ganz\s+)?(?:nach hinten|zuletzt|an letzter stelle)$/i);
  if (m) return moveCmd(all, m[1], 99);

  // Remove: "Barber Joe löschen", "Lösche Café Anzengruber"
  m = s.match(/^(.+?)\s+(?:löschen|entfernen|streichen|rausnehmen|raus)$/i) ?? s.match(/^(?:lösch\w*|entfern\w*|streich\w*)\s+(.+)$/i);
  if (m) {
    const e = findEntry(all, m[1]);
    if (e) return { type: 'remove', kind: e.kind, id: e.id, name: e.name, confirm: `${e.name} aus ${label(e.kind, e.topic)} löschen?` };
  }

  // Add: "Neuer Friseur Salon Lisa 01 234 56 78", "Neue Zahnärztin Dr. Berger", "Füge Wolt als Lieferdienst hinzu"
  m = s.match(new RegExp(`^(?:neue[rns]?|neu)\\s+${LIST_RE}\\s*:?\\s+(.+)$`, 'i'));
  let kindWord = m?.[1], rest = m?.[2];
  if (!m) {
    m = s.match(new RegExp(`^(?:füg\\w*\\s+|nimm\\s+|speicher\\w*\\s+)?(.+?)\\s+als\\s+(?:neue[nrs]?\\s+)?${LIST_RE}(?:\\s+(?:hinzu|dazu|auf|an|speichern|hinzufügen|dazunehmen))?$`, 'i'));
    kindWord = m?.[2]; rest = m?.[1];
  }
  if (kindWord && rest) {
    const l = listOf(kindWord);
    const phone = phoneIn(rest);
    const name = clean(phone ? rest.replace(phone, ' ') : rest).replace(/\s+(?:telefon|nummer|tel\.?)$/i, '').trim();
    if (l && name) {
      const pid = l.kind === 'grocery' || l.kind === 'food' ? findPlatform(name) : null;
      const shown = pid ? platform(pid)!.name : name;
      return { type: 'add', kind: l.kind, name: shown, topic: l.topic, phone, platformId: pid ?? undefined,
        confirm: `${shown} als ${entries(all, l.kind).length + 1}. bei ${label(l.kind, l.topic)} speichern${phone ? `, Telefon ${phone}` : ''}?` };
    }
  }
  return null;
}

/** Applies a confirmed command. Returns the sentence PA says afterwards. */
export function applyAnbieterCommand(store: Store, c: AnbieterCommand): string {
  const all = store.list('favourite');
  switch (c.type) {
    case 'shop':
      return applyShopRule(store, c.rule);
    case 'keyword': {
      const k = newKeyword(all, c.kind, c.word);
      if (k) store.save('favourite', k);
      return k ? `Gemerkt. „${c.word}“ führt jetzt zu ${LIST_LABEL[c.kind]}.` : `„${c.word}“ ist schon gespeichert.`;
    }
    case 'remove': {
      const e = all.find((f) => f.id === c.id);
      if (e) removeEntry(store, all, e);
      return `${c.name} gelöscht.`;
    }
    case 'add': {
      const row = c.platformId && (c.kind === 'grocery' || c.kind === 'food')
        ? shopEntry(all, c.kind, c.platformId)
        : newEntry(all, { kind: c.kind, name: c.name, topic: c.topic, phone: c.phone });
      store.save('favourite', row);
      return `${c.name} gespeichert.`;
    }
    case 'move': {
      let id = c.id;
      if (!id && c.platformId && (c.kind === 'grocery' || c.kind === 'food')) {
        const row = shopEntry(all, c.kind, c.platformId);
        store.save('favourite', row);
        id = row.id;
      }
      const fresh = store.list('favourite');
      const e = fresh.find((f) => f.id === id);
      if (!e) return 'Nicht gefunden.';
      const list = entries(fresh, e.kind).filter((x) => (x.topic ?? '') === (e.topic ?? ''));
      applyMove(store, list, e.id, c.to - 1);
      return c.to === 1 ? `${c.name} kommt jetzt zuerst.` : `${c.name} ist jetzt auf Platz ${Math.min(c.to, list.length)}.`;
    }
  }
}
