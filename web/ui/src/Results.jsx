import { useEffect, useId, useRef, useState } from 'react';
import Report from './Report.jsx';
import { parseReport } from './report.js';
import { getManifest, getReport } from './api.js';

const VIEWS = [
  { id: 'redesign', label: 'Redesign' },
  { id: 'report', label: 'Report' },
  { id: 'compare', label: 'Compare directions' },
  { id: 'screens', label: 'Screenshots' },
];

// "about-us" -> "About us". The slug is the only name a page has in the manifest.
const pageName = (slug) => {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function fidelityText({ pages_carried: carried, pages_total: total }) {
  if (carried === total) return `All ${plural(total, 'page', 'pages')} from your old site were carried over.`;
  return `${carried} of ${plural(total, 'page', 'pages')} from your old site were carried over.`;
}

function gatesText({ passed, axe_serious: serious, axe_critical: critical }) {
  if (passed && serious + critical === 0) return 'It passed our automatic checks, with no serious or critical accessibility problems found.';
  if (passed) return 'It passed our automatic checks.';
  return `It did not pass every automatic check: ${serious} serious and ${critical} critical accessibility problems were found.`;
}

// Scraped output is only ever shown from the viewer origin, in a frame that may run scripts and nothing else.
function Frame({ src, title }) {
  return <iframe className="frame" src={src} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" />;
}

function RedesignView({ pages }) {
  const [current, setCurrent] = useState(0);
  const page = pages[current];
  return (
    <>
      <div className="view-bar">
        <div className="page-picker" role="group" aria-label="Pages">
          {pages.map((p, i) => (
            <button key={p.slug} type="button" aria-pressed={i === current} onClick={() => setCurrent(i)}>{pageName(p.slug)}</button>
          ))}
        </div>
        <a href={page.url} target="_blank" rel="noopener noreferrer">Open this page in a new tab</a>
      </div>
      <Frame src={page.url} title={`Redesigned ${pageName(page.slug)} page`} />
    </>
  );
}

function ReportView({ url }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let live = true;
    getReport(url).then((r) => { if (live) setReport(r); });
    return () => { live = false; };
  }, [url]);
  if (!report) return <p className="muted">Loading the report.</p>;
  if (!report.ok) return <p className="muted">We could not load the report. Please reload the page to try again.</p>;
  return <Report tree={parseReport(report.text)} />;
}

function ScreensView({ pages }) {
  return (
    <div className="screens">
      {pages.map((p) => {
        const name = pageName(p.slug);
        return (
          <figure key={p.slug} className="screen-pair">
            <figcaption>{name}</figcaption>
            <div className="screen-row">
              <img className="shot-desktop" src={p.screenshots.desktop} alt={`${name} page on a computer screen`} referrerPolicy="no-referrer" loading="lazy" />
              <img className="shot-mobile" src={p.screenshots.mobile} alt={`${name} page on a phone`} referrerPolicy="no-referrer" loading="lazy" />
            </div>
          </figure>
        );
      })}
    </div>
  );
}

function Views({ manifest }) {
  const id = useId();
  const [active, setActive] = useState('redesign');
  const tabs = useRef({});

  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    const at = VIEWS.findIndex((v) => v.id === active);
    let next = null;
    if (step) next = VIEWS[(at + step + VIEWS.length) % VIEWS.length].id;
    if (e.key === 'Home') next = VIEWS[0].id;
    if (e.key === 'End') next = VIEWS[VIEWS.length - 1].id;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next].focus();
  };

  const panels = {
    redesign: <RedesignView pages={manifest.site.pages} />,
    report: <ReportView url={manifest.report_url} />,
    compare: <Frame src={manifest.compare_url} title="The three design directions compared" />,
    screens: <ScreensView pages={manifest.site.pages} />,
  };

  return (
    <div className="views">
      <div className="tabs" role="tablist" aria-label="Your results" onKeyDown={onKeyDown}>
        {VIEWS.map((v) => (
          <button
            key={v.id} type="button" role="tab" id={`${id}-tab-${v.id}`} aria-controls={`${id}-panel-${v.id}`}
            aria-selected={active === v.id} tabIndex={active === v.id ? 0 : -1}
            ref={(el) => { tabs.current[v.id] = el; }} onClick={() => setActive(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {VIEWS.map((v) => (
        <div key={v.id} role="tabpanel" id={`${id}-panel-${v.id}`} aria-labelledby={`${id}-tab-${v.id}`} hidden={active !== v.id} className="panel-view">
          {panels[v.id]}
        </div>
      ))}
    </div>
  );
}

export default function Results({ manifestUrl }) {
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let live = true;
    getManifest(manifestUrl).then((r) => { if (live) setLoaded(r); });
    return () => { live = false; };
  }, [manifestUrl]);

  const manifest = loaded?.ok ? loaded.manifest : null;
  return (
    <section className="results" aria-labelledby="results-title">
      <h1 id="results-title">Your redesign is ready</h1>
      {!loaded && <p className="lede">Loading your results.</p>}
      {loaded && !manifest && (
        <p className="lede">We could not load your results. Please reload the page to try again.</p>
      )}
      {manifest && (
        <>
          <p className="lede">{fidelityText(manifest.fidelity)} {gatesText(manifest.gates)}</p>
          <aside className="note" aria-label="Before you use it">
            <p>
              This is a preview made by automated tools, and nothing has been published. Before it replaces your site,
              it needs a person to check it. The Report lists what needs a person: pages that could not be carried
              over, forms that need a service behind them, and anything else flagged for manual work.
            </p>
            {manifest.bundle_url && (
              <a className="primary download" href={manifest.bundle_url} download>Download the site files (.tar.gz)</a>
            )}
          </aside>
          <Views manifest={manifest} />
        </>
      )}
    </section>
  );
}
