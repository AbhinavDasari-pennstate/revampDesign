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

// A manifest.v1 the page may use: every link http or https, on the manifest's own origin (the viewer) and under
// /j/<job_id>/, and every count a whole number. Anything else is refused as a whole, so no frame or image ever points
// somewhere the viewer does not serve.
export function checkManifest(m, manifestUrl) {
  if (!m || typeof m !== 'object' || !isJobId(m.job_id)) return false;
  let origin;
  try {
    origin = new URL(manifestUrl).origin;
  } catch {
    return false;
  }
  const prefix = `${origin}/j/${m.job_id}/`;
  if (!manifestUrl.startsWith(prefix)) return false;
  const isOurs = (u) => {
    if (typeof u !== 'string') return false;
    try {
      const url = new URL(u);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.href === u && u.startsWith(prefix);
    } catch {
      return false;
    }
  };
  const count = (n) => Number.isInteger(n) && n >= 0;
  const pages = m.site && Array.isArray(m.site.pages) ? m.site.pages : [];
  return pages.length > 0
    && pages.every((p) => p && typeof p.slug === 'string' && p.slug !== '' && isOurs(p.url) && p.screenshots && isOurs(p.screenshots.desktop) && isOurs(p.screenshots.mobile))
    && isOurs(m.site.home_url) && isOurs(m.compare_url) && isOurs(m.report_url) && (m.bundle_url === null || isOurs(m.bundle_url))
    && Boolean(m.gates) && typeof m.gates.passed === 'boolean' && count(m.gates.axe_serious) && count(m.gates.axe_critical)
    && Boolean(m.fidelity) && count(m.fidelity.pages_carried) && count(m.fidelity.pages_total);
}

// GET the viewer's manifest.v1. Resolves to {ok: true, manifest} or {ok: false}; never throws.
export async function getManifest(manifestUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(manifestUrl, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const body = res.status === 200 ? await readJson(res) : null;
    return checkManifest(body, manifestUrl) ? { ok: true, manifest: body } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// GET the run's report.md as text. Resolves to {ok: true, text} or {ok: false}; never throws.
export async function getReport(reportUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(reportUrl, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    return res.status === 200 ? { ok: true, text: await res.text() } : { ok: false };
  } catch {
    return { ok: false };
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
