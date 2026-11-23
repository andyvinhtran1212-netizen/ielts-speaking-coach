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
- Not checked: Vercel preview 404 and staging console (after the preview build), WebKit (Q40: no WebKit run in this container).
