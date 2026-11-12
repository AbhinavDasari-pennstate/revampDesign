// The start form's own checks, run before anything is sent. Each failure uses the same text the server would send
// for that field (contracts/web/README.md, rules 2 to 5), so the tester sees one wording whichever side catches it.
import { MESSAGES } from './api.js';

const MAX_URL = 2048;

function isUsableUrl(text) {
  if (text.length > MAX_URL) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' && url.username === '' && url.password === '';
}

// values: {invite_code, url, owner_name, consent}. Returns {field: message} for every bad field; {} means send it.
export function validate(values) {
  const errors = {};
  if (String(values.invite_code ?? '').trim() === '') errors.invite_code = MESSAGES.invite_invalid;
  if (!isUsableUrl(String(values.url ?? '').trim())) errors.url = MESSAGES.bad_url;
  if (String(values.owner_name ?? '').trim() === '') errors.owner_name = MESSAGES.owner_name_required;
  if (values.consent !== true) errors.consent = MESSAGES.consent_required;
  return errors;
}

// start-request.v1 from the form values (call only when validate returned {}).
export const toRequest = (values) => ({
  invite_code: values.invite_code.trim(),
  url: values.url.trim(),
  owner_name: values.owner_name.trim(),
  consent: true,
});
