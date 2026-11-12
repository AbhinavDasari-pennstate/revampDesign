import { stageList, currentStage, positionText } from './progress.js';

const STATE_WORDS = { done: 'done', running: 'in progress', pending: 'waiting', failed: 'stopped here' };

const HEADINGS = {
  connecting: 'Checking on your redesign',
  queued: 'Your redesign is in line',
  running: 'We are making your redesign',
  done: 'Your redesign is ready',
  failed: 'This run stopped',
};

// The words the screen reader hears when they change: the place in line, the stage now running, or how it ended.
function nowText(state) {
  if (state.status === 'queued') return positionText(state.position);
  if (state.status === 'failed') return state.error.message;
  if (state.status === 'done') return 'Finished.';
  const now = currentStage(state);
  if (now) return `Now: ${now.label}`;
  const stages = stageList(state);
  const next = stages.find((s) => s.state === 'pending');
  return next && stages.some((s) => s.state === 'done') ? `Next: ${next.label}` : 'Starting.';
}

export default function Progress({ state }) {
  const working = state.status !== 'done' && state.status !== 'failed';
  return (
    <section className="progress" aria-labelledby="progress-title">
      <h1 id="progress-title">{HEADINGS[state.status]}</h1>
      <p className={state.status === 'failed' ? 'now now-failed' : 'now'} aria-live="polite">{nowText(state)}</p>
      {working && (
        <p className="progress-note">
          Runs usually take several minutes. You can keep this tab open: the page updates by itself.
        </p>
      )}
      <ol className="stages">
        {stageList(state).map((s) => (
          <li key={s.stage} className={`stage stage-${s.state}`} aria-current={s.state === 'running' ? 'step' : undefined}>
            <span className="stage-mark" aria-hidden="true" />
            <span className="stage-name">{s.label}</span>
            <span className="stage-state">{STATE_WORDS[s.state]}</span>
          </li>
        ))}
      </ol>
      {state.status === 'failed' && (
        <p className="progress-after"><a href="/">Start a new redesign</a></p>
      )}
    </section>
  );
}
