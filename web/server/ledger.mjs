// The small shared pieces of the files the server keeps under its data dir besides the jobs (plan/web-plan.md T47): which Los Angeles day it is,
// and reading and writing a JSON file so a reader never sees half a file. Node stdlib only; no network.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A job id is 22 base64url characters (128 random bits); a job lives in <data dir>/jobs/<job id>/. The live switch of a job is the file live.flag in that folder.
export const isJobId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
export const LIVE_FLAG = 'live.flag';

export const TIME_ZONE = 'America/Los_Angeles';
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// The calendar day of a moment in Los Angeles, as YYYY-MM-DD. The daily invite limit and the daily dollar cap both turn at local midnight,
// in summer (PDT) and winter (PST) alike. Built from the parts, so no locale's idea of the date order matters.
export function laDay(date) {
  const p = Object.fromEntries(dayFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

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

// ---- spend.json: dollars spent, per Los Angeles day ----
// { "2026-11-11": 1.5 }. The server adds what every run reported; admin.mjs reads it. A file that cannot be read or is not in this shape is an error,
// never an empty ledger, because the dollar cap is only as good as this file.
export const spendFile = (dataDir) => join(dataDir, 'spend.json');

export function readSpend(dataDir) {
  const file = spendFile(dataDir);
  let doc;
  try {
    doc = readJsonFile(file);
  } catch (e) {
    throw new Error(`${file} could not be read (${e.code ?? 'it is not valid JSON'})`);
  }
  if (doc === undefined) return {};
  const ok = doc !== null && typeof doc === 'object' && !Array.isArray(doc) && Object.entries(doc).every(([day, usd]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(usd) && usd >= 0);
  if (!ok) throw new Error(`${file} is not a valid spend file (it should map days like 2026-11-11 to dollars)`);
  return doc;
}

export const spentOn = (dataDir, day) => readSpend(dataDir)[day] ?? 0;

// Add dollars to a day. Rounded to a millionth of a dollar so floating point noise does not pile up.
export function addSpend(dataDir, day, usd) {
  const doc = readSpend(dataDir);
  doc[day] = Math.round(((doc[day] ?? 0) + usd) * 1e6) / 1e6;
  writeJsonFile(spendFile(dataDir), doc);
}
