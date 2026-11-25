# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** theo task sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A`
theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=report; ref=PR body evidence table per wave, layers 1–3 (T002–T007); scenario 2, 3, 7 | PENDING |
| FR-002 | kind=check; ref=docs/TEST_INVARIANT_LEDGER.md LEGACYJS-0075 rows per wave (T002–T007); scenario 5, 6 | PENDING |
| FR-003 | kind=journey; ref=CI Next-native browser regression + run-flow-repeat --runs 2 + preview curl 404 + staging console check (T002–T007); scenario 1 | PENDING |
| FR-004 | kind=check; ref=PR file list contains no Non-goals file (T002–T007) | PENDING |
| FR-005 | kind=command; ref=plan.md layer-1 name and dynamic-URL scan incl. public/js and comments (T001); scenario 2, 3, 4 | PENDING |
| FR-006 | kind=report; ref=PR body table file · lines · L1 · L2 · L3 · tests · ledger (T002–T007) | PENDING |
| FR-007 | kind=check; ref=count of edited test files per PR <= 30 (T002–T007) | PENDING |

## W1 (T002, G10-T07-W1) — 2026-11-23, base `cc6dd4c8`

The 15 `frontend/public/js/admin-listening-*.js` files (4,688 lines) are deleted. The rows above stay `PENDING` until all waves land; this section records the W1 evidence.

- Layer 1 (FR-005): no name or `/js/…` path of the 15 files in Next code (`app`, `components`, `lib`, `proxy.ts`, `next.config.ts`, `instrumentation-client.ts`) or in any kept `public/js` file, comments included. The only dynamic `/js/` URL family in the codebase is `vocab-modules/*`, which W1 does not touch.
- Layer 2 (FR-001): every browser suite CI runs locally, with the `tooling/capture-public-js.mjs` preload recording each `/js/…` request, on a fresh build of the base tree `cc6dd4c8` with the 15 files still present (Chromium only). **No capture contains `/js/admin-listening-`.** Raw URL lists are kept outside the repo.

  | Suite (CI command) | First run | Stopped early? | Rerun | `/js/admin-listening-` |
  |---|---|---|---|---|
  | 119 flow commands of `next-native-browser.yml` | 115 exit 0, 4 exit 1 | 2 Writing flows stopped at their first scenario | see the 4 rows below | 0 |
  | `verify-writing-content-history-flow.mjs` | exit 1: `unexpected GET /favicon.svg` (the container's Chromium asks for `favicon.svg`; the flow allows only `/favicon.ico`) | yes | temp copy that also allows `/favicon.svg`: 70/70 | 0 |
  | `verify-writing-admission-flow.mjs` | exit 1, same favicon cause | yes | same temp copy: 27/27 scenarios | 0 |
  | `verify-admin-listening-fulltest-import-flow.mjs` | 17/18: the two-tab race check | no, every step ran | after the deletion 2/2 pass | 0 |
  | `verify-csp-nonce-404-flow.mjs` | exit 1: run without its enforced build | yes | probe page + `AVER_CSP_NONCE_ENFORCE=1` build + `--enforced`: exit 0 | 0 |
  | `npx playwright test` (`e2e.yml`, 15 tests) | 8 pass, 7 time out on the loading screen | yes (the 7) | 15/15 (see note) | 0 |
  | `npm run test:e2e:speaking-regression` (Chromium desktop project) | 19/19 | no | none needed | 0 |
  | `playwright.reading-native.config.js` | 49 pass, 1 skipped | no | none needed | 0 |
  | `playwright.visual.config.js` | 20 pass, 116 fail, 10 skipped | no: all 116 failures are the final `toHaveScreenshot` comparison (font rendering differs from the CI baselines), so every page loaded fully | rerun with the CDN note: same 20/116/10, all 116 on `toHaveScreenshot` | 0 |

  Note on the e2e rerun: the container's network blocks `cdn.jsdelivr.net` and `unpkg.com`, so the Supabase SDK never loaded and 7 tests stayed on "Đang tải...". The rerun serves those two exact URLs (`@supabase/supabase-js@2.107.0`, `lucide@1.17.0`) from the same versions in `node_modules`. CI has this network access; the same suite is green on `cc6dd4c8`.

  Not run locally: `playwright.staging.config.js` and `playwright.production-smoke.config.js` target the deployed URLs; `playwright.spike.config.js` is not in CI. WebKit projects (`speaking-webkit-desktop`, staging WebKit): **no evidence** (Q40), as this container has Chromium only.
- Layer 3: no access log yet (Q-b2 open).
- After the deletion: `run-flow-repeat.mjs --runs 2` passes for all 15 `verify-admin-listening-*-flow.mjs`. On a fresh `next start`, `/js/admin-listening-tf.js` → 404. Node contract suite: 13,995 tests, 13,994 pass, 1 fail (env-only `hook pre-push`). `npm run test:react` 1337/1337, `tsc --noEmit` clean, `npm run build` ok.
- FR-002 / FR-007: 25 test files edited or retired (limit 30), with one ledger row each in `docs/TEST_INVARIANT_LEDGER.md` › "LEGACYJS-0075 W1 — 2026-11-23". 4 invariants are ported to the Next tests (segment helper cases, the danger-zone gate on the test detail page, the Vietnamese T/F/NG labels, the "Ẩn khỏi web" visibility toggle). `admin-listening-audit-paging.test.mjs` is retired; its replacement is the 101-row paging in `verify-admin-listening-audit-flow.mjs`.
- FR-004: no Non-goals file in the diff. Retired HTML fixtures are kept.
- Not checked: Vercel preview 404 and staging console (after the preview build), WebKit (Q40: no WebKit run in this container). The branch had no preview because `tooling/vercel-ignore-build.sh` skips branches without the `[preview]` opt-in; the commit that adds this line carries `[preview]` to request one.

## W2 (T003, G10-T07-W2) — 2026-11-23, base W1 `651cbd05`

The 7 mock-cockpit scripts in `frontend/public/js/` (2,880 lines) are deleted: `admin-exam-content.js`, `admin-mock-exams.js`, `admin-mock-live.js`, `admin-mock-pacing.js`, `admin-mock-report.js`, `admin-mock-reviews.js`, `admin-mock-tests.js`. Their 7 path-filter lines in `next-native-browser.yml` go with them. The rows above stay `PENDING` until all waves land; this section records the W2 evidence.

- Layer 1 (FR-005): no name or `/js/…` path of the 7 files in Next code (`app`, `components`, `lib`, `proxy.ts`, `next.config.ts`, `instrumentation-client.ts`) or in any kept `public/js` file, comments included. Remaining mentions are the retired HTML fixtures (kept, ADR-005) and `docs/audits/GATE_F_ASSET_INVENTORY_2026-09-10.json` (dated audit, not changed). One code comment in `backend/services/mock_review_workflow.py` now names `initialBandDraft` instead of the deleted `draftBandOf`.
- Layer 2 (FR-001), on a build of the tree with the 7 files present and the job env of `next-native-browser.yml` (`AVER_ENVIRONMENT=test`, fixture API on 3999):
  - `tooling/capture-public-js.mjs` over all 120 browser-regression steps (119 flows and the visual suite). 117 exit 0. 3 exit 1, none on a missing script: the visual suite (screenshot pixels, container fonts), `verify-admin-speaking-sessions-layout-flow` (placeholder width, container fonts) and `verify-csp-nonce-404-flow --enforced` (run without its enforced build).
  - The Playwright suites, with the same preload: `playwright.reading-native.config.js` 49 passed, 1 skipped; `playwright.speaking-regression.config.js` Chromium project 19/19 (WebKit is not in this container, Q40); `playwright.config.js` (`tests/e2e`) 8 passed, 7 failed on timeouts in the Speaking `practice.js` fixtures, which load none of the 7 files.
  - **No capture contains any of the 7 file names.** Raw URL lists are kept outside the repo.
- Layer 3: no access log yet (Q-b2 open).
- After the deletion: `run-flow-repeat.mjs --runs 2` passes for `verify-admin-mock-tests-flow`, `-exams-flow`, `-live-flow` and `-reviews-flow` (pacing runs inside the live flow). On a fresh `next start`, `/js/admin-mock-reviews.js`, `/js/admin-exam-content.js` and `/js/admin-mock-tests.js` → 404, `/js/api.js` → 200. Node contract suite: 13,943 tests, 13,942 pass, 1 fail (env-only `hook pre-push`). `npm run test:react` 1337/1337, `tsc --noEmit` clean, `npm run build` ok. `backend/tests/test_exam_content_level_cohort.py` 74/74.
- FR-002 / FR-007: 20 test files edited or retired (limit 30), with one ledger row each in `docs/TEST_INVARIANT_LEDGER.md` › "LEGACYJS-0075 W2 — 2026-11-23". `admin-exam-content-ui.test.mjs` is retired (its invariants are held by the Next mock-exams tests). The legacy roster popover pins in `mock-roster-retest-picker.test.mjs` are retired: the Next roster draws inline checkboxes.
- Gaps found, not fixed here (no product change in a retirement wave): the Next review form does not show the legacy "Chưa có band tự tính — cần bạn nhập" caption, a Writing-specific blankable reason or "(overall sẽ để trống theo)". Recorded in the ledger row of `mock-review-band-prefill.test.mjs`. Closed since: `staging` 53bc1ccb restored all three captions in `bandCaption()`; after the merge of `staging` e0a894c4 the three ported tests run `bandCaption()` instead of matching caption strings in the TSX.
- FR-004: no Non-goals file in the diff. Retired HTML fixtures are kept.
- FR-003 deployed check (2026-11-25, Mac mini in-app browser, Chromium):
  - Vercel preview of `ec1f4f65` (`[preview]` commit; branch alias `ielts-speaking-co-git-5bc9bc-…vercel.app`): `/js/admin-exam-content.js`, `/js/admin-mock-exams.js`, `/js/admin-mock-live.js`, `/js/admin-mock-pacing.js`, `/js/admin-mock-report.js`, `/js/admin-mock-reviews.js`, `/js/admin-mock-tests.js` → 404; `/js/api.js` → 200; `/` → 200.
  - On the preview, `/admin/mock-tests` redirects to `/login` without a session, and the preview origin is not in the staging backend's CORS allow-list (`/api/public-stats` and `/api/analytics/events` are blocked), so the signed-in console check cannot run on the preview. Before that redirect, the only `/js/*` requests are the shared chrome scripts (all 200/304); none of the 7 names.
  - Stable staging (still serving the 7 files), signed in as admin: `/admin/mock-tests`, `/admin/mock-exams`, `/admin/mock-exams/corrections`, `/admin/mock-live`, `/admin/mock-pacing` (→ `mock-tests?tab=live`), `/admin/mock-reviews` and `/admin/mock-reviews/report` (→ `mock-tests?tab=review`). Each page's `/js/*` requests are only `runtime-config`, `error-reporter`, `api`, `analytics-beacon`, `components/aver-admin-chrome`, `curated-availability`, `theme-toggle`, `components/perf-hints`; none of the 7 names, and no `/js/*` response ≥ 400. Deleting the 7 files therefore adds no `/js/*` 404 to these pages.
- Not checked yet: staging console after merge (repeat the staging list above on the merged SHA), WebKit (Q40).
