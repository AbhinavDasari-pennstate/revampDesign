// Fails a PR whose branch prefix touches files outside its lane (see plan/lanes.md).
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OTHER_LANES = ['lanes/b-design/', 'lanes/c-build/'];
const allowed = {
  'lane-a/': (f) => !OTHER_LANES.some((p) => f.startsWith(p)),
  'lane-b/': (f) => f.startsWith('lanes/b-design/'),
  'lane-c/': (f) => f.startsWith('lanes/c-build/'),
};

export function violations(branch, files) {
  const rule = Object.entries(allowed).find(([prefix]) => branch.startsWith(prefix))?.[1];
  return files.filter((f) => !rule || !rule(f));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const branch = process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  const base = process.env.GITHUB_BASE_REF || 'main';
  const files = execSync(`git diff --name-only origin/${base}...HEAD`).toString().split('\n').filter(Boolean);
  const bad = violations(branch, files);
  if (bad.length) {
    console.error(`Branch ${branch} touches files outside its lane:\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Lane guard ok: ${files.length} files on ${branch}`);
}
