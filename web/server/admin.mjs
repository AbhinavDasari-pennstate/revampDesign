// The admin tool of the tester app (plan/web-plan.md T47). Node stdlib only. It edits files under the data dir and never talks to the network.
//   node web/server/admin.mjs [--data-dir web-data] invite add <label>      make an invite and print its code, once
//   node web/server/admin.mjs [--data-dir web-data] invite list
//   node web/server/admin.mjs [--data-dir web-data] invite reset <label>    give the invite its run back today
//   node web/server/admin.mjs [--data-dir web-data] invite revoke <label>
// Exit 0 done, 1 refused (unknown label, a file it will not overwrite), 2 wrong command line. Messages go to stderr, results to stdout.
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createInviteStore } from './invites.mjs';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const USAGE = `usage: node web/server/admin.mjs [--data-dir <dir>] <command>
  invite add <label>      make an invite code and print it once (only a hash is saved)
  invite list             show every invite: label, status, the day it last started a run
  invite reset <label>    let the invite start a run again today
  invite revoke <label>   stop the invite from working`;

class UsageError extends Error {}

function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { 'data-dir': { type: 'string' } } });
  } catch (e) {
    throw new UsageError(e.message);
  }
  const dir = parsed.values['data-dir'];
  const dataDir = dir === undefined ? join(repoRoot, 'web-data') : isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const [command, sub, ...rest] = parsed.positionals;

  if (command === 'invite') {
    const store = createInviteStore({ dataDir });
    if (sub === 'add' && rest.length === 1) {
      const code = store.add(rest[0]);
      console.log(`Invite code for ${rest[0]}: ${code}`);
      console.log(`Only a hash of the code is saved (${join(dataDir, 'invites.json')}), so this is the only time you will see it. Give it to the tester now.`);
      return;
    }
    if (sub === 'list' && rest.length === 0) {
      const invites = store.list();
      if (invites.length === 0) return console.log('No invite codes yet. Make one with: node web/server/admin.mjs invite add <label>');
      const width = Math.max(5, ...invites.map((i) => i.label.length)) + 2;
      console.log(`${'label'.padEnd(width)}${'status'.padEnd(9)}last run (America/Los_Angeles day)`);
      for (const i of invites) {
        const used = i.last_used_day === null ? 'never used' : `last used ${i.last_used_day}${i.usedToday ? ' (today)' : ''}`;
        console.log(`${i.label.padEnd(width)}${(i.revoked ? 'revoked' : 'active').padEnd(9)}${used}`);
      }
      return;
    }
    if (sub === 'reset' && rest.length === 1) {
      store.reset(rest[0]);
      return console.log(`${rest[0]} can start a run again today.`);
    }
    if (sub === 'revoke' && rest.length === 1) {
      store.revoke(rest[0]);
      return console.log(`${rest[0]} is revoked: its code no longer works.`);
    }
  }
  throw new UsageError('unknown or incomplete command');
}

try {
  run(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n${USAGE}`);
    process.exitCode = 2;
  } else {
    console.error(e.message);
    process.exitCode = 1;
  }
}
