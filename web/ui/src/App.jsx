import StartForm from './StartForm.jsx';
import JobView from './JobView.jsx';

// One page, no router: the start form at /, the job view at /?job=<job_id>.
const goToJob = (jobId) => window.location.assign(`/?job=${encodeURIComponent(jobId)}`);

function StartPage() {
  return (
    <div className="start">
      <section className="intro" aria-labelledby="intro-title">
        <h1 id="intro-title">See your website rebuilt around what you do</h1>
        <p className="lede">
          Give us the address of your current site. We read every page, keep every fact, and build a new version for you
          to look through. Your real site is not changed.
        </p>
        <ol className="steps">
          <li><strong>We read your site.</strong> Every public page: its words, pictures, contact details and links.</li>
          <li><strong>We design three directions.</strong> A panel of judges compares them and picks the strongest.</li>
          <li><strong>You look through the result.</strong> The new site, the three directions side by side, and a plain report of what still needs a person.</li>
        </ol>
      </section>
      <section className="panel" aria-labelledby="start-title">
        <h2 id="start-title">Start a redesign</h2>
        <p className="panel-note">It is free and usually takes several minutes.</p>
        <StartForm onStarted={goToJob} />
      </section>
    </div>
  );
}

export default function App() {
  const jobId = new URLSearchParams(window.location.search).get('job');
  return (
    <div className="shell">
      <header className="masthead">
        <a className="wordmark" href="/">Redesign preview</a>
      </header>
      <main id="main">{jobId === null ? <StartPage /> : <JobView jobId={jobId} />}</main>
      <footer className="colophon">
        <p>A preview made by automated tools for invited testers. Nothing is published.</p>
      </footer>
    </div>
  );
}
