// Invite codes (plan/web-plan.md T47). Node stdlib only; no network.
// The store lives in <data dir>/invites.json: a salt for the whole store and, per invite, its label, the salted SHA-256 hash of its code, whether it
// is revoked and the Los Angeles day it last started a run. The code itself is never written anywhere; admin.mjs prints it once when it is made.
// The server and the admin tool are different processes, so every call reads the file again and every change is a whole file written at once.
// createApp wants { check(code), recordUse(label) }; the other methods are for admin.mjs.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { laDay, readJsonFile, writeJsonFile } from './ledger.mjs';

// 31 letters and digits with nothing that reads as another (no 0 O 1 I L). 12 of them are about 59 bits.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

// A refusal the admin tool can say in a sentence (unknown label, bad label, a file it will not overwrite).
export class InviteError extends Error {}

// A new code from crypto.randomBytes. A byte of 248 or more is thrown away (248 is 8 times 31), so no letter is likelier than another.
export function newCode() {
  const letters = [];
  while (letters.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte < 248 && letters.length < CODE_LENGTH) letters.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  return letters.join('');
}

const hashOf = (saltHex, code) => createHash('sha256').update(Buffer.from(saltHex, 'hex')).update(code).digest();
const normalise = (code) => code.trim().toUpperCase(); // testers type codes by hand

// Why a parsed invites.json cannot be trusted, or null. A file that fails this is never used and never overwritten.
function problem(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
  if (typeof doc.salt !== 'string' || !/^[0-9a-f]{32}$/.test(doc.salt)) return 'salt is not 32 hex digits';
  if (!Array.isArray(doc.invites)) return 'invites is not a list';
  for (const e of doc.invites) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return 'an invite is not an object';
    if (typeof e.label !== 'string' || e.label === '') return 'an invite has no label';
    if (typeof e.hash !== 'string' || !/^[0-9a-f]{64}$/.test(e.hash)) return `the hash of ${e.label} is not 64 hex digits`;
    if (typeof e.revoked !== 'boolean') return `revoked of ${e.label} is not true or false`;
    if (e.last_used_day !== null && !(typeof e.last_used_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.last_used_day))) return `last_used_day of ${e.label} is not a day`;
  }
  return null;
}

// dataDir: absolute. now: the clock, for tests. log: { error } for a file that cannot be used.
export function createInviteStore({ dataDir, now = () => new Date(), log = console }) {
  const file = join(dataDir, 'invites.json');

  function load() {
    let doc;
    try {
      doc = readJsonFile(file);
    } catch (e) {
      throw new InviteError(`${file} could not be read (${e.code ?? 'it is not valid JSON'}), so no invite works until it is fixed`);
    }
    if (doc === undefined) return { salt: randomBytes(16).toString('hex'), invites: [] }; // no store yet: nothing is valid
    const why = problem(doc);
    if (why) throw new InviteError(`${file} is not a valid invite file (${why}), so no invite works until it is fixed`);
    return doc;
  }
  const save = (doc) => {
    mkdirSync(dataDir, { recursive: true });
    writeJsonFile(file, doc);
  };
  const entryOf = (doc, label) => {
    const entry = doc.invites.find((e) => e.label === label);
    if (!entry) throw new InviteError(`no invite labelled ${label}`);
    return entry;
  };

  return {
    // null for a code that is not valid (unknown, revoked, not a string, or the file cannot be used), else the label and whether it already
    // started a run today. The given code is compared with every stored hash by crypto.timingSafeEqual, with no early exit.
    check(code) {
      if (typeof code !== 'string' || code === '') return null;
      let doc;
      try {
        doc = load();
      } catch (e) {
        log.error?.(e.message);
        return null;
      }
      const given = hashOf(doc.salt, normalise(code));
      let found = null;
      for (const entry of doc.invites) {
        const same = timingSafeEqual(given, Buffer.from(entry.hash, 'hex'));
        if (same && !entry.revoked) found = entry;
      }
      return found ? { label: found.label, usedToday: found.last_used_day === laDay(now()) } : null;
    },

    // The invite started a run: no more today (Los Angeles).
    recordUse(label) {
      const doc = load();
      entryOf(doc, label).last_used_day = laDay(now());
      save(doc);
    },

    // Make an invite and return its code, the only time it exists in plain text.
    add(label) {
      if (typeof label !== 'string' || !LABEL.test(label)) throw new InviteError('The label must be 1 to 40 letters, digits, dots, dashes or underscores, starting with a letter or digit.');
      const doc = load();
      if (doc.invites.some((e) => e.label.toLowerCase() === label.toLowerCase())) throw new InviteError(`an invite labelled ${label} already exists`);
      const code = newCode();
      doc.invites.push({ label, hash: hashOf(doc.salt, code).toString('hex'), created_at: now().toISOString(), revoked: false, last_used_day: null });
      save(doc);
      return code;
    },

    list() {
      const today = laDay(now());
      return load().invites.map((e) => ({ label: e.label, created_at: e.created_at, revoked: e.revoked, last_used_day: e.last_used_day, usedToday: e.last_used_day === today }));
    },

    // Give the invite its run back today.
    reset(label) {
      const doc = load();
      entryOf(doc, label).last_used_day = null;
      save(doc);
    },

    revoke(label) {
      const doc = load();
      entryOf(doc, label).revoked = true;
      save(doc);
    },
  };
}
