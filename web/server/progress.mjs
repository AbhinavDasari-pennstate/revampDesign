// Live progress of a run (plan/web-plan.md T43). Node stdlib only; never reads what a stage wrote, only whether it wrote it.
//   - which stage a run is in comes from which contract files exist in its run folder (10-inventory.json to 50-handoff.json). The orchestrator's output goes to
//     console.log and never to the tester, and fs.watch is unreliable on Windows, so queue.mjs polls stagesDone() (every POLL_MS) and once more when the run exits;
//   - how a run ended is classified by classifyExit(): the exit code, the stage it stopped in, and whether orchestrator.log shows a stub fallback (wasStubbed);
//   - the events of a job (the shapes of event.v1) are kept per job by createEventHub, which also answers GET /api/jobs/:id/events as a text/event-stream.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const POLL_MS = 1000;
export const PING_MS = 15000;
// The stages of the orchestrator (orchestrator/lib/run.mjs STAGES), in order, and the contract file whose appearance means the stage has finished.
export const STAGES = ['scout', 'story', 'art', 'council', 'select', 'build'];
export const STAGE_FILES = ['10-inventory.json', '20-storyboard.json', '30-directions.json', '40-verdict.json', '45-selection.json', '50-handoff.json'];

// The run folder the orchestrator made inside the job folder (--out-dir <job dir> gives it exactly one child folder), or null while there is none.
export function runDirOf(jobDir) {
  let entries;
  try {
    entries = readdirSync(jobDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return folders.length > 0 ? join(jobDir, folders[0]) : null;
}

// How many stages have finished: the count of leading stages whose contract file exists, is a plain file and is not empty. A gap stops the count, so a
// stage is never done while an earlier one is not. The files are never opened: a run folder holds text from a scraped site.
export function stagesDone(jobDir) {
  const run = runDirOf(jobDir);
  if (!run) return 0;
  let done = 0;
  for (const file of STAGE_FILES) {
    try {
      const info = lstatSync(join(run, file));
      if (!info.isFile() || info.size === 0) break;
    } catch {
      break;
    }
    done++;
  }
  return done;
}

// True when the run used the sample school for any stage ("STUB <stage> (lane not present)" in orchestrator.log, also the stub mode "STUB <stage> ok <file>"), so a
// tester must never be shown it as their own site. Fails closed: a log that is missing or cannot be read counts as a stub, because the real orchestrator always writes
// one and nothing else vouches for the result. Only the orchestrator's own lines are in that log on a run that exited 0.
export function wasStubbed(jobDir) {
  const run = runDirOf(jobDir);
  if (!run) return true;
  let text;
  try {
    text = readFileSync(join(run, 'orchestrator.log'), 'utf8');
  } catch {
    return true;
  }
  return /^STUB\b/m.test(text) || text.includes('lane not present');
}

// The stage the orchestrator names as the one that failed, or null. Lanes B and C write their output file and then exit 3 when a quality gate fails, so the files
// alone cannot say which stage failed. The orchestrator's log ends a failed run with "FAILED stage <name> failed with exit <n> (...)"; only a stage name from STAGES
// and only the exit code the process really had is accepted, and no other text of the log is ever used.
export function failedStage(jobDir, code) {
  const run = runDirOf(jobDir);
  if (!run) return null;
  let text;
  try {
    text = readFileSync(join(run, 'orchestrator.log'), 'utf8');
  } catch {
    return null;
  }
  const found = /^FAILED stage ([a-z]+) failed with exit (\d+)/m.exec(text);
  return found && STAGES.includes(found[1]) && Number(found[2]) === code ? found[1] : null;
}

// null when the run succeeded, else the run failure code of job.v1.error (contracts/web/README.md). stagesDone is what stagesDone() counted after the run ended
// (for a failed run, up to but not including the stage that failed, see failedStage).
// A run we killed is a timeout whatever its exit code says. Exit 3 is the quality gate, except that at scout (no inventory yet) it means no page could be
// crawled; exit 4 is the budget; an exit 0 is a success only if the last contract file is there and the log shows no stub; anything else is a crash.
export function classifyExit({ code, timedOut = false, stagesDone: done = 0, stubbed = false }) {
  if (timedOut) return 'timeout';
  if (code === 0) {
    if (done < STAGES.length) return 'crash'; // exit 0 without 50-handoff.json would hand out a manifest url that answers 404
    return stubbed ? 'not_real' : null;
  }
  if (code === 3) return done === 0 ? 'site_blocked' : 'quality_gate';
  if (code === 4) return 'budget';
  return 'crash';
}

// The events of a job that has no recorded history (one the server did not run itself: it finished, or was failed as server_restarted, before this start),
// rebuilt from its job.v1 so its stream is still a valid one. The place in line it had is not kept, so the queued event says 1.
export function replayOf(view) {
  const events = [['queued', { position: view.position ?? 1 }]];
  if (view.started_at !== null) events.push(['started', { mode: view.mode }]);
  for (const { stage, state } of view.stages) {
    if (state === 'pending') continue;
    events.push(['stage', { stage, state: 'running' }]);
    if (state !== 'running') events.push(['stage', { stage, state }]);
  }
  if (view.status === 'done') events.push(['done', { manifest_url: view.manifest_url }]);
  if (view.status === 'failed') events.push(['failed', { code: view.error.code, message: view.error.message }]);
  return events;
}

const isLast = (event) => event.name === 'done' || event.name === 'failed';
const frame = ({ id, name, data }) => `id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

// Keeps every job's events (queue.on('event', (job_id, name, data)), the shapes of event.v1) and streams them.
//   stream(req, res, jobId, headers): GET /api/jobs/:id/events for a job that exists. Sends the whole history from id 1 (also when the client sends Last-Event-ID:
//   a client skips the ids it has handled, so the server never has to guess what it saw), then live events, a ": ping" comment every pingMs, and closes the
//   response after the one `done` or `failed`. A job that is already over gets its history and an immediate close.
//   open(): how many streams are open.
export function createEventHub(queue, { pingMs = PING_MS } = {}) {
  const logs = new Map(); // job_id -> [{ id, name, data }]
  const streams = new Set(); // { jobId, send(event) }

  queue.on('event', (jobId, name, data) => {
    const log = logs.get(jobId) ?? [];
    logs.set(jobId, log);
    const event = { id: log.length + 1, name, data };
    log.push(event);
    for (const stream of [...streams]) if (stream.jobId === jobId) stream.send(event);
  });

  function historyOf(jobId) {
    let log = logs.get(jobId);
    if (!log) {
      log = replayOf(queue.view(queue.get(jobId))).map(([name, data], i) => ({ id: i + 1, name, data }));
      logs.set(jobId, log);
    }
    return log;
  }

  return {
    pingMs,
    open: () => streams.size,
    stream(req, res, jobId, headers = {}) {
      const history = [...historyOf(jobId)]; // the snapshot and the subscription below happen in one go, so no event is missed or sent twice
      res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8' });
      for (const event of history) res.write(frame(event));
      if (isLast(history.at(-1))) return void res.end();

      const write = (text, last = false) => {
        try {
          res.write(text);
          if (last) {
            forget();
            res.end();
          }
        } catch {
          forget(); // a client that has gone away must never break the queue that is emitting this event
        }
      };
      const stream = { jobId, send: (event) => write(frame(event), isLast(event)) };
      const timer = setInterval(() => write(': ping\n\n'), pingMs);
      function forget() {
        clearInterval(timer);
        streams.delete(stream);
      }
      streams.add(stream);
      timer.unref();
      res.once('close', forget);
      res.once('error', forget);
    },
  };
}
