import { describe, it, expect } from 'vitest';
import { STAGES, initialState, applyEvent, fromJob, stageList, currentStage, positionText, isFinished } from '../src/progress.js';
import { parseSse } from '../dev/mock-server.mjs';
import { fixture, fixtureText, failedJobFixtures } from './fixtures.js';

const fold = (events, state = initialState()) => events.reduce(applyEvent, state);
const stream = (name) => parseSse(fixtureText(name));
const states = (state) => Object.fromEntries(stageList(state).map((s) => [s.stage, s.state]));

describe('stage names', () => {
  it('has the six contract stages in order with plain names', () => {
    expect(STAGES.map((s) => s.stage)).toEqual(['scout', 'story', 'art', 'council', 'select', 'build']);
    expect(STAGES.map((s) => s.label)).toEqual([
      'Reading your site', 'Writing the story', 'Designing three directions', 'Judging the directions', 'Picking one', 'Building and checking',
    ]);
  });
});

describe('folding the fixture streams', () => {
  it('events-done.sse ends done, every stage done, with the manifest url', () => {
    const events = stream('events-done.sse');
    expect(events.map((e) => e.id)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const s = fold(events);
    expect(s.status).toBe('done');
    expect(isFinished(s)).toBe(true);
    expect(Object.values(states(s))).toEqual(Array(6).fill('done'));
    expect(s.manifestUrl).toBe('http://127.0.0.1:8788/j/Xk3nP9qLm2VbT7sRw4YdHa/manifest.json');
    expect(currentStage(s)).toBeNull();
  });

  it('shows the running stage by its plain name on the way', () => {
    const events = stream('events-done.sse');
    const atArt = fold(events.slice(0, 7));
    expect(atArt.status).toBe('running');
    expect(atArt.mode).toBe('free');
    expect(currentStage(atArt)).toEqual({ stage: 'art', label: 'Designing three directions', state: 'running' });
    expect(states(atArt)).toEqual({ scout: 'done', story: 'done', art: 'running', council: 'pending', select: 'pending', build: 'pending' });
  });

  it('events-failed.sse ends failed at build with the quality_gate text', () => {
    const s = fold(stream('events-failed.sse'));
    expect(s.status).toBe('failed');
    expect(isFinished(s)).toBe(true);
    expect(states(s).build).toBe('failed');
    expect(s.error).toEqual({ code: 'quality_gate', message: fixture('job-failed-quality_gate.json').error.message });
  });

  it('events-queued.sse gives the place in line, 3 then 2 then 1', () => {
    const events = stream('events-queued.sse');
    expect(events.map((e) => fold(events.slice(0, e.id)).position)).toEqual([3, 2, 1]);
    const s = fold(events);
    expect(s.status).toBe('queued');
    expect(isFinished(s)).toBe(false);
    expect(positionText(1)).toBe('Yours is next.');
    expect(positionText(2)).toBe('1 run is ahead of yours.');
    expect(positionText(3)).toBe('2 runs are ahead of yours.');
  });

  it('skips events it already handled, so a reconnect that replays from id 1 changes nothing', () => {
    const events = stream('events-done.sse');
    const half = fold(events.slice(0, 8));
    expect(fold(events.slice(0, 8), half)).toEqual(half);
    expect(fold(events, half)).toEqual(fold(events));
  });

  it('lets a failed stage win when a slow lane had already moved on (issue #34 note)', () => {
    const events = [
      ...stream('events-done.sse').slice(0, 8), // up to art done
      { id: 9, name: 'stage', data: { stage: 'council', state: 'running' } },
      { id: 10, name: 'stage', data: { stage: 'art', state: 'failed' } },
      { id: 11, name: 'failed', data: { code: 'quality_gate', message: 'x' } },
    ];
    const s = fold(events);
    expect(states(s)).toEqual({ scout: 'done', story: 'done', art: 'failed', council: 'pending', select: 'pending', build: 'pending' });
    expect(stageList(s).some((x) => x.state === 'running')).toBe(false);
  });

  it('ignores events it cannot use', () => {
    const s = fold([{ id: 1, name: 'stage', data: { stage: 'deploy', state: 'running' } }, { id: 2, name: 'queued', data: { position: -1 } }, { id: 3, name: 'party', data: {} }]);
    expect(s.status).toBe('connecting');
    expect(Object.values(states(s))).toEqual(Array(6).fill('pending'));
  });
});

describe('job.v1 snapshots', () => {
  it('reads the queued, running and done fixtures', () => {
    expect(fromJob(fixture('job-queued.json'))).toMatchObject({ status: 'queued', position: 2 });
    expect(currentStage(fromJob(fixture('job-running.json')))?.label).toBe('Designing three directions');
    expect(fromJob(fixture('job-done.json'))).toMatchObject({ status: 'done', manifestUrl: fixture('job-done.json').manifest_url });
  });

  it('gives the plain contract message for every failure code, from a job and from a failed event', () => {
    for (const [file, job] of failedJobFixtures()) {
      const fromSnapshot = fromJob(job);
      expect(fromSnapshot.status, file).toBe('failed');
      expect(fromSnapshot.error, file).toEqual({ code: job.error.code, message: job.error.message });
      expect(fold([{ id: 1, name: 'failed', data: job.error }]).error, file).toEqual({ code: job.error.code, message: job.error.message });
    }
  });

  it('keeps the last event id, so the stream that follows a poll does not replay old events', () => {
    const s = fromJob(fixture('job-running.json'), 7);
    expect(s.lastId).toBe(7);
    expect(applyEvent(s, { id: 3, name: 'stage', data: { stage: 'scout', state: 'running' } })).toBe(s);
  });
});
