# Fixture modal smoke tests

Playwright browser tests for the pronunciation drilldown modal's rendering and
dismissal behavior. These retained fixture checks exercise browser behavior
that source scans cannot establish. They do not cover application persistence.

## Scope
- `modal_renders.spec.js` — weak-word badge → modal opens **centered + visible** (guards the 15.1.2 bottom-left regression).
- `modal_dismisses.spec.js` — ESC and the close button dismiss the modal.

No backend, no Supabase, no audio, no external APIs: an isolated harness
(`fixtures/harness.html`) loads the real `css/ds.css` + `js/pronunciation-drilldown.js`,
seeds a stub weak-word registry, and clicks the public badge.

## Run locally
```bash
cd frontend
npm ci
npx playwright install chromium   # one-time, ~90MB
npx playwright test               # or: npm run test:e2e
```
Failure artifacts (screenshots, traces) land in `playwright-report/` + `test-results/`.

## CI
Runs for matching frontend/workflow PR changes and pushes to main via
`.github/workflows/e2e.yml`, whose check is named **E2E modal smoke (advisory)**.
That workflow also runs the separately configured Next Speaking regression.
Check current branch protection when determining required merge checks.

## Convention boundary
This directory is the isolated static modal harness, not the full frontend.
The application is Next.js/React and dependencies are managed by
`frontend/package-lock.json`.

- Node contract tests use the retired-fixture loader specified in
  [../../../docs/AGENT_WORKFLOW.md](../../../docs/AGENT_WORKFLOW.md).
- React interaction tests run with `npm run test:react`.
- Next browser journeys are configured in
  `.github/workflows/next-native-browser.yml` and `frontend/tooling/`.
- Live staging release tests use `playwright.staging.config.js` and
  `tests/staging-e2e/`; they require synthetic identities and staging access.

Passing this harness alone does not establish Next route or live release health.
