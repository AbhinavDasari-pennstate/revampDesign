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
// A dash, spaced or not, between two range ends (a time, a.m. or p.m., a weekday, a month) is a range: "8 a.m. to 4 p.m.".
const DAY = 'Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?';
const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const NAME = `\\b(?:${DAY}|${MONTH})\\b\\.?`;
// am or pm may be stuck to its digit (8:00am); a weekday or month pairs only with another weekday or month,
// so "Friday, 7 p.m." stays a pause.
const AMPM = '(?:\\b|(?<=\\d))[ap]\\.?m\\b\\.?';
const SPAN_RANGE = new RegExp(`(${NAME}(?=\\s*${ANY}\\s*${NAME})|${AMPM})\\s*${ANY}\\s*(?=\\d|${NAME}|\\b(?:noon|midnight)\\b)`, 'gi');
// Starts only after a non-space, so a long run of spaces is scanned once, not once per space.
// The group is optional, so a dash right after spaces an earlier match took ("a, , b") still goes.
const PAUSE = new RegExp(`(?:(?<!\\s)\\s*)?${ANY}\\s*`, 'g');

export function noDashes(text) {
  return text.replace(GRADE_SPAN, '$1-').replace(NUMBER_RANGE, '$1-').replace(SPAN_RANGE, '$1 to ').replace(WORD_RANGE, '$1 to ').replace(PAUSE, ', ');
}

// noDashes on every string inside a JSON-like value.
export function noDashesDeep(value) {
  if (typeof value === 'string') return noDashes(value);
  if (Array.isArray(value)) return value.map(noDashesDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noDashesDeep(v)]));
  return value;
}
