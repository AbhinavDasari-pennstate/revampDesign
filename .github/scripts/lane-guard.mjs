// Fails a PR whose branch prefix touches files outside its lane (see plan/lanes.md).
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Lane A owns web/server/ and contracts/web/; web/ui/ belongs to Lane B and web/viewer/ to Lane C (plan/web-plan.md, section 3).
const OTHER_LANES = ['lanes/b-design/', 'lanes/c-build/', 'web/ui/', 'web/viewer/'];
const starts = (f, ...prefixes) => prefixes.some((p) => f.startsWith(p));
const allowed = {
  'lane-a/': (f) => !starts(f, ...OTHER_LANES),
  'lane-b/': (f) => starts(f, 'lanes/b-design/', 'web/ui/'),
  'lane-c/': (f) => starts(f, 'lanes/c-build/', 'web/viewer/'),
};

export function violations(branch, files) {
  const rule = Object.entries(allowed).find(([prefix]) => branch.startsWith(prefix))?.[1];
  return files.filter((f) => !rule || !rule(f));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const branch = process.env.GITHUB_HEAD_REF || execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  const base = process.env.GITHUB_BASE_REF || 'main';
  // --no-renames lists a moved file's old path too, so moving a file out of another lane is caught.
  const files = execSync(`git diff --name-only --no-renames origin/${base}...HEAD`).toString().split('\n').filter(Boolean);
  const bad = violations(branch, files);
  if (bad.length) {
    console.error(`Branch ${branch} touches files outside its lane:\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Lane guard ok: ${files.length} files on ${branch}`);
}
