import { useEffect, useReducer } from 'react';
import Progress from './Progress.jsx';
import { getJob, isJobId, MESSAGES } from './api.js';
import { EVENT_NAMES, initialState, applyEvent, fromJob, isFinished } from './progress.js';

export const POLL_MS = 5000;

function reducer(state, action) {
  switch (action.type) {
    case 'event': return applyEvent(state, action.event);
    case 'job': return fromJob(action.job, state.lastId);
    case 'missing': return { ...state, status: 'missing' };
    default: return state;
  }
}

// Follows one job: GET /api/jobs/:id first, then the event stream. When the stream errors it is closed and the job is
// polled every POLL_MS; a good poll opens the stream again (the server replays from id 1, applyEvent skips what was
// seen). When the run ends, the final stage list comes from GET /api/jobs/:id, which is always right (issue #34).
function useJob(jobId) {
  const valid = isJobId(jobId);
  const [state, dispatch] = useReducer(reducer, undefined, () => (valid ? initialState() : { ...initialState(), status: 'missing' }));

  useEffect(() => {
    if (!valid) return undefined;
    let stopped = false;
    let source = null;
    let timer = null;

    const closeStream = () => {
      if (source) source.close();
      source = null;
    };

    async function poll() {
      const result = await getJob(jobId);
      if (stopped) return;
      if (result.ok) {
        dispatch({ type: 'job', job: result.job });
        if (!isFinished({ status: result.job.status })) connect();
      } else if (result.code === 'not_found') {
        dispatch({ type: 'missing' });
      } else {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    function connect() {
      source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
      for (const name of EVENT_NAMES) {
        source.addEventListener(name, (e) => {
          let data;
          try {
            data = JSON.parse(e.data);
          } catch {
            return;
          }
          dispatch({ type: 'event', event: { id: Number.parseInt(e.lastEventId, 10), name, data } });
          if (name === 'done' || name === 'failed') {
            closeStream();
            poll();
          }
        });
      }
      source.onerror = () => {
        closeStream();
        timer = setTimeout(poll, POLL_MS);
      };
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      closeStream();
    };
  }, [jobId, valid]);

  return state;
}

export default function JobView({ jobId }) {
  const state = useJob(jobId);
  if (state.status === 'missing') {
    return (
      <section className="panel narrow" aria-labelledby="missing-title">
        <h1 id="missing-title">This link does not lead to a redesign</h1>
        <p>{MESSAGES.not_found}</p>
        <p className="progress-after"><a href="/">Start a new redesign</a></p>
      </section>
    );
  }
  return <Progress state={state} />;
}
