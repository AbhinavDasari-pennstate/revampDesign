// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import Progress from '../src/Progress.jsx';
import JobView, { POLL_MS } from '../src/JobView.jsx';
import { initialState, applyEvent, fromJob } from '../src/progress.js';
import { parseSse } from '../dev/mock-server.mjs';
import { fixture, fixtureText } from './fixtures.js';

const JOB = 'Xk3nP9qLm2VbT7sRw4YdHa';
const fold = (name, upTo = Infinity) => parseSse(fixtureText(name)).filter((e) => e.id <= upTo).reduce(applyEvent, initialState());
const live = () => document.querySelector('[aria-live="polite"]');

// Stands in for the browser's EventSource: the test pushes events and errors by hand.
class FakeEventSource {
  static all = [];
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    this.onerror = null;
    FakeEventSource.all.push(this);
  }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  close() { this.closed = true; }
  emit({ id, name, data }) { for (const fn of this.listeners[name] ?? []) fn({ data: JSON.stringify(data), lastEventId: String(id) }); }
  fail() { this.onerror?.(new Event('error')); }
}
const latest = () => FakeEventSource.all.at(-1);

// fetch stub: each GET /api/jobs/<id> answers with the next reply in the list (the last one repeats).
function stubJobs(...replies) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(url);
    const [status, body] = replies.length > 1 ? replies.shift() : replies[0];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Progress', () => {
  it('shows the place in line while queued and says the tab can stay open', () => {
    render(<Progress state={fold('events-queued.sse')} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/in line/i);
    expect(live().textContent).toBe('Yours is next.');
    expect(document.body.textContent).toMatch(/several minutes/i);
    expect(document.body.textContent).toMatch(/keep this tab open/i);
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.stage-name').textContent)).toEqual([
      'Reading your site', 'Writing the story', 'Designing three directions', 'Judging the directions', 'Picking one', 'Building and checking',
    ]);
  });

  it('announces the running stage politely and marks each stage in words', () => {
    render(<Progress state={fromJob(fixture('job-running.json'))} />);
    expect(live().textContent).toBe('Now: Designing three directions');
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/done/);
    expect(items[2].textContent).toMatch(/in progress/);
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(items[5].textContent).toMatch(/waiting/);
  });

  it('names the next stage in the moment between two stages', () => {
    render(<Progress state={fold('events-done.sse', 8)} />);
    expect(live().textContent).toBe('Next: Judging the directions');
    cleanup();
    render(<Progress state={fold('events-done.sse', 2)} />);
    expect(live().textContent).toBe('Starting.');
  });

  it('shows the plain failure message and a way back to the start page', () => {
    render(<Progress state={fold('events-failed.sse')} />);
    expect(live().textContent).toBe(fixture('job-failed-quality_gate.json').error.message);
    expect(screen.getAllByRole('listitem')[5].textContent).toMatch(/stopped here/);
    expect(screen.getByRole('link', { name: /start a new redesign/i }).getAttribute('href')).toBe('/');
    expect(document.body.textContent).not.toMatch(/keep this tab open/i);
  });
});

describe('JobView', () => {
  it('opens the event stream for the job, follows it and draws the final list from GET /api/jobs/:id', async () => {
    const calls = stubJobs([200, fixture('job-queued.json')], [200, fixture('job-done.json')]);
    render(<JobView jobId={JOB} />);
    await flush();
    expect(latest().url).toBe(`/api/jobs/${JOB}/events`);
    const events = parseSse(fixtureText('events-done.sse'));
    act(() => events.slice(0, 9).forEach((e) => latest().emit(e)));
    expect(live().textContent).toBe('Now: Judging the directions');
    act(() => events.slice(9).forEach((e) => latest().emit(e)));
    await flush();
    expect(latest().closed).toBe(true);
    // Two job reads, then the results view asks the viewer for the manifest.
    expect(calls).toEqual([`/api/jobs/${JOB}`, `/api/jobs/${JOB}`, fixture('job-done.json').manifest_url]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/ready/i);
  });

  it('closes the stream when it is unmounted', async () => {
    stubJobs([200, fixture('job-running.json')]);
    const { unmount } = render(<JobView jobId={JOB} />);
    await flush();
    const es = latest();
    unmount();
    expect(es.closed).toBe(true);
  });

  it('falls back to polling every 5 s when the stream errors, and reconnects after a good poll', async () => {
    const calls = stubJobs([200, fixture('job-queued.json')], [500, {}], [200, fixture('job-running.json')]);
    render(<JobView jobId={JOB} />);
    await flush();
    expect(POLL_MS).toBe(5000);
    const first = latest();
    act(() => first.fail());
    expect(first.closed).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS - 1));
    expect(calls.length).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1)); // poll 1: server error, try again later
    expect(calls.length).toBe(2);
    expect(FakeEventSource.all.length).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS)); // poll 2: running, so the stream is opened again
    expect(calls.length).toBe(3);
    expect(FakeEventSource.all.length).toBe(2);
    expect(live().textContent).toBe('Now: Designing three directions');
  });

  it('skips events a reconnected stream replays', async () => {
    stubJobs([200, fixture('job-queued.json')]);
    render(<JobView jobId={JOB} />);
    await flush();
    const events = parseSse(fixtureText('events-done.sse'));
    act(() => events.slice(0, 7).forEach((e) => latest().emit(e)));
    act(() => events.slice(0, 3).forEach((e) => latest().emit(e)));
    expect(live().textContent).toBe('Now: Designing three directions');
  });

  it('opens no stream for a job that has already finished', async () => {
    stubJobs([200, fixture('job-failed-site_blocked.json')]);
    render(<JobView jobId={JOB} />);
    await flush();
    expect(FakeEventSource.all.length).toBe(0);
    expect(live().textContent).toBe(fixture('job-failed-site_blocked.json').error.message);
  });

  it('says the job was not found for an unknown or malformed id', async () => {
    stubJobs([404, fixture('error-not_found.json')]);
    render(<JobView jobId={JOB} />);
    await flush();
    expect(document.body.textContent).toContain(fixture('error-not_found.json').error.message);
    expect(FakeEventSource.all.length).toBe(0);
    cleanup();
    render(<JobView jobId="../../etc" />);
    await flush();
    expect(document.body.textContent).toContain(fixture('error-not_found.json').error.message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
