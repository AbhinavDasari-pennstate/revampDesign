// House rule: no em or en dashes in built sites. A dash between numbers becomes a hyphen (9-12);
// any other becomes a comma. The content check (T15) and fact diff (T22) apply the same rule.
export function noDashes(text) {
  return text.replace(/(\d)\s*[\u2013\u2014]\s*(?=\d)/g, '$1-').replace(/\s*[\u2013\u2014]\s*/g, ', ');
}

// noDashes on every string inside a JSON-like value.
export function noDashesDeep(value) {
  if (typeof value === 'string') return noDashes(value);
  if (Array.isArray(value)) return value.map(noDashesDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noDashesDeep(v)]));
  return value;
}
