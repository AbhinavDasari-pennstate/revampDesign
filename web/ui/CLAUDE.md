# web/ui: the tester app front end (Lane B, Nirmal)

React 19 app built with Vite. One page: the start form at `/`, the job view at `/?job=<job_id>`. Plan: `plan/web-plan.md` (T41, T44, T46). The API is frozen in `contracts/web/` (tag `contracts-web-v1.0.0`): read it as data, never edit it; changes go through a `contract-cr` issue. Branch prefix `lane-b/`.

## Run and test
- `npm ci` once. Node 22.12 or later (CI uses `.nvmrc`, 24).
- `npm test`: Vitest, no network. Logic tests run in Node, component tests in jsdom (`// @vitest-environment jsdom` at the top of the file).
- `npm run build`: writes `dist/` (gitignored). `node web/server/server.mjs` (Abhinav's server) serves only `dist/`.
- `npm run mock`: the fixture mock, app on `http://127.0.0.1:8787` (serves `dist/` with the real app CSP, plus `/api`), viewer on `http://127.0.0.1:8788` (the sample run). Build first, then open `http://127.0.0.1:8787/`.
- `npm run dev` with `npm run mock` running: hot reload on `http://127.0.0.1:5173/`, `/api` proxied to the mock.
- Mock switches: open `http://127.0.0.1:8787/?fail=<code>` and submit the form to get `error-<code>.json` with its HTTP status (any of the ten `error.v1` codes). `?run=done|failed|queued` picks which fixture stream the new job plays (default done). The three job ids are in `SCENARIOS` in the mock, so `/?job=<id>` also works without a POST; each run plays one event per second from its POST (or from the first request that names it).

## Files
- `src/api.js`: `/api` calls with relative paths, the fixed message of every contract code (`MESSAGES`), `readError`, `isJobId`.
- `src/validate.js`: the start form's own checks, with the contract text of the code the server would send for that field.
- `src/StartForm.jsx`: the form. `src/App.jsx`: page shell and the choice of view. `src/main.jsx`: mounts it. `src/app.css`: all styles.
- `src/progress.js`: the progress fold (`applyEvent`, `fromJob`), the six stage names, the place-in-line text. No DOM, no React.
- `src/JobView.jsx`: follows one job (GET, then the event stream, polling when the stream fails). `src/Progress.jsx`: draws the state.
- `dev/mock-server.mjs`: the fixture mock (Node stdlib only), also imported by the tests.
- `test/`: `validate.test.js` (form checks and the message of every error fixture), `StartForm.test.jsx`, `progress.test.js` (the fold over each `.sse` fixture and every failure code), `Progress.test.jsx` (the page, and `JobView` with a stand-in `EventSource` and fake timers), `mock.test.js`, `no-markup.test.js`, and `fixtures.js` (reads `contracts/web/fixtures/`).

## Rules for this folder
- Scraped text only ever goes in as React text children. `test/no-markup.test.js` fails on `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `DOMParser` anywhere in `src/`, comments included.
- Text shown to the tester comes from `MESSAGES` in `src/api.js` (copied from `contracts/web/README.md`). A response only picks the code; its own `message` is never shown, and a body that is not a valid `error.v1` with a known code gets `GENERIC_MESSAGE`.
- The build must work under the app CSP (`default-src 'self'`, viewer origin allowed for frames, images and fetch): no inline scripts or styles, no `eval`, no font or script from another origin. System fonts only.
- No cookies, no `localStorage`, no secret in the browser.
- Approved installs, exact versions, lockfile committed: react, react-dom, vite, @vitejs/plugin-react, vitest, jsdom, @testing-library/react. `@testing-library/dom` comes in as the required peer of `@testing-library/react` (lockfile only). Ask Abhinav before adding anything else.
- Build and test only against `contracts/web/fixtures/` and `contracts/fixtures/sample/`, never against `web/server/` or `web/viewer/`.
- No em dashes or en dashes anywhere.

## Decisions made in T41 where the plan is silent
- The plan names `validate.mjs` and `api.mjs`; with Vite they are `src/validate.js` and `src/api.js`. The api message tests live in `test/validate.test.js` (the T41 file list has no api test file).
- An empty invite code shows the `invite_invalid` text, as the plan asks, even though the code was never sent.
- An address without `http://` or `https://` is refused, not completed, so the tester sees the same rule the server applies (rule 2). The hint shows a full example.
- Server errors about one field (`invite_invalid`, `invite_used_today`, `bad_url`, `host_not_public`, `owner_name_required`, `consent_required`) show on that field and move focus to it; the rest (`bad_request`, `queue_full`, `daily_cap_reached`, `not_found`, anything unknown) show in a `role="alert"` under the button.
- Owner name input has `maxLength` 200 (UTF-16 units, so never over the server's 200 code points).
- The mock's app pages carry no `Referrer-Policy` (the real server sends `no-referrer`): the `?fail=` switch reads the posting page's URL from the Referer.
- The mock checks paths like the viewer will: decoded segments, no dot segments, no encoded slash or backslash, `realpath` inside the sample run, and only the five allowed run folders.

## Decisions made in T44 where the plan is silent
- `getJob` went into `src/api.js` next to `startJob` (the T44 file list does not name `api.js`).
- The job view always starts with `GET /api/jobs/:id`: an unknown id shows not found (no stream is opened), a finished job is drawn at once (no stream either), anything else opens the stream. A malformed id never reaches the network.
- Reconnect: when the stream errors it is closed and the job is polled every 5 s; the first good poll opens the stream again. The server replays from id 1 and `applyEvent` skips every id it has handled, so nothing is shown twice.
- On `done` or `failed` the stream is closed and the final stage list comes from `GET /api/jobs/:id` (the issue #34 rule). A `stage failed` event also resets every later stage to waiting, and `done` or `failed` stops any stage still marked running, so a slow lane never leaves a spinner behind.
- The `aria-live="polite"` line says the place in line, "Now: <stage>", "Next: <stage>" in the second between two stages, the failure message, or "Finished.". Each stage also says its state in words (done, in progress, waiting, stopped here), and the running one has `aria-current="step"`.
- The mock follows the contract, not the older plan line: a reconnect with `Last-Event-ID` gets the whole history from id 1.

## Design review (T41, master-designer pass on screenshots at 375 and 1280 px against the mock)
- Fixed: the headline wrapped to four short lines at 1280 px (max width 15ch, now 17ch).
- Fixed: `?fail=` did nothing in a browser because the mock sent `no-referrer` (see above).
- Kept: at 375 px the form starts below the first screen, after the three steps. Story first is the PRD design bar, and the steps answer "what will happen to my site" before the tester is asked for anything.
- Checked: no horizontal scroll at 375 px, a visible focus ring on every control, an error text tied with `aria-describedby` to every field, no console errors under the app CSP.

## Design review (T44, screenshots at 375 and 1280 px of queued, running, done, failed and not found against the mock)
- Fixed: between two stages the line read "Starting." in the middle of a run; it now names the next stage.
- Fixed: the not found heading repeated the message under it; it now reads "This link does not lead to a redesign".
- Checked: no horizontal scroll at 375 px, the running stage is the only one with a tint, the pulse stops under reduced motion, and failed is shown in words as well as colour.
