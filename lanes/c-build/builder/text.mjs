// House rule: no em or en dashes in built sites, without changing what the text means.
// A range still reads as a range: grade spans and number ranges get a hyphen (K-8, 9-12), and an
// en dash joining two words becomes " to " (Mon to Fri, 7:30 AM to 3:30 PM). An em dash, or a dash
// with spaces around it, is a pause and becomes a comma. The content check (T15) and the fact diff
// (T22) apply the same rule. The dash characters are built from char codes so this file has none.
const EN = String.fromCharCode(0x2013);
const EM = String.fromCharCode(0x2014);
const ANY = `[${EN}${EM}]`;
const GRADE_SPAN = new RegExp(`\\b(Pre-?K|K)\\s*${ANY}\\s*(?=\\d)`, 'gi');
const NUMBER_RANGE = new RegExp(`(\\d)\\s*${ANY}\\s*(?=\\d)`, 'g');
const WORD_RANGE = new RegExp(`(\\w)${EN}(?=\\w)`, 'g');
const PAUSE = new RegExp(`\\s*${ANY}\\s*`, 'g');

export function noDashes(text) {
  return text.replace(GRADE_SPAN, '$1-').replace(NUMBER_RANGE, '$1-').replace(WORD_RANGE, '$1 to ').replace(PAUSE, ', ');
}

// noDashes on every string inside a JSON-like value.
export function noDashesDeep(value) {
  if (typeof value === 'string') return noDashes(value);
  if (Array.isArray(value)) return value.map(noDashesDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noDashesDeep(v)]));
  return value;
}
