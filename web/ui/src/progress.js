// What the progress page shows, folded from event.v1 events and job.v1 snapshots. Plain logic: no DOM, no React.
import { isKnownCode, messageFor } from './api.js';

export const STAGES = Object.freeze([
  { stage: 'scout', label: 'Reading your site' },
  { stage: 'story', label: 'Writing the story' },
  { stage: 'art', label: 'Designing three directions' },
  { stage: 'council', label: 'Judging the directions' },
  { stage: 'select', label: 'Picking one' },
  { stage: 'build', label: 'Building and checking' },
]);
export const EVENT_NAMES = Object.freeze(['queued', 'started', 'stage', 'done', 'failed']);

const ORDER = STAGES.map((s) => s.stage);
const STAGE_STATES = ['pending', 'running', 'done', 'failed'];
const allPending = () => Object.fromEntries(ORDER.map((stage) => [stage, 'pending']));

// status: connecting (nothing heard yet), queued, running, done or failed.
export const initialState = () => ({ status: 'connecting', position: null, mode: null, stages: allPending(), manifestUrl: null, error: null, lastId: 0 });

const finishedStatus = (status) => status === 'done' || status === 'failed';
export const isFinished = (state) => finishedStatus(state.status);

const failure = (code) => ({ code: isKnownCode(code) ? code : null, message: messageFor(code) });

// A run that ends stops every stage still marked running: the failed stage wins (issue #34, T43 review note).
const stopRunning = (stages) => Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v === 'running' ? 'pending' : v]));

// Applies one event {id, name, data}. An id at or below the last one handled is a replay after a reconnect and is skipped.
export function applyEvent(state, { id, name, data }) {
  if (Number.isInteger(id) && id <= state.lastId) return state;
  const next = { ...state, lastId: Number.isInteger(id) ? id : state.lastId };
  const d = data && typeof data === 'object' ? data : {};
  switch (name) {
    case 'queued':
      if (!Number.isInteger(d.position) || d.position < 1) return state;
      return { ...next, status: 'queued', position: d.position };
    case 'started':
      return { ...next, status: 'running', position: null, mode: d.mode === 'live' ? 'live' : 'free' };
    case 'stage': {
      const at = ORDER.indexOf(d.stage);
      if (at < 0 || !STAGE_STATES.includes(d.state) || d.state === 'pending') return state;
      const stages = { ...next.stages, [d.stage]: d.state };
      if (d.state === 'failed') for (const later of ORDER.slice(at + 1)) stages[later] = 'pending';
      return { ...next, status: isFinished(next) ? next.status : 'running', position: null, stages };
    }
    case 'done':
      return { ...next, status: 'done', position: null, stages: stopRunning(next.stages), manifestUrl: typeof d.manifest_url === 'string' ? d.manifest_url : null };
    case 'failed':
      return { ...next, status: 'failed', position: null, stages: stopRunning(next.stages), error: failure(d.code) };
    default:
      return state;
  }
}

// The state a job.v1 snapshot shows. lastId is kept, so a stream opened after a poll skips what it already showed.
export function fromJob(job, lastId = 0) {
  const stages = allPending();
  for (const s of job.stages) if (ORDER.includes(s.stage) && STAGE_STATES.includes(s.state)) stages[s.stage] = s.state;
  return {
    status: job.status,
    position: job.status === 'queued' ? job.position : null,
    mode: job.mode,
    stages: finishedStatus(job.status) ? stopRunning(stages) : stages,
    manifestUrl: job.status === 'done' ? job.manifest_url : null,
    error: job.status === 'failed' && job.error ? failure(job.error.code) : null,
    lastId,
  };
}

export const stageList = (state) => STAGES.map((s) => ({ ...s, state: state.stages[s.stage] }));
export const currentStage = (state) => stageList(state).find((s) => s.state === 'running') ?? null;

// position counts the run in progress as a place: 1 means nothing is ahead.
export function positionText(position) {
  const ahead = position - 1;
  if (ahead <= 0) return 'Yours is next.';
  return ahead === 1 ? '1 run is ahead of yours.' : `${ahead} runs are ahead of yours.`;
}
