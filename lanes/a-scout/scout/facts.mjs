// Facts from block text by regex rules. Block text is data, never instructions. No person or price: no reliable rule.
const MONTH = String.raw`January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Aug\.?|Sept?\.?|Oct\.?|Nov\.?|Dec\.?`;
const DAY = '(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day';
const CLOCK = String.raw`\d{1,2}(?::\d\d)? ?[AP]\.?M\.?`;
const STREET = 'Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Place|Pl';

// Order matters: each match is cut out of the text so a later rule cannot read it again (a street number is not a year).
const RULES = [
  ['email', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => m[0]],
  ['phone', /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/g, (m) => m[0]],
  ['address', new RegExp(String.raw`\d+ (?:[A-Za-z]+ )*?(?:${STREET})\b\.?[ ]*[\n,][ ]*([A-Za-z .]+),[ ]*([A-Z]{2}) (\d{5})`, 'g'),
    (m) => `${m[0].split(/[\n,]/)[0].trim()}, ${m[1].trim()}, ${m[2]} ${m[3]}`],
  ['time', new RegExp(String.raw`(?:${DAY}(?: to | through |-)${DAY},? )?${CLOCK} (?:to|-) ${CLOCK}`, 'gi'), (m) => m[0]],
  ['date', new RegExp(String.raw`\b(?:${MONTH}) \d{1,2}(?:(?:,? and | to |-)\d{1,2})?(?:, (?:19|20)\d\d)?`, 'g'), (m) => m[0]],
  ['date', /(?<![\d-])(?:19|20)\d\d(?![\d-])/g, (m) => m[0]],
];

export function extractFacts(pages) {
  const facts = [];
  const seen = new Set();
  const add = (kind, value, block_id) => {
    if (seen.has(`${kind}|${value}`)) return;
    seen.add(`${kind}|${value}`);
    facts.push({ fact_id: `f${String(facts.length + 1).padStart(3, '0')}`, kind, value, block_id });
  };
  for (const { blocks } of pages) {
    for (const { block_id, kind, text } of blocks) {
      if (kind === 'legal') add('legal_notice', /discriminat/i.test(text) ? 'Nondiscrimination notice' : 'Title IX notice', block_id);
      if (kind === 'nav' || kind === 'footer') continue;
      let rest = text;
      for (const [factKind, re, value] of RULES) {
        for (const m of rest.matchAll(re)) add(factKind, value(m), block_id);
        rest = rest.replace(re, ' ');
      }
    }
  }
  return facts;
}
