// Talks to the app server with relative /api paths, so the same build works on the mock and on web/server/.
// Every message shown to the tester comes from MESSAGES below, copied from contracts/web/README.md ("Error codes
// and their fixed text"). A response is only ever used to pick a code; its own text is never shown.

export const MESSAGES = Object.freeze({
  bad_request: 'We could not read that request. Please reload the page and try again.',
  bad_url: 'That does not look like a web address we can use. Enter the full address of your site, starting with http or https.',
  host_not_public: 'We can only redesign sites that anyone on the internet can open. That address points to a private or local computer.',
  owner_name_required: 'Please enter the name of the person who owns this site.',
  consent_required: "Please tick the box to confirm that you own this site or have the owner's permission.",
  invite_invalid: 'That invite code was not recognised. Check it and try again.',
  invite_used_today: 'This invite code has already been used today. Please try again tomorrow.',
  daily_cap_reached: 'We have reached our limit for today. Please try again tomorrow.',
  queue_full: 'Several redesigns are waiting right now. Please try again in a little while.',
  not_found: 'We could not find that. Check the link and try again.',
  site_blocked: 'We could not open any page of your site. It may block automated visitors, or it may be offline.',
  quality_gate: 'We could not finish a redesign that passes our quality checks, so we are not showing one.',
  budget: 'This run would go over its spending limit, so it was stopped.',
  not_real: 'This run could not build a real redesign of your site, so there is nothing to show.',
  timeout: 'This run took too long and was stopped. Please try again later.',
  crash: 'Something went wrong on our side while building your redesign. Please try again later.',
  server_restarted: 'The server restarted while your run was in progress, so it was stopped. Please start it again.',
});

// For a reply that is not a valid error.v1, or no reply at all.
export const GENERIC_MESSAGE = 'Something went wrong on our side. Please wait a moment and try again.';

export const isKnownCode = (code) => typeof code === 'string' && Object.hasOwn(MESSAGES, code);
export const messageFor = (code) => (isKnownCode(code) ? MESSAGES[code] : GENERIC_MESSAGE);

// error.v1 is {error: {code, message}}. Anything else, or a code we do not know, gets the generic text.
export function readError(body) {
  const code = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error.code : undefined;
  return isKnownCode(code) ? { code, message: MESSAGES[code] } : { code: null, message: GENERIC_MESSAGE };
}

export const isJobId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);

const STATUSES = ['queued', 'running', 'done', 'failed'];
const isJob = (j) => Boolean(j) && typeof j === 'object' && isJobId(j.job_id) && STATUSES.includes(j.status) && Array.isArray(j.stages) && j.stages.length === 6;

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// GET /api/jobs/:id. Resolves to {ok: true, job} or {ok: false, code, message} (code not_found for an unknown job); never throws.
export async function getJob(jobId, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`/api/jobs/${encodeURIComponent(jobId)}`);
    const body = await readJson(res);
    if (res.status === 200 && isJob(body) && body.job_id === jobId) return { ok: true, job: body };
    return { ok: false, ...readError(body) };
  } catch {
    return { ok: false, code: null, message: GENERIC_MESSAGE };
  }
}

// Sends start-request.v1. Resolves to {ok: true, job} or {ok: false, code, message}; never throws.
export async function startJob(request, fetchImpl = fetch) {
  try {
    const res = await fetchImpl('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const body = await readJson(res);
    if (res.status === 202 && isJob(body)) return { ok: true, job: body };
    return { ok: false, ...readError(body) };
  } catch {
    return { ok: false, code: null, message: GENERIC_MESSAGE };
  }
}
