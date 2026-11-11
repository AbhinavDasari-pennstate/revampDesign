// The job store and the one-at-a-time queue. Node stdlib only.
// A job is a plain record persisted as <data dir>/jobs/<job_id>/job.json; view() turns it into the job.v1 the API sends.
// One orchestrator process runs at a time. Its stdout and stderr go to console.log in the job folder and nowhere else.
// Events (the shapes of event.v1) are emitted as queue.emit('event', job_id, name, data); progress.mjs stores and streams them (GET /api/jobs/:id/events).
// Progress (T43): while a run is going, the contract files that appear in its run folder are polled (pollMs) and once more when it exits; each stage that ends,
// and the next one that begins, becomes a `stage` event and an update of job.stages. How the run ended is classified by progress.mjs classifyExit().
// The live switch (T47): a job runs with --live only if <job dir>/live.flag exists at the moment it leaves the line (admin.mjs live <job_id> on makes it).
// A live job is refused there, failed as `budget` and never started, when today's spend or its own lane budgets would take the day over the dollar cap
// (default 0: no live job ever starts). After every run the cost it reported is added to <data dir>/spend.json (ledger.mjs).
// #start is the one place the argv is built.
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_FLAG, addSpend, isJobId, laDay, spentOn } from './ledger.mjs';
import { RUN_FAILURES } from './messages.mjs';
import { POLL_MS, STAGES, classifyExit, failedStage, stagesDone, wasStubbed } from './progress.mjs';

export { isJobId }; // server.mjs imports it from here
const pendingStages = () => STAGES.map((stage) => ({ stage, state: 'pending' }));

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
  #poller = null; // the interval that looks for new contract files while a run is going
  #seen = 0; // how many stages' files the last poll saw
  #exited = null; // promise that resolves when the current child has exited
  #announced = new Map(); // job_id -> last position sent as a queued event
  #closing = null;

  // dataDir: absolute. orchestrator: absolute path of the cli script. maxLine: places in line, the run in progress included.
  // dailyUsdCap: dollars of live spend allowed per Los Angeles day. runTemplate: the 00-run.json the orchestrator starts every run from (its limits.lane_budget_usd).
  // pollMs: how often a running job's run folder is looked at for new contract files (a test makes it short).
  constructor({ dataDir, orchestrator, timeoutMs, maxLine = 5, viewerOrigin, dailyUsdCap = 0, runTemplate, pollMs = POLL_MS, log = console, now = () => new Date() }) {
    super();
    if (typeof dailyUsdCap !== 'number' || !Number.isFinite(dailyUsdCap) || dailyUsdCap < 0) throw new TypeError(`dailyUsdCap must be a number of dollars, 0 or more, got ${dailyUsdCap}`); // a NaN cap would let every comparison pass
    if (typeof pollMs !== 'number' || !Number.isFinite(pollMs) || pollMs <= 0) throw new TypeError(`pollMs must be a number of milliseconds above 0, got ${pollMs}`);
    Object.assign(this, { dataDir, orchestrator, timeoutMs, maxLine, viewerOrigin, dailyUsdCap, runTemplate, pollMs, log, now });
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
        const spent = job.status === 'running' ? this.#recordCost(job) : null; // a run that was killed with the server may already have spent money
        this.#fail(job, 'server_restarted');
        if (spent !== null) job.cost_usd = spent;
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
    while (!this.#closing && !this.#running && this.#waiting.length > 0) {
      const job = this.#waiting.shift();
      this.#announced.delete(job.job_id);
      this.#start(job); // a job refused at the head of the line leaves #running empty, so the next one is tried at once
    }
    this.#announce();
  }

  #warn(message) {
    (this.log.warn ?? this.log.error)?.call(this.log, message);
  }

  // The lane B and lane C budgets of the run template (lane A has no paid model). A live run may spend both.
  #laneBudgets() {
    let doc;
    try {
      doc = JSON.parse(readFileSync(this.runTemplate, 'utf8'));
    } catch (e) {
      throw new Error(`run template ${this.runTemplate} could not be read (${e.code ?? 'bad JSON'})`);
    }
    const { b, c } = doc?.limits?.lane_budget_usd ?? {};
    if (![b, c].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) throw new Error(`run template ${this.runTemplate} has no lane_budget_usd b and c`);
    return { b, c };
  }

  // null when a live job may start, else why not. Spend at or above the cap refuses at once; otherwise today's spend plus this run's budget may
  // reach the cap but not pass it. If the spend or the budget cannot be read the answer is no: the cap must never be guessed.
  #capRefusal() {
    const cap = this.dailyUsdCap;
    let spent;
    let budget;
    try {
      spent = spentOn(this.dataDir, laDay(this.now()));
    } catch (e) {
      return `cannot tell how much was spent today: ${e.message}`;
    }
    try {
      const { b, c } = this.#laneBudgets();
      budget = b + c;
    } catch (e) {
      return `cannot tell what the run may cost: ${e.message}`;
    }
    if (spent >= cap) return `spent today $${spent.toFixed(2)} is at or above the daily cap $${cap.toFixed(2)}`;
    if (spent + budget > cap) return `spent today $${spent.toFixed(2)} plus the run's budget $${budget.toFixed(2)} is over the daily cap $${cap.toFixed(2)}`;
    return null;
  }

  // The cost_usd of one contract file of a run (40-verdict.json, 50-handoff.json), or undefined when the file or the field is not there.
  // A cost that is not a number of at least 0 counts for nothing, with a warning.
  #costOfFile(job, run, name) {
    let usd;
    try {
      usd = JSON.parse(readFileSync(join(this.jobDir(job.job_id), run, name), 'utf8'))?.cost_usd;
    } catch (e) {
      if (e.code !== 'ENOENT') this.#warn(`job ${job.job_id}: ${run}/${name} could not be read for its cost_usd (${e.code ?? 'bad JSON'})`);
      return undefined;
    }
    if (usd === undefined) return undefined;
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) {
      this.#warn(`job ${job.job_id}: ${run}/${name} has a cost_usd that is not a number of at least 0, ignored`);
      return undefined;
    }
    return usd;
  }

  // What lane B spent in one run folder. Lane B appends one line {stage, cost_usd, at} to b-design/cost.jsonl as each stage ends (story, art, council
  // and its imagery, also when the stage fails), but writes cost_usd into 40-verdict.json for the council alone. So the sum of the lines is the spend, and
  // the verdict is used only when that file does not exist. This number guards the dollar cap, so it fails closed: a line that is not JSON, a cost_usd
  // that is missing, text or negative, or a file that cannot be read counts the run's whole lane B budget (or what the good lines add up to, if that is more).
  #costOfLaneB(job, run) {
    const file = join(this.jobDir(job.job_id), run, 'b-design', 'cost.jsonl');
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return this.#costOfFile(job, run, '40-verdict.json');
      return this.#wholeBudgetOfLaneB(job, file, `could not be read (${e.code ?? e.message})`, 0);
    }
    let good = 0;
    let broken = false;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let usd;
      try {
        usd = JSON.parse(line)?.cost_usd;
      } catch {}
      if (typeof usd === 'number' && Number.isFinite(usd) && usd >= 0) good += usd;
      else broken = true;
    }
    return broken ? this.#wholeBudgetOfLaneB(job, file, 'has a line without a cost_usd that is a number of at least 0', good) : good;
  }

  #wholeBudgetOfLaneB(job, file, why, good) {
    let b;
    try {
      ({ b } = this.#laneBudgets());
    } catch (e) {
      this.log.error?.(`job ${job.job_id}: ${file} ${why}, and the lane B budget is not known either (${e.message}): counting only ${good}`);
      return good;
    }
    this.#warn(`job ${job.job_id}: ${file} ${why}: counting the whole lane B budget, ${Math.max(b, good)}`);
    return Math.max(b, good);
  }

  // Add the cost a run reported to today's total in spend.json and return it, or null when it reported none. Lane B's spend is in b-design/cost.jsonl
  // (see #costOfLaneB) and lane C's cost_usd is in 50-handoff.json, both inside the run folder; a run that failed or was stopped is counted from whatever it wrote.
  // A free run that reports a cost is a surprise: warned about, still counted.
  #recordCost(job) {
    let runs = [];
    try {
      runs = readdirSync(this.jobDir(job.job_id), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {}
    let total = null;
    for (const run of runs) {
      for (const usd of [this.#costOfLaneB(job, run), this.#costOfFile(job, run, '50-handoff.json')]) {
        if (usd !== undefined) total = (total ?? 0) + usd;
      }
    }
    if (total === null || total === 0) return total;
    total = Math.round(total * 1e6) / 1e6; // 1.2 + 2.7 + 0.1 is not left as 4.000000000000001
    if (job.mode !== 'live') this.#warn(`job ${job.job_id}: a free run reported cost_usd ${total}; counted anyway`);
    try {
      addSpend(this.dataDir, laDay(this.now()), total);
    } catch (e) {
      this.log.error?.(`job ${job.job_id}: could not add its cost_usd ${total} to spend.json (${e.message})`);
    }
    return total;
  }

  // A job that cannot start fails before it ran: started_at stays null and every stage stays pending (contracts/web/fixtures/job-failed-budget-at-start.json).
  #refuse(job, code, why) {
    this.log.error?.(`job ${job.job_id} refused at start (${code}): ${why}`);
    this.#fail(job, code);
    this.#persist(job);
    this.#emit(job, 'failed', { code: job.error.code, message: job.error.message });
  }

  #start(job) {
    const dir = this.jobDir(job.job_id);
    // The live switch is read now, as the job leaves the line, never when it was accepted and never again once it runs.
    const live = existsSync(join(dir, LIVE_FLAG));
    if (live) {
      job.mode = 'live';
      const why = this.#capRefusal();
      if (why) return this.#refuse(job, 'budget', why);
    }
    this.#running = job;
    job.status = 'running';
    job.started_at = this.now().toISOString();
    job.stages[0] = { stage: STAGES[0], state: 'running' }; // the first stage begins with the run
    this.#persist(job);
    this.#emit(job, 'started', { mode: job.mode });
    this.#emit(job, 'stage', { stage: STAGES[0], state: 'running' });
    this.log.log?.(`job ${job.job_id} started${live ? ' (live)' : ''}`);

    // The one place the command line is built: an argument array and no shell, so nothing the tester typed can become a command.
    // --live is added only for a job that passed the cap check above; no other path adds it.
    const args = [this.orchestrator, 'run', '--url', job.url, '--tier', 'B', '--consent-note', job.consent_note, '--out-dir', dir, ...(live ? ['--live'] : [])];
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
    this.#seen = 0;
    this.#poller = setInterval(() => this.#poll(job), this.pollMs);
    this.#poller.unref();
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

  // Bring job.stages up to `count` finished stages, one event per change and in order: a stage ends and the next one begins. True when anything changed.
  // The stage list is always done stages, then at most one running stage, then pending ones, and a stage is done only when every earlier one is.
  #advance(job, count) {
    let changed = false;
    for (let i = job.stages.filter((s) => s.state === 'done').length; i < Math.min(count, STAGES.length); i++) {
      job.stages[i] = { stage: STAGES[i], state: 'done' };
      this.#emit(job, 'stage', { stage: STAGES[i], state: 'done' });
      if (i + 1 < STAGES.length) {
        job.stages[i + 1] = { stage: STAGES[i + 1], state: 'running' };
        this.#emit(job, 'stage', { stage: STAGES[i + 1], state: 'running' });
      }
      changed = true;
    }
    return changed;
  }

  // The poll while a run is going: which contract files exist now (their names only, never their content). A file counts only once two polls in a row have
  // seen it: lanes B and C write their output file and then exit 3 when a quality gate fails, and that stage must be reported failed, not done.
  #poll(job) {
    if (this.#closing || this.#running !== job) return;
    const seen = stagesDone(this.jobDir(job.job_id));
    const settled = Math.min(seen, this.#seen);
    this.#seen = seen;
    if (this.#advance(job, settled)) this.#persist(job);
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
    clearInterval(this.#poller);
    const dir = this.jobDir(job.job_id);
    let finished = stagesDone(dir); // one last look, so a stage that ended since the last poll is neither lost nor out of order
    let named = null; // the stage the orchestrator says failed (only for a run that exited non zero on its own)
    if (code !== 0 && !timedOut) {
      // The stage that failed is not finished even if it left its file (a quality gate exit): stop the count at the stage the orchestrator names, else at the
      // first stage without a file, or the last stage when every file is there.
      named = failedStage(dir, code);
      finished = Math.min(finished, named === null ? STAGES.length - 1 : STAGES.indexOf(named));
    }
    this.#advance(job, finished);
    const failure = classifyExit({ code, timedOut, stagesDone: finished, stubbed: code === 0 && wasStubbed(dir) });
    let interrupted = job.stages.find((s) => s.state === 'running'); // the stage that was going when the run failed
    const at = named === null ? -1 : STAGES.indexOf(named);
    if (failure && at >= 0 && at < job.stages.filter((s) => s.state === 'done').length) {
      // A lane that wrote its file and then took longer than two polls to exit 3 (Lane B exits when its loop drains) was already reported done, and the next stage
      // started. The log names the stage that failed, so it is shown failed and every stage after it pending again. event.v1 has no pending state: the stream
      // cannot take back the stages it announced, so it ends with this stage failed, then failed.
      job.stages = STAGES.map((stage, i) => ({ stage, state: i < at ? 'done' : i === at ? 'failed' : 'pending' }));
      interrupted = job.stages[at];
    }
    if (failure) {
      this.#fail(job, failure);
    } else {
      job.status = 'done';
      job.finished_at = this.now().toISOString();
      job.manifest_url = `${this.viewerOrigin}/j/${job.job_id}/manifest.json`; // every stage is done: classifyExit says success only when 50-handoff.json is there
    }
    const spent = this.#recordCost(job); // before the next job is looked at, so its cap check sees this run's cost
    if (spent !== null) job.cost_usd = spent;
    this.#persist(job);
    this.log.log?.(`job ${job.job_id} ${job.status}${failure ? ` (${failure}, exit ${code})` : ''}`);
    this.#running = null;
    this.#child = null;
    if (failure && interrupted) this.#emit(job, 'stage', { stage: interrupted.stage, state: 'failed' });
    if (job.status === 'done') this.#emit(job, 'done', { manifest_url: job.manifest_url });
    else this.#emit(job, 'failed', { code: job.error.code, message: job.error.message });
    this.#announce(); // the jobs behind it move up one place, then the first of them starts
    this.#pump();
  }

  // Stop the process tree and wait for it. Records are left as they are (see #finish).
  close() {
    this.#closing ??= (async () => {
      clearTimeout(this.#timer);
      clearInterval(this.#poller);
      if (this.#child) {
        killTree(this.#child);
        await Promise.race([this.#exited, new Promise((resolve) => setTimeout(resolve, 5000).unref())]);
      }
    })();
    return this.#closing;
  }
}
