// Lane C's own contract checks. The schemas in contracts/schemas/ are read as JSON data; no code from
// contracts/ is imported or run (lanes/c-build/CLAUDE.md).
import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_DIR = join(import.meta.dirname, '..', '..', '..', 'contracts', 'schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const f of readdirSync(SCHEMA_DIR)) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')));

export const fail = (message, exitCode) => Object.assign(new Error(message), { exitCode });

// Errors for a document against the schema version it declares; empty means valid.
export function schemaErrors(doc) {
  const validate = ajv.getSchema(`${doc?.contract}.v${String(doc?.version).split('.')[0]}`);
  if (!validate) return [`unknown contract ${doc?.contract} ${doc?.version}`];
  return validate(doc) ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

// Reads one input file; anything unreadable or off-schema is exit 2 naming the file.
export function readContract(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw fail(`${path}: cannot read as JSON (${e.message})`, 2);
  }
  const errors = schemaErrors(doc);
  if (errors.length) throw fail(`${path} failed its schema:\n  ${errors.join('\n  ')}`, 2);
  return doc;
}
