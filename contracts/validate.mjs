// Validate contract files. Usage:
//   node contracts/validate.mjs <file.json>      schema check against the version the file declares
//   node contracts/validate.mjs --cross <run dir> schema check of every contract file plus cross-file ids and paths
// Exit 0 ok, 2 invalid. Used by the orchestrator and CI only; lanes validate with their own Ajv.
import Ajv2020 from 'ajv/dist/2020.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const schemaDir = fileURLToPath(new URL('./schemas/', import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const f of readdirSync(schemaDir)) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));

export const FILES = {
  run: '00-run.json', inventory: '10-inventory.json', storyboard: '20-storyboard.json', directions: '30-directions.json',
  verdict: '40-verdict.json', selection: '45-selection.json', handoff: '50-handoff.json',
};
const PATH_KEYS = new Set(['desktop', 'mobile', 'local_path', 'logo_path', 'path', 'compare_path', 'repo_path', 'preview_local', 'report_path']);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function schemaErrors(data) {
  const validate = ajv.getSchema(`${data?.contract}.v${String(data?.version).split('.')[0]}`);
  if (!validate) return [`unknown contract ${data?.contract} ${data?.version}`];
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

// Every relative path value under a known path key, anywhere in the document.
function paths(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => paths(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (PATH_KEYS.has(k) && typeof v === 'string') out.push(v);
      else paths(v, out);
    }
  }
  return out;
}

export function crossErrors(runDir) {
  const errors = [];
  const docs = {};
  for (const [name, file] of Object.entries(FILES)) {
    const p = join(runDir, file);
    if (!existsSync(p)) continue;
    docs[name] = read(p);
    errors.push(...schemaErrors(docs[name]).map((e) => `${file}: ${e}`));
    for (const rel of paths(docs[name])) if (!existsSync(join(runDir, rel))) errors.push(`${file}: missing file ${rel}`);
  }
  const ids = Object.values(docs).map((d) => d.run_id);
  if (new Set(ids).size > 1) errors.push(`run_id differs across files: ${[...new Set(ids)].join(', ')}`);

  const { inventory: inv, storyboard: sb, directions: dirs, verdict, selection, handoff } = docs;
  if (inv) {
    const blocks = new Set(inv.pages.flatMap((p) => p.blocks.map((b) => b.block_id)));
    for (const f of inv.facts) if (!blocks.has(f.block_id)) errors.push(`10-inventory.json: fact ${f.fact_id} points at unknown block ${f.block_id}`);
    if (sb) {
      const pages = new Set(inv.pages.map((p) => p.page_id));
      const images = new Set(inv.pages.flatMap((p) => p.images.map((i) => i.image_id)));
      for (const page of sb.pages) {
        for (const id of page.source_page_ids) if (!pages.has(id)) errors.push(`20-storyboard.json: unknown page ${id}`);
        for (const s of page.sections) {
          for (const id of s.body_block_ids) if (!blocks.has(id)) errors.push(`20-storyboard.json: ${s.section_id} unknown block ${id}`);
          for (const id of s.image_ids) if (!images.has(id)) errors.push(`20-storyboard.json: ${s.section_id} unknown image ${id}`);
        }
      }
    }
    if (handoff) {
      const facts = new Set(inv.facts.map((f) => f.fact_id));
      for (const id of handoff.qa.fact_diff.missing) if (!facts.has(id)) errors.push(`50-handoff.json: unknown fact ${id}`);
    }
  }
  if (dirs) {
    const known = new Set(dirs.directions.map((d) => d.direction_id));
    if (known.size !== 3) errors.push('30-directions.json: direction ids must be d1, d2 and d3 once each');
    if (verdict && !known.has(verdict.top_direction_id)) errors.push(`40-verdict.json: unknown top direction ${verdict.top_direction_id}`);
    if (selection && !known.has(selection.direction_id)) errors.push(`45-selection.json: unknown direction ${selection.direction_id}`);
  }
  if (sb && handoff) {
    const slugs = new Set(sb.pages.map((p) => p.slug));
    for (const p of handoff.site.pages) if (!slugs.has(p.slug)) errors.push(`50-handoff.json: page ${p.slug} not in storyboard`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const errors = args[0] === '--cross' ? crossErrors(args[1]) : schemaErrors(read(args[0]));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
  }
  console.log('valid');
}
