// Spoken German → clean written text. No AI: fixed rules on the device, the user reviews the result.

const SPOKEN: Array<[RegExp, string]> = [
  [/\s*\bneuer?\s+absatz\b\s*/gi, '\n\n'],
  [/\s*\bneue\s+zeile\b\s*/gi, '\n'],
  [/\s*\bfragezeichen\b/gi, '?'],
  [/\s*\bausrufezeichen\b/gi, '!'],
  [/\s*\bdoppelpunkt\b/gi, ':'],
  [/\s*\bstrichpunkt\b/gi, ';'],
  [/\s*\bkomma\b/gi, ','],
  // "Punkt" is punctuation unless a number follows ("um Punkt 8").
  [/\s*\bpunkt\b(?!\s*\d)/gi, '.'],
];

const FILLERS = /(^|\s)(?:äh+m?|ähm|öhm+|hm+|mhm)(?=[\s,.!?]|$)[,]?/gi;

/** Applies spoken punctuation, drops fillers, fixes spacing, capitalises sentence starts, ends with a full stop. */
export function cleanDictation(raw: string): string {
  let s = ` ${raw} `;
  s = s.replace(FILLERS, '$1');
  for (const [re, rep] of SPOKEN) s = s.replace(re, rep);
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\d,.;:!?)"“”'])/g, '$1 ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Capitalise the start and every sentence start.
  s = s.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_, pre: string, c: string) => pre + c.toUpperCase());
  if (s && !/[.!?:]$/.test(s)) s += '.';
  return s;
}

const PRONOUNS = /^(ich|wir|er|sie|es|du|ihr|man)\b/i;
const NOT_VERB = /^(\d.*|ich|wir|er|sie|es|du|ihr|man|mir|mich|dir|dich|uns|euch|ihm|ihr|ihn|nicht|auch|noch|bitte|heute|morgen|später|früher|gleich|bald|da|dort|hier)$/i;

/**
 * Indirect speech after "sag Anna, dass …": moves the final verb back to second position
 * ("ich morgen um 8 komme" → "ich komme morgen um 8"). Only for the simple pronoun-first case.
 */
export function mainClause(clause: string): string {
  const s = clause.trim().replace(/[.!?]+$/, '');
  if (!PRONOUNS.test(s)) return clause.trim();
  const words = s.split(/\s+/);
  if (words.length < 3) return clause.trim();
  const last = words[words.length - 1];
  if (NOT_VERB.test(last) || !/^\p{Ll}+$/u.test(last)) return clause.trim();
  return [words[0], last, ...words.slice(1, -1)].join(' ');
}
