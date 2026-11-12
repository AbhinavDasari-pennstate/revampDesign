// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import StartForm from '../src/StartForm.jsx';
import { fixture } from './fixtures.js';

const contractMessage = (code) => fixture(`error-${code}.json`).error.message;

const fetchReturning = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function setup({ fetchImpl = fetchReturning(202, fixture('job-queued.json')) } = {}) {
  vi.stubGlobal('fetch', fetchImpl);
  const onStarted = vi.fn();
  render(<StartForm onStarted={onStarted} />);
  const field = {
    code: screen.getByLabelText(/invite code/i),
    url: screen.getByLabelText(/address of your site/i),
    owner: screen.getByLabelText(/owner's name/i),
    consent: screen.getByRole('checkbox'),
  };
  const fill = ({ code = 'K7M2PQ9XWD4R', url = 'https://maplegrove-hs.example/', owner = 'Dana Whitfield', consent = true } = {}) => {
    fireEvent.change(field.code, { target: { value: code } });
    fireEvent.change(field.url, { target: { value: url } });
    fireEvent.change(field.owner, { target: { value: owner } });
    if (consent !== field.consent.checked) fireEvent.click(field.consent);
  };
  const submit = () => fireEvent.click(screen.getByRole('button', { name: /start/i }));
  return { field, fill, submit, onStarted, fetchImpl };
}

// The message a field points at through aria-describedby.
const describedText = (el) => (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('StartForm', () => {
  it('labels every field and explains the consent in plain words', () => {
    const { field } = setup();
    for (const el of Object.values(field)) expect(el.id).not.toBe('');
    const consentLabel = document.querySelector(`label[for="${field.consent.id}"]`).textContent;
    expect(consentLabel).toMatch(/own this site/i);
    expect(consentLabel).toMatch(/permission/i);
    expect(consentLabel).toMatch(/visit|crawl/i);
  });

  it('shows the field error for each bad input, tied with aria-describedby, and does not call the API', async () => {
    const cases = [
      [{ code: '' }, 'code', 'invite_invalid'],
      [{ url: 'maplegrove-hs.example' }, 'url', 'bad_url'],
      [{ owner: '   ' }, 'owner', 'owner_name_required'],
      [{ consent: false }, 'consent', 'consent_required'],
    ];
    for (const [input, name, code] of cases) {
      const { field, fill, submit, fetchImpl } = setup();
      fill(input);
      submit();
      expect(field[name].getAttribute('aria-invalid'), name).toBe('true');
      expect(describedText(field[name]), name).toContain(contractMessage(code));
      expect(document.activeElement).toBe(field[name]);
      for (const other of Object.keys(field).filter((k) => k !== name)) expect(field[other].getAttribute('aria-invalid'), other).not.toBe('true');
      expect(fetchImpl).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('marks every bad field at once and moves focus to the first', () => {
    const { field, submit } = setup();
    submit();
    for (const el of Object.values(field)) expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field.code);
  });

  it('calls the API once on a good form and hands over the job id', async () => {
    const { fill, submit, onStarted, fetchImpl } = setup();
    fill();
    submit();
    submit();
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('Xk3nP9qLm2VbT7sRw4YdHa'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/jobs');
    expect(JSON.parse(init.body)).toEqual(fixture('start-request.json'));
  });

  it('puts a server error on the field it belongs to', async () => {
    const { field, fill, submit, onStarted } = setup({ fetchImpl: fetchReturning(403, fixture('error-invite_invalid.json')) });
    fill();
    submit();
    await waitFor(() => expect(field.code.getAttribute('aria-invalid')).toBe('true'));
    expect(describedText(field.code)).toContain(contractMessage('invite_invalid'));
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('shows a server error that belongs to no field as an alert, and lets the tester try again', async () => {
    const { fill, submit } = setup({ fetchImpl: fetchReturning(503, fixture('error-queue_full.json')) });
    fill();
    submit();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', contractMessage('queue_full'));
    expect(screen.getByRole('button', { name: /start/i }).disabled).toBe(false);
  });
});
