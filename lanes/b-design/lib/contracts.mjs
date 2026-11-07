// Contract checks with Lane B's own Ajv. contracts/ is read as JSON data only, never imported.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMAS = join(import.meta.dirname, '../../../contracts/schemas');
const ajv = new Ajv2020({ allErrors: true, strict: false });
const cache = new Map();

// Validates a document against the schema of the contract and major version it declares. Returns an error string or null.
export function check(doc) {
  const name = doc?.contract;
  const major = String(doc?.version ?? '').split('.')[0];
  if (typeof name !== 'string' || !/^[a-z]+$/.test(name) || !/^\d+$/.test(major)) return 'missing or bad "contract" and "version" fields';
  const file = join(SCHEMAS, `${name}.v${major}.schema.json`);
  if (!existsSync(file)) return `unknown contract ${name} v${doc.version}`;
  if (!cache.has(file)) cache.set(file, ajv.compile(JSON.parse(readFileSync(file, 'utf8'))));
  const validate = cache.get(file);
  return validate(doc) ? null : ajv.errorsText(validate.errors, { dataVar: name });
}
