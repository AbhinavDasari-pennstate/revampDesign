// Shared test helper: one Ajv instance with every schema registered by $id.
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';

const here = (p) => new URL(`../${p}`, import.meta.url);
export const readJson = (p) => JSON.parse(readFileSync(here(p), 'utf8'));
export const NAMES = ['run', 'inventory', 'storyboard', 'directions', 'verdict', 'selection', 'handoff'];

export const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const f of readdirSync(here('schemas'))) ajv.addSchema(readJson(`schemas/${f}`));

export function check(name, data) {
  const validate = ajv.getSchema(`${name}.v1`);
  return validate(data) ? [] : validate.errors;
}
