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
- Layer 2 (FR-001): `tooling/capture-public-js.mjs` preload over the 119 flow commands of `next-native-browser.yml`, on a fresh build of the base tree with the files still present: 115 flows exit 0 and 4 exit 1, none of them on a missing script (2 Writing flows: `favicon.svg` request check; the fulltest-import two-tab race check, which passes 2/2 after the deletion; `verify-csp-nonce-404-flow` run without its enforced build). **No capture contains `/js/admin-listening-`.** Raw URL lists are kept outside the repo.
- Layer 3: no access log yet (Q-b2 open).
- After the deletion: `run-flow-repeat.mjs --runs 2` passes for all 15 `verify-admin-listening-*-flow.mjs`. On a fresh `next start`, `/js/admin-listening-tf.js` → 404. Node contract suite: 13,995 tests, 13,994 pass, 1 fail (env-only `hook pre-push`). `npm run test:react` 1337/1337, `tsc --noEmit` clean, `npm run build` ok.
- FR-002 / FR-007: 25 test files edited or retired (limit 30), with one ledger row each in `docs/TEST_INVARIANT_LEDGER.md` › "LEGACYJS-0075 W1 — 2026-11-23". 4 invariants are ported to the Next tests (segment helper cases, the danger-zone gate on the test detail page, the Vietnamese T/F/NG labels, the "Ẩn khỏi web" visibility toggle). `admin-listening-audit-paging.test.mjs` is retired; its replacement is the 101-row paging in `verify-admin-listening-audit-flow.mjs`.
- FR-004: no Non-goals file in the diff. Retired HTML fixtures are kept.
- Not checked: Vercel preview 404 and staging console (after the preview build), WebKit (Q40: no WebKit run in this container).

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
- Gaps found, not fixed here (no product change in a retirement wave): the Next review form does not show the legacy "Chưa có band tự tính — cần bạn nhập" caption, a Writing-specific blankable reason or "(overall sẽ để trống theo)". Recorded in the ledger row of `mock-review-band-prefill.test.mjs`.
- FR-004: no Non-goals file in the diff. Retired HTML fixtures are kept.
- Not checked: Vercel preview 404 and staging console (after the preview build), WebKit (Q40).
