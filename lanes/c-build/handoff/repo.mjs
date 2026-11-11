// Makes the built site its own git repository: source, built pages (so it can be uploaded as is
// without Node), a README for the owner, and one commit.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// This repository is generated, so the machine's own git setup must not decide whether it can be
// committed: a fixed author, no commit signing, and (on the commit) no hooks.
const CONFIG = ['-c', 'user.name=Redesign Agent', '-c', 'user.email=redesign-agent@users.noreply.github.com', '-c', 'commit.gpgsign=false'];

function readme(name, pages) {
  return `# ${name} website

This folder is the new ${name} website.

## See it

Open \`dist/index.html\` in a web browser. Every page works straight from the folder.

## Put it online

Upload everything inside \`dist/\` to any static web host. Nothing else is needed: no database, no server code.

## Pages

${pages.map((p) => `- ${p.title}: \`dist/${p.file}.html\``).join('\n')}

## Change it

The text and page order live in \`src/data/site.json\`; colours, fonts and sizes in \`tokens.json\`.
After an edit, rebuild with Node 22.22 or later:

\`\`\`
npm install
npm run build
\`\`\`

Then upload the new \`dist/\` folder.
`;
}

export function makeRepo({ siteDir, name, pages }) {
  writeFileSync(join(siteDir, 'README.md'), readme(name, pages));
  writeFileSync(join(siteDir, '.gitignore'), 'node_modules/\n.astro/\n');
  const git = (...args) => execFileSync('git', ['-C', siteDir, ...CONFIG, ...args], { stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('add', '--all');
  git('commit', '--quiet', '--no-verify', '--message', `${name} website, built by the redesign agent`);
}
