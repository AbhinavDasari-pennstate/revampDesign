// The job store and the one-at-a-time queue. Node stdlib only.
// A job is a plain record persisted as <data dir>/jobs/<job_id>/job.json; view() turns it into the job.v1 the API sends.
// One orchestrator process runs at a time. Its stdout and stderr go to console.log in the job folder and nowhere else.
// Events (the shapes of event.v1) are emitted as queue.emit('event', job_id, name, data) for the progress stream (T43) to store and replay.
// Seams for later tasks: classifyExit() (T43 refines the failure codes), startJob() is the one place the argv is built (T47 adds --live there).
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_FAILURES } from './messages.mjs';

export const STAGES = ['scout', 'story', 'art', 'council', 'select', 'build'];
const JOB_ID = /^[A-Za-z0-9_-]{22}$/;
export const isJobId = (s) => typeof s === 'string' && JOB_ID.test(s);
const pendingStages = () => STAGES.map((stage) => ({ stage, state: 'pending' }));

// null when the run succeeded, else the run failure code for job.v1.error. T43 replaces this: exit 3 at scout is site_blocked,
// exit 3 later quality_gate, exit 4 budget, and an exit 0 whose output shows a stub fallback is not_real.
export function classifyExit({ code, timedOut }) {
  if (timedOut) return 'timeout';
  return code === 0 ? null : 'crash';
}

// Stop the process and everything it started: taskkill /T on Windows, the process group elsewhere (the child is its own group leader there).
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill('SIGKILL'));
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    child.kill('SIGKILL');
  }
}

export class JobQueue extends EventEmitter {
  #jobs = new Map(); // job_id -> record; a Map so ids like "constructor" are just unknown
  #waiting = [];
  #running = null;
  #child = null;
  #timer = null;
  #exited = null; // promise that resolves when the current child has exited
  #announced = new Map(); // job_id -> last position sent as a queued event
  #closing = null;

  // dataDir: absolute. orchestrator: absolute path of the cli script. maxLine: places in line, the run in progress included.
  constructor({ dataDir, orchestrator, timeoutMs, maxLine = 5, viewerOrigin, log = console, now = () => new Date() }) {
    super();
    Object.assign(this, { dataDir, orchestrator, timeoutMs, maxLine, viewerOrigin, log, now });
    this.jobsDir = join(dataDir, 'jobs');
    mkdirSync(this.jobsDir, { recursive: true });
    this.#recover();
  }

  jobDir(id) {
    return join(this.jobsDir, id);
  }

  get(id) {
    return this.#jobs.get(id);
  }

  // A job still queued or running when the server last stopped can never finish: fail it, keep every other record as it is.
  #recover() {
    for (const id of readdirSync(this.jobsDir)) {
      if (!isJobId(id)) continue;
      let job;
      try {
        job = JSON.parse(readFileSync(join(this.jobDir(id), 'job.json'), 'utf8'));
      } catch (e) {
        this.log.error?.(`job ${id}: job.json is missing or unreadable (${e.code ?? 'bad JSON'}), skipped`);
        continue;
      }
      this.#jobs.set(id, job);
      if (job.status === 'queued' || job.status === 'running') {
        this.#fail(job, 'server_restarted');
        this.#persist(job);
      }
    }
  }

  isFull() {
    return (this.#running ? 1 : 0) + this.#waiting.length >= this.maxLine;
  }

  #positionOf(job) {
    const i = this.#waiting.indexOf(job);
    return i < 0 ? null : (this.#running ? 1 : 0) + i + 1;
  }

  // The job.v1 body. Internal fields (url, consent_note, invite_label) are never copied out.
  view(job) {
    return {
      job_id: job.job_id,
      status: job.status,
      position: this.#positionOf(job), // null unless the job is waiting
      mode: job.mode,
      stages: job.stages.map((s) => ({ stage: s.stage, state: s.state })),
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      error: job.error ? { code: job.error.code, message: job.error.message } : null,
      manifest_url: job.manifest_url,
    };
  }

  #write(job) {
    const file = join(this.jobDir(job.job_id), 'job.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2) + '\n');
    renameSync(`${file}.tmp`, file);
  }

  // A disk error after a job was accepted must not crash the server or stall the line: the record in memory stays the truth until restart.
  #persist(job) {
    try {
      this.#write(job);
    } catch (e) {
      this.log.error?.(`job ${job.job_id}: could not save job.json (${e.code ?? e.message})`);
    }
  }

  #emit(job, name, data) {
    this.emit('event', job.job_id, name, data);
  }

  // Tell every waiting job whose place changed. Called after anything that moves the line.
  #announce() {
    for (const job of this.#waiting) {
      const position = this.#positionOf(job);
      if (this.#announced.get(job.job_id) === position) continue;
      this.#announced.set(job.job_id, position);
      this.#emit(job, 'queued', { position });
    }
  }

  // Accept a job into the line. The caller has checked isFull(). The job starts on the next tick, so the caller can answer 202 with it still queued.
  add({ url, consentNote, inviteLabel, createdAt = this.now() }) {
    const job = {
      job_id: randomBytes(16).toString('base64url'),
      status: 'queued',
      mode: 'free',
      stages: pendingStages(),
      created_at: createdAt.toISOString(),
      started_at: null,
      finished_at: null,
      error: null,
      manifest_url: null,
      url,
      consent_note: consentNote,
      invite_label: inviteLabel,
    };
    mkdirSync(this.jobDir(job.job_id), { recursive: true });
    this.#write(job); // first, and strict: a disk error refuses the job instead of leaving a half registered one in the line
    this.#jobs.set(job.job_id, job);
    this.#waiting.push(job);
    this.#announce();
    setImmediate(() => this.#pump());
    return job;
  }

  #pump() {
    if (this.#closing || this.#running || this.#waiting.length === 0) return;
    const job = this.#waiting.shift();
    this.#announced.delete(job.job_id);
    this.#start(job);
    this.#announce();
  }

  #start(job) {
    this.#running = job;
    job.status = 'running';
    job.started_at = this.now().toISOString();
    this.#persist(job);
    this.#emit(job, 'started', { mode: job.mode });
    this.log.log?.(`job ${job.job_id} started`);

    const dir = this.jobDir(job.job_id);
    // The one place the command line is built: an argument array and no shell, so nothing the tester typed can become a command.
    // Never --live in v1 of this task: the live switch is T47.
    const args = [this.orchestrator, 'run', '--url', job.url, '--tier', 'B', '--consent-note', job.consent_note, '--out-dir', dir];
    let out;
    let child;
    try {
      out = openSync(join(dir, 'console.log'), 'a');
      child = spawn(process.execPath, args, { stdio: ['ignore', out, out], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (e) {
      this.log.error?.(`job ${job.job_id}: could not start the orchestrator (${e.code ?? e.message})`);
      setImmediate(() => this.#finish(job, { code: null, timedOut: false }));
      return;
    } finally {
      if (out !== undefined) closeSync(out);
    }
    this.#child = child;
    let timedOut = false;
    this.#timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, this.timeoutMs);
    this.#timer.unref();
    this.#exited = new Promise((resolve) => {
      let settled = false;
      const settle = (code) => {
        if (settled) return;
        settled = true;
        resolve();
        this.#finish(job, { code, timedOut });
      };
      child.once('error', (e) => {
        this.log.error?.(`job ${job.job_id}: orchestrator process error (${e.code ?? e.message})`);
        settle(null);
      });
      child.once('exit', (code) => settle(code));
    });
  }

  #fail(job, code) {
    job.status = 'failed';
    job.finished_at = this.now().toISOString();
    job.error = { code, message: RUN_FAILURES[code] };
    job.manifest_url = null;
    job.stages = job.stages.map((s) => (s.state === 'running' ? { ...s, state: 'failed' } : s));
  }

  #finish(job, { code, timedOut }) {
    if (this.#closing) return; // the server is stopping: leave the record for the next start to fail as server_restarted
    clearTimeout(this.#timer);
    const failure = classifyExit({ code, timedOut });
    if (failure) {
      this.#fail(job, failure);
    } else {
      job.status = 'done';
      job.finished_at = this.now().toISOString();
      job.stages = STAGES.map((stage) => ({ stage, state: 'done' }));
      job.manifest_url = `${this.viewerOrigin}/j/${job.job_id}/manifest.json`;
    }
    this.#persist(job);
    this.log.log?.(`job ${job.job_id} ${job.status}${failure ? ` (${failure})` : ''}`);
    this.#running = null;
    this.#child = null;
    if (job.status === 'done') this.#emit(job, 'done', { manifest_url: job.manifest_url });
    else this.#emit(job, 'failed', { code: job.error.code, message: job.error.message });
    this.#announce(); // the jobs behind it move up one place, then the first of them starts
    this.#pump();
  }

  // Stop the process tree and wait for it. Records are left as they are (see #finish).
  close() {
    this.#closing ??= (async () => {
      clearTimeout(this.#timer);
      if (this.#child) {
        killTree(this.#child);
        await Promise.race([this.#exited, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
      }
    })();
    return this.#closing;
  }
}
