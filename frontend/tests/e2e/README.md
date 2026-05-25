# Frontend E2E smoke tests (F4)

Minimal **browser** smoke tests (Playwright + headless chromium) that exercise
real runtime behaviour the source-scan / `node --test` sentinels cannot — the
gap that let Sprint 15.1.1 (silent save failure) and 15.1.2 (modal positioning)
ship CI-green. Sprint 15.2 ships the **frontend modal** half; the persistence
half (needs a Supabase-local backend stack) is Sprint 15.4.

## Scope (2 spec files, 3 tests)
- `modal_renders.spec.js` — weak-word badge → modal opens **centered + visible** (guards the 15.1.2 bottom-left regression).
- `modal_dismisses.spec.js` — ESC and the close button dismiss the modal.

No backend, no Supabase, no audio, no external APIs: an isolated harness
(`fixtures/harness.html`) loads the real `css/ds.css` + `js/pronunciation-drilldown.js`,
seeds a stub weak-word registry, and clicks the public badge.

## Run locally
```bash
cd frontend
npm install
npx playwright install chromium   # one-time, ~90MB
npx playwright test               # or: npm run test:e2e
```
Failure artifacts (screenshots, traces) land in `playwright-report/` + `test-results/`.

## CI
Runs on every PR via `.github/workflows/e2e.yml` as an **advisory** check — it
annotates but does **not** block merge (not in branch protection). Promote to
required once it proves stable (Andy decision).

## Convention boundary
Playwright + `node_modules` are **bounded to `frontend/tests/e2e/`**. The rest of
the frontend stays zero-dependency (`node --test`, source-scan). Do NOT import
`@playwright` outside this directory.
