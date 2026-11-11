// The admin tool of the tester app (plan/web-plan.md T47). Node stdlib only. It edits files under the data dir and never talks to the network.
//   node web/server/admin.mjs [--data-dir web-data] invite add <label>      make an invite and print its code, once
//   node web/server/admin.mjs [--data-dir web-data] invite list
//   node web/server/admin.mjs [--data-dir web-data] invite reset <label>    give the invite its run back today
//   node web/server/admin.mjs [--data-dir web-data] invite revoke <label>
//   node web/server/admin.mjs [--data-dir web-data] live <job_id> on|off    run that queued job with --live (the dollar cap still applies)
//   node web/server/admin.mjs [--data-dir web-data] spend                   dollars spent today and on every earlier day
// Exit 0 done, 1 refused (unknown label or job, a file it will not overwrite), 2 wrong command line. Messages go to stderr, results to stdout.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInviteStore } from './invites.mjs';
import { LIVE_FLAG, isJobId, laDay, readSpend } from './ledger.mjs';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const USAGE = `usage: node web/server/admin.mjs [--data-dir <dir>] <command>
  invite add <label>      make an invite code and print it once (only a hash is saved)
  invite list             show every invite: label, status, the day it last started a run
  invite reset <label>    let the invite start a run again today
  invite revoke <label>   stop the invite from working
  live <job_id> on|off    run a job that is still queued with --live (only if the server's --daily-usd-cap leaves room)
  spend                   dollars spent today and on every earlier day (America/Los_Angeles days)`;

class UsageError extends Error {}

// Not util.parseArgs: a job id is base64url and may start with a dash, which parseArgs would take for an option. Only --data-dir is an option here;
// every other word is a word of the command, so an unknown option ends as an unknown command.
function parseCommandLine(argv) {
  let dir;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--data-dir') {
      if (i + 1 >= argv.length) throw new UsageError('--data-dir needs a folder');
      dir = argv[++i];
    } else if (argv[i].startsWith('--data-dir=')) {
      dir = argv[i].slice('--data-dir='.length);
    } else {
      words.push(argv[i]);
    }
  }
  return { dir, words };
}

function run(argv) {
  const { dir, words } = parseCommandLine(argv);
  const dataDir = dir === undefined ? join(repoRoot, 'web-data') : isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  const [command, sub, ...rest] = words;

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
  if (command === 'live' && isOnOff(rest) && sub !== undefined) {
    if (!isJobId(sub)) throw new Error(`${sub} is not a job id (22 letters, digits, - or _)`);
    const folder = join(dataDir, 'jobs', sub);
    let job;
    try {
      job = JSON.parse(readFileSync(join(folder, 'job.json'), 'utf8'));
    } catch {
      throw new Error(`no job ${sub} in ${join(dataDir, 'jobs')}`);
    }
    // The server reads the flag once, when a job leaves the line, so neither on nor off can change a job that has started or finished: a started job
    // keeps its mode, and the flag file stays as the record of how it ran.
    if (job.status !== 'queued') throw new Error(`job ${sub} is ${job.status}, not queued: the live switch is read when a job starts, so it cannot change this one (a job that has started keeps its mode)`);
    if (rest[0] === 'off') {
      rmSync(join(folder, LIVE_FLAG), { force: true });
      return console.log(`Live switch is off for job ${sub}.`);
    }
    writeFileSync(join(folder, LIVE_FLAG), `live switch set ${new Date().toISOString()}\n`);
    return console.log(`Live switch is on for job ${sub}. It runs with --live when it reaches the head of the line, unless today's live spend plus its budget would pass the server's --daily-usd-cap (default 0: it then fails with budget).`);
  }
  if (command === 'spend' && sub === undefined) {
    const days = readSpend(dataDir);
    const today = laDay(new Date());
    console.log(`Today (${today}): $${(days[today] ?? 0).toFixed(2)}`);
    const rows = Object.entries(days).sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    if (rows.length === 0) return console.log('No spend recorded yet.');
    console.log('Spend by America/Los_Angeles day, free and live runs together:');
    for (const [day, usd] of rows) console.log(`${day}  $${usd.toFixed(2)}`);
    return;
  }
  throw new UsageError('unknown or incomplete command');
}

const isOnOff = (rest) => rest.length === 1 && (rest[0] === 'on' || rest[0] === 'off');

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
