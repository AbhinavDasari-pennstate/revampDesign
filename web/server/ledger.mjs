// The small shared pieces of the files the server keeps under its data dir besides the jobs (plan/web-plan.md T47): which Los Angeles day it is,
// and reading and writing a JSON file so a reader never sees half a file. Node stdlib only; no network.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export const TIME_ZONE = 'America/Los_Angeles';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// The calendar day of a moment in Los Angeles, as YYYY-MM-DD (en-CA writes it that way). The daily invite limit and the daily dollar cap both turn at
// local midnight, in summer (PDT) and winter (PST) alike.
export const laDay = (date) => dayFormat.format(date);

// The parsed file, or undefined when it does not exist. Anything else wrong (unreadable, not JSON) throws: the caller must not treat it as empty.
export function readJsonFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  return JSON.parse(text);
}

// Write to a temporary file in the same folder, then rename over the target: a reader sees the old file or the new one. The pid keeps two
// processes (the server and the admin tool) from sharing a temporary file.
export function writeJsonFile(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
