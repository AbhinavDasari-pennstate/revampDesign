import { useId, useRef, useState } from 'react';
import { validate, toRequest } from './validate.js';
import { startJob } from './api.js';

// A server error that is about one field is shown on that field; the rest go in the alert under the button.
const FIELD_OF_CODE = {
  invite_invalid: 'invite_code',
  invite_used_today: 'invite_code',
  bad_url: 'url',
  host_not_public: 'url',
  owner_name_required: 'owner_name',
  consent_required: 'consent',
};
const ORDER = ['invite_code', 'url', 'owner_name', 'consent'];

function TextField({ id, label, hint, error, inputRef, ...input }) {
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div className={error ? 'field has-error' : 'field'}>
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-hint`} className="hint">{hint}</p>
      <input id={id} ref={inputRef} aria-invalid={error ? 'true' : undefined} aria-describedby={describedBy} {...input} />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}

export default function StartForm({ onStarted }) {
  const id = useId();
  const [values, setValues] = useState({ invite_code: '', url: '', owner_name: '', consent: false });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const refs = { invite_code: useRef(null), url: useRef(null), owner_name: useRef(null), consent: useRef(null) };

  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: name === 'consent' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (busy.current) return;
    setFormError('');
    const found = validate(values);
    setErrors(found);
    const first = ORDER.find((name) => found[name]);
    if (first) {
      refs[first].current.focus();
      return;
    }
    busy.current = true;
    setSending(true);
    const result = await startJob(toRequest(values));
    if (result.ok) {
      onStarted(result.job.job_id);
      return;
    }
    busy.current = false;
    setSending(false);
    const field = FIELD_OF_CODE[result.code];
    if (field) {
      setErrors({ [field]: result.message });
      refs[field].current.focus();
    } else {
      setFormError(result.message);
    }
  }

  const consentId = `${id}-consent`;
  return (
    <form className="start-form" noValidate onSubmit={submit}>
      <TextField
        id={`${id}-code`} label="Invite code" hint="The code from your invitation."
        error={errors.invite_code} inputRef={refs.invite_code}
        value={values.invite_code} onChange={set('invite_code')}
        type="text" autoComplete="off" autoCapitalize="characters" spellCheck="false"
      />
      <TextField
        id={`${id}-url`} label="Web address of your site" hint="Copy it from your browser, for example https://www.maplegrove.org"
        error={errors.url} inputRef={refs.url}
        value={values.url} onChange={set('url')}
        type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck="false"
      />
      <TextField
        id={`${id}-owner`} label="Site owner's name" hint="The person responsible for the site. If that is you, enter your own name."
        error={errors.owner_name} inputRef={refs.owner_name}
        value={values.owner_name} onChange={set('owner_name')}
        type="text" autoComplete="name" maxLength={200}
      />

      <div className={errors.consent ? 'field consent has-error' : 'field consent'}>
        <input
          id={consentId} ref={refs.consent} type="checkbox" checked={values.consent} onChange={set('consent')}
          aria-invalid={errors.consent ? 'true' : undefined} aria-describedby={errors.consent ? `${consentId}-error` : undefined}
        />
        <label htmlFor={consentId}>
          I own this site, or its owner has given me permission to have it redesigned. I understand that your tool will
          visit (crawl) the public pages of the site to read their text and pictures.
        </label>
        {errors.consent && <p id={`${consentId}-error`} className="field-error">{errors.consent}</p>}
      </div>

      <div className="actions">
        <button type="submit" className="primary" disabled={sending}>
          {sending ? 'Starting your redesign' : 'Start my redesign'}
        </button>
        {formError && <p role="alert" className="form-error">{formError}</p>}
      </div>
    </form>
  );
}
