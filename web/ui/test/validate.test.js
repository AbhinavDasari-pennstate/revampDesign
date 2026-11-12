import { describe, it, expect } from 'vitest';
import { validate, toRequest } from '../src/validate.js';
import { messageFor, readError, startJob, GENERIC_MESSAGE } from '../src/api.js';
import { fixture, errorFixtures, failedJobFixtures } from './fixtures.js';

const good = { invite_code: 'K7M2PQ9XWD4R', url: 'https://maplegrove-hs.example/', owner_name: 'Dana Whitfield', consent: true };
const contractMessage = (code) => fixture(`error-${code}.json`).error.message;

describe('validate', () => {
  it('accepts the contract start request', () => {
    expect(validate(good)).toEqual({});
    expect(toRequest(good)).toEqual(fixture('start-request.json'));
  });

  it('rejects an empty invite code with the invite_invalid text', () => {
    for (const invite_code of ['', '   ']) expect(validate({ ...good, invite_code })).toEqual({ invite_code: contractMessage('invite_invalid') });
  });

  it('rejects an address without http or https with the bad_url text', () => {
    for (const url of ['', 'maplegrove-hs.example', 'ftp://maplegrove-hs.example/', 'javascript:alert(1)', 'file:///C:/x', 'https://', 'https://user:pass@maplegrove-hs.example/', `https://a.example/${'x'.repeat(2048)}`]) {
      expect(validate({ ...good, url }), url).toEqual({ url: contractMessage('bad_url') });
    }
    expect(validate({ ...good, url: '  http://maplegrove-hs.example  ' })).toEqual({});
  });

  it('rejects an empty owner name with the owner_name_required text', () => {
    for (const owner_name of ['', '  \t ']) expect(validate({ ...good, owner_name })).toEqual({ owner_name: contractMessage('owner_name_required') });
  });

  it('rejects an unticked box with the consent_required text', () => {
    expect(validate({ ...good, consent: false })).toEqual({ consent: contractMessage('consent_required') });
  });

  it('reports every bad field at once', () => {
    expect(Object.keys(validate({ invite_code: '', url: '', owner_name: '', consent: false })).sort()).toEqual(['consent', 'invite_code', 'owner_name', 'url']);
  });

  it('trims what it sends', () => {
    expect(toRequest({ invite_code: ' k7m2 ', url: ' https://a.example/ ', owner_name: ' Dana ', consent: true }))
      .toEqual({ invite_code: 'k7m2', url: 'https://a.example/', owner_name: 'Dana', consent: true });
  });
});

describe('api messages', () => {
  it('maps every error fixture to its contract text', () => {
    const errors = errorFixtures();
    expect(errors.length).toBe(10);
    for (const [code, body] of errors) {
      expect(messageFor(code)).toBe(body.error.message);
      expect(readError(body)).toEqual({ code, message: body.error.message });
    }
  });

  it('maps every run failure code to its contract text', () => {
    const failed = failedJobFixtures();
    expect(failed.length).toBe(8);
    for (const [, job] of failed) expect(messageFor(job.error.code)).toBe(job.error.message);
  });

  it('shows its own generic text for anything that is not a known error.v1', () => {
    for (const body of [null, 'oops', {}, { error: 'x' }, { error: { code: 'teapot', message: 'Server said <b>hi</b>' } }, { error: { code: 'toString' } }]) {
      expect(readError(body)).toEqual({ code: null, message: GENERIC_MESSAGE });
    }
    // A known code always shows the page's own copy of the text, never the text the response carried.
    expect(readError({ error: { code: 'bad_url', message: 'anything else' } }).message).toBe(contractMessage('bad_url'));
  });
});

describe('startJob', () => {
  const respond = (status, body) => async (url, init) => {
    respond.calls.push([url, init]);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  respond.calls = [];

  it('posts the request as JSON to the relative /api path and returns the job', async () => {
    respond.calls = [];
    const result = await startJob(fixture('start-request.json'), respond(202, fixture('job-queued.json')));
    expect(result).toEqual({ ok: true, job: fixture('job-queued.json') });
    const [url, init] = respond.calls[0];
    expect(url).toBe('/api/jobs');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(fixture('start-request.json'));
  });

  it('returns the error code and the contract text for every error fixture', async () => {
    for (const [code, body] of errorFixtures()) {
      expect(await startJob(good, respond(400, body))).toEqual({ ok: false, code, message: body.error.message });
    }
  });

  it('falls back to the generic text for a broken body, a bad job or no network', async () => {
    expect(await startJob(good, respond(500, '<html>'))).toEqual({ ok: false, code: null, message: GENERIC_MESSAGE });
    expect(await startJob(good, respond(202, { job_id: 'short' }))).toEqual({ ok: false, code: null, message: GENERIC_MESSAGE });
    expect(await startJob(good, async () => { throw new TypeError('Failed to fetch'); })).toEqual({ ok: false, code: null, message: GENERIC_MESSAGE });
  });
});
