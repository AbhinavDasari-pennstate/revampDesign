// The fixed texts and HTTP statuses of contracts/web/README.md ("Error codes and their fixed text"), copied here so the server has no
// runtime dependency on contracts/. test/server.test.mjs compares every one of them with the contract fixtures, so a drift fails a test.
// Messages are written for a school office or small organisation owner: never put scraped text or orchestrator output in one.

// error.v1 codes sent by the API: HTTP status and text. daily_cap_reached is in the contract but reserved: v1 never sends it.
export const API_ERRORS = {
  bad_request: [400, 'We could not read that request. Please reload the page and try again.'],
  bad_url: [400, 'That does not look like a web address we can use. Enter the full address of your site, starting with http or https.'],
  host_not_public: [400, 'We can only redesign sites that anyone on the internet can open. That address points to a private or local computer.'],
  owner_name_required: [400, 'Please enter the name of the person who owns this site.'],
  consent_required: [400, "Please tick the box to confirm that you own this site or have the owner's permission."],
  invite_invalid: [403, 'That invite code was not recognised. Check it and try again.'],
  invite_used_today: [429, 'This invite code has already been used today. Please try again tomorrow.'],
  queue_full: [503, 'Several redesigns are waiting right now. Please try again in a little while.'],
  not_found: [404, 'We could not find that. Check the link and try again.'],
};

// job.v1 error codes (also the `failed` event): text only, they have no HTTP status.
export const RUN_FAILURES = {
  site_blocked: 'We could not open any page of your site. It may block automated visitors, or it may be offline.',
  quality_gate: 'We could not finish a redesign that passes our quality checks, so we are not showing one.',
  budget: 'This run would go over its spending limit, so it was stopped.',
  not_real: 'This run could not build a real redesign of your site, so there is nothing to show.',
  timeout: 'This run took too long and was stopped. Please try again later.',
  crash: 'Something went wrong on our side while building your redesign. Please try again later.',
  server_restarted: 'The server restarted while your run was in progress, so it was stopped. Please start it again.',
};
