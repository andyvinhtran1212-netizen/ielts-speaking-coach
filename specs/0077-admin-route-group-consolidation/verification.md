# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** theo task sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A`
theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=command; ref=plan.md stylesheet link diff empty per page + TESTPOLICY-0057 visual baseline unchanged (T001–T007); scenario 1, 5 | PENDING |
| FR-002 | kind=check; ref=first G09 page under (authed-admin) without shell layout passes route-ownership-check.mjs (ADMINIA-0074); scenario 6 | PENDING |
| FR-003 | kind=check; ref=ls frontend/app shows the three kept groups after T007 | PENDING |
| FR-004 | kind=journey; ref=/admin/writing/queue and /admin links contain no parent-prefix page sheet (T001–T007); scenario 4 | PENDING |
| FR-005 | kind=journey; ref=frontend/tests/visual/admin.spec.js client-navigation screenshot equals the same scene on the pre-PR SHA, each of the 4 base sheet hrefs exactly once, previous-route page sheets not more than pre-PR (T001); scenario 2, 3 | PENDING |
| FR-006 | kind=test; ref=route-ownership-check.mjs, route-ledger-matches-app, workflow-path-coverage, authed-shell tests per PR (T001–T007) | PENDING |
| FR-007 | kind=check; ref=group and edited-test counts per PR (T001–T007) | PENDING |

## T001 pilot evidence (G10-T14, 2026-11-20)

Base `344a75fd` (spec approval commit, staging `119ad352` underneath) against the
pilot commit, each built with the CI fixture environment
(`AVER_API_BASE=http://127.0.0.1:3999`, `next start`) and the
`tooling/next-native-fixture-api.mjs` fixture.

- **Scenario 5 (FR-001):** the plan's `curl … | grep -o '<link rel="stylesheet"[^>]*>'`
  loop over `/admin/feedback`, `/admin/error-logs`, `/admin/foot-traffic` and
  `/admin/users` gives identical lists on both builds once the per-request
  `nonce` is removed (`diff` empty).
- **Direct-load screenshots (FR-001):** `/admin/feedback` at 1280×800 is
  pixel-identical before and after (Pillow `ImageChops.difference(...).getbbox()`
  is `None`). TESTPOLICY-0057 baselines do not exist yet.
- **Client navigation (FR-005), `tooling/verify-admin-route-group-flow.mjs`:**
  for all six ordered pairs of the three pages, the new page's sheets are all
  present in direct-load order, `<body>` class and highlighted sidebar entry
  equal the direct load, and an inactive account is still sent to `/login`
  (39/39 pass after; 33/39 on the base, whose six failures are duplicated
  base sheets).
- **FR-005 (amended 20/11, "no worse than today"):** with `cacheComponents: true`
  the App Router keeps the previous route mounted but hidden, so its
  stylesheets stay in the DOM after a client navigation. On the base the
  previous page leaves its whole shell (tokens, components, 4 admin base sheets
  and its page sheet, so base sheets are duplicated); after the pilot it leaves
  only its page sheet and each base sheet href appears exactly once (enforced
  by the verifier). Leftover page sheets are therefore fewer than before. The
  client-navigation screenshot differs from the direct load by the same 9,972
  pixels (`(12, 132, 1224, 727)`) on both builds; a direct before/after
  comparison of the client-navigation scene is still to be recorded with the
  TESTPOLICY-0057 baseline. Removing the leftover page sheets is a separate
  task outside this spec.

## T002 wave 1 evidence (G10-T15-1, 2026-11-20)

`usage` and `overview` moved; `system` and `mfa` stay in their own groups for
now, per the owner's decision of 2026-11-21 ("keep separate, fix the UI
later"). At the time `(authed-admin-system)` loaded no `admin-buttons.css` and
`(authed-admin-mfa)` no `admin-status.css`, so moving either under the
four-base-sheet parent could change what they render (FR-001); they join in a
later wave.

- Scenario 5: `<link rel="stylesheet">` lists for `/admin`, `/admin/usage`,
  `/admin/feedback`, `/admin/error-logs`, `/admin/foot-traffic`, `/admin/users`
  are identical on base `344a75fd` and this change (nonce stripped); `/admin`
  sheets do not reach other admin pages (FR-004).
- Direct-load screenshots 1280×800: `/admin`, `/admin/usage`, `/admin/feedback`,
  `/admin/foot-traffic` pixel-identical; `/admin/error-logs` differs by 2 pixels
  of value 1 (anti-aliasing).
- `verify-admin-route-group-flow.mjs` over the five moved pages: 114/114 checks
  pass (94/114 on the base); all 20 client navigations leave only the previous
  page's own sheets, as accepted for FR-005 on 2026-11-20.
- Re-applied on staging `cc6dd4c8` (2026-11-23): the same verifier passes
  114/114 with the same 20 FR-005 observations; `npm run build`, `tsc --noEmit`
  and the React suite (1337/1337) pass.
- Review R1 (2026-11-23): the verifier now requires each of the 4 base sheet
  hrefs exactly once, both on direct load (in order) and after every client
  navigation; before, it counted only `admin-status.css`. Head: 119/119.
  Base `cc6dd4c8` with the same verifier: 105/119, the 14 failures are the
  base sheets duplicated after navigating between a moved and a not-yet-moved
  group.
- Client-navigation screenshots 1280×800, base `cc6dd4c8` vs head:
  `/admin/feedback → /admin` differs by 25,822 pixels (`(304, 324, 1240, 800)`)
  on the base, where the previous page's leftover shell restyles the overview;
  on head it is pixel-identical to the direct load of `/admin` (0 pixels).
  `/admin/feedback → /admin/usage`: base and head identical (0 pixels).
  Direct loads of `/admin` and `/admin/usage`: base and head identical.

## T003 evidence (G10-T15-2, 2026-11-23)

`users`, `students`, `classes` and `instructors` move to `(authed-admin)/(users)`, `(students)`, `(classes)`, `(instructors)`. Each child layout adds only its page sheets with a plain `<link rel="stylesheet">` and keeps `export const instant = false;`. URLs and page code are unchanged. Stacked on T002 (#2480); the base for the comparison is staging `cc6dd4c8`.

- `verify-admin-route-group-flow.mjs`, extended to 9 pages (`/admin/students` uses `active="classes"`, as the page sets it): head **394/394**. The same verifier on base `cc6dd4c8`: 328/394. The 66 failures are all "base sheets duplicated" after a client navigation between pages that do not yet share the parent layout. The 72 FR-005 observations (the previous page's own sheet stays in the DOM) are reported, not enforced, per amended FR-005.
- Screenshots 1280×800, head vs base, CI fixture environment:
  - Direct loads of all 9 pages: 0 px difference.
  - Client navigation `/admin/feedback →` `/admin/users`, `/admin/students`, `/admin/classes`: 0 px.
  - `/admin/students ↔ /admin/classes`: 0 px.
  - `/admin/feedback → /admin/instructors`: 19 px, all inside the "Làm mới" button. The same box differs between head client navigation and head direct load, so it is a button transition caught mid-frame, not a stylesheet change.
  - `/admin/feedback → /admin`: 25,822 px. Base is wrong here; head equals the direct load (as recorded for T002).
- Frontend contract suite: 14,143 tests, 14,142 pass, 1 fail. The failure is env-only (`hook pre-push`).
- `npm run test:react`: pass. `tsc --noEmit`: clean after the build. `npm run build`: ok. `route-ownership-check.mjs` and `--manifest`: clean.

## T004 evidence (G10-T15-3, 2026-11-23)

`grammar`, `grammar-analytics`, `grammar-articles`, `grammar-recommend` and `vocab` move to `(authed-admin)/(grammar)`, `(grammar-analytics)`, `(grammar-articles)`, `(grammar-recommend)`, `(vocab)`. Each child layout adds only its page sheets with a plain `<link rel="stylesheet">` (vocab keeps `admin-vocab-next.css` then `vocabulary-workspace.css`) and keeps `export const instant = false;`. URLs and page code are unchanged. Stacked on T003 (#2535); the base for the comparison is staging `cc6dd4c8`.

- `verify-admin-route-group-flow.mjs`, extended to 14 pages (the 4 grammar pages use `active="grammar"`): head **962/962**. The same verifier on base `cc6dd4c8`: 786/962; all 176 failures are "base sheets duplicated" after a client navigation between pages that do not yet share the parent layout. The 182 FR-005 observations are reported, not enforced, per amended FR-005. The verifier now opens a page whose sidebar entry is hidden (a sub-item of a collapsed section, such as `/admin/grammar/recommend-test`) with the same `router.push` it already used for pages without an entry.
- Screenshots 1280×800, head vs base, CI fixture environment:
  - Direct loads of all 14 pages: 0 px against the base run before this one. The second base run differs by 8 px in one box on `/admin/grammar/articles` while both head runs are identical, so that box varies on base itself.
  - Client navigation `/admin/feedback →` `/admin/grammar`, `/admin/grammar/analytics`, `/admin/grammar/recommend-test`, `/admin/vocab`, `/admin/users`, `/admin/classes`: 0 px. `/admin/grammar/analytics → /admin/grammar` and `/admin/grammar → /admin/vocab`: 0 px.
  - `/admin/feedback → /admin/grammar/articles`: 30 px; head equals its own direct load (0 px), so the difference is on base.
  - `/admin/feedback → /admin/usage` and `→ /admin/instructors`: 19 px each, the same box at the top right ("Làm mới" button transition). It differs the same way between head client navigation and head direct load.
  - `/admin/feedback → /admin/students`: 1 px. `/admin/grammar → /admin/grammar/analytics`: 8 px in a 6×3 box. Head and base both differ from the direct load there by the same order (previous page's own sheet left by `cacheComponents`, FR-005 observation).
  - `/admin/feedback → /admin`: 25,822 px. Base is wrong here; head equals the direct load (as recorded for T002).
- Frontend contract suite: 14,126 tests, 14,125 pass, 1 fail. The failure is env-only (`hook pre-push`).
- `npm run test:react`: pass. `tsc --noEmit`: clean. `npm run build`: ok. `route-ownership-check.mjs` and `--manifest`: clean.

## T005 evidence (G10-T15-4, 2026-11-23)

`speaking`, `speaking-sessions` and `speaking-topics` move to `(authed-admin)/(speaking)`, `(speaking-sessions)`, `(speaking-topics)`, each child layout with its one page sheet as a plain `<link rel="stylesheet">` and `export const instant = false;`. `listening` stays a separate group (coordinator, option a, 23/11): its layout puts `aver-design/components.css` between `admin-surface.css` and `admin-components.css`, and a child layout can only emit links after the parent's 4 base sheets, so moving it would change the cascade order (FR-001). Stacked on T004 (#2553); base for the comparison is staging `cc6dd4c8`.

- `verify-admin-route-group-flow.mjs`, extended to 17 pages: head **1422/1422**. Same verifier on base `cc6dd4c8`: 1156/1422; all 266 failures are "base sheets duplicated" after a client navigation between pages that do not yet share the parent layout. The 272 FR-005 observations are reported, not enforced.
- Screenshots 1280×800, head vs base, CI fixture environment:
  - Direct loads of all 17 pages: 0 px. (`/admin/grammar/articles` differs by 8 px from this base run and 0 px from the earlier base run; the box varies on base, as noted in T004.)
  - Every client navigation shot is 0 px, including `/admin/feedback →` the 3 speaking pages and `/admin/speaking ↔` its sub-pages, except `/admin/feedback → /admin` (25,822 px; base is wrong, head equals the direct load, as in T002). The small T004 differences (19, 30, 8, 1 px) are 0 px in this run, so they were frame timing.
- `telemetry-coverage.test.mjs` walks top-level route groups only: the 3 moved groups no longer get their own 4 telemetry tests (12 fewer tests); `(authed-admin)`, whose layout is the only one that renders the shell for them, is still covered.
- Frontend contract suite: 14,114 tests, 14,113 pass, 1 fail (env-only `hook pre-push`). `npm run test:react`: pass. `tsc --noEmit`: clean. `npm run build`: ok. `route-ownership-check.mjs` and `--manifest`: clean.

## T006 evidence (G10-T15-5, 2026-11-23)

`reading`, `reading-attempts`, `mock-exams`, `mock-live` and `mock-reviews` move to `(authed-admin)/(reading)`, `(reading-attempts)`, `(mock-exams)`, `(mock-live)`, `(mock-reviews)`; each child layout emits its page sheets as plain `<link rel="stylesheet">` in the old order (`mock-exams`: `admin-mock-exams-next`, `admin-exam-ops-next`, `admin-mock-corrections`; `mock-live` / `mock-reviews`: own sheet then `admin-exam-ops-next`) and keeps `export const instant = false;`. `reading-content` stays a separate group for the same reason as `listening` (T005): its layout puts `aver-design/components.css` between the base sheets. Stacked on T005 (#2567); base for the comparison is staging `cc6dd4c8`.

- `verify-admin-route-group-flow.mjs`, extended to 22 pages: head **2388/2388**; base `cc6dd4c8` 1932/2388, all 456 failures are "base sheets duplicated" after client navigation between groups that do not yet share the parent. `/admin/mock-reviews` redirects to `/admin/mock-tests` without `mock_exam_id`, so the verifier opens it as `/admin/mock-reviews?mock_exam_id=<fixture uuid>` and now matches path plus query when it waits for a page.
- Screenshots 1280×800, head vs base:
  - Direct loads of all 22 pages: 0 px (the `/admin/grammar/articles` box that varies on base, as in T004).
  - Client navigation `/admin/feedback →` `/admin/reading`, `/admin/mock-exams`, `/admin/mock-live`, `/admin/mock-reviews?…`: 0 px. `/admin/mock-live → /admin/mock-reviews?…` and back to `/admin/mock-exams`: 0 px.
  - `/admin/mock-exams → /admin/mock-live`: 9,933 px, all in the sidebar row under the pointer (the "Reading" item shows its hover background). Both pages are in the same parent now, so the sidebar stays mounted under the pointer after the click; on base the shell remounts and the hover is not repainted. No stylesheet difference.
  - `/admin/feedback → /admin/dashboard/reading-attempts` (10 px), `/admin/error-logs → /admin/feedback` (28 px), `→ /admin/instructors` (19 px), `→ /admin/grammar/articles` (30 px), `/admin/grammar → /admin/grammar/analytics` (8 px): the top-right button box and the frame-timing boxes seen in T003–T005, 0 px in other runs.
  - `/admin/feedback → /admin`: 25,822 px; base is wrong, head equals the direct load (T002).
- Frontend contract suite: 14,094 tests, 14,093 pass, 1 fail (env-only `hook pre-push`); the count drops with the per-group telemetry tests, as in T005. `npm run test:react`: pass. `tsc --noEmit`: clean. `npm run build`: ok. `route-ownership-check.mjs` and `--manifest`: clean.

## T007 evidence (G10-T15-6, 2026-11-23)

`mock-tests`, `writing` and `writing-new` move to `(authed-admin)/(mock-tests)`, `(writing)`, `(writing-new)`; each child layout emits its page sheets as plain `<link rel="stylesheet">` in the old order (`mock-tests`: `admin-mock-tests-next`, `admin-exam-ops-next`; `writing`: `admin-writing-hub-next`; `writing-new`: `admin-writing-new-next`) and keeps `export const instant = false;`. The 7 other writing groups (`writing-assignments`, `writing-cohorts`, `writing-instructor-queue`, `writing-prompts`, `writing-queue`, `writing-regrade`, `writing-status`) stay separate (coordinator, option a): their layouts carry only `admin-surface` and `admin-components`, so the parent would add `admin-buttons` and `admin-status` (FR-001). T007 is therefore one PR, not two. Stacked on T006 (#2594); base for the comparison is staging `cc6dd4c8`.

- `verify-admin-route-group-flow.mjs`, extended to 25 pages: head **3089/3089**; base `cc6dd4c8` 2495/3089, all 594 failures are "base sheets duplicated" after client navigation between groups that do not yet share the parent.
- Screenshots 1280×800, head vs base:
  - Direct loads of all 25 pages: 0 px, except `/admin/writing/new` (4,480 px) and `/admin/error-logs` (2 px). On `/admin/writing/new` the difference is sub-pixel anti-aliasing inside the sticky "Submission review" aside; a separate probe on both builds measured identical stylesheet lists and identical boxes (`.awn-review` y 349.17 h 439.11, `h2` y 401.28, `dl` y 445.28 h 223.44), so no layout or cascade change. The same 4,480 px shows on both client navigations into that page.
  - Client navigation `/admin/feedback →` `/admin/mock-tests`, `/admin/writing`: 0 px.
  - `/admin/mock-exams → /admin/mock-tests`: 212,640 px, all inside the page body. The base frame shows the fixture's "contract" error state, the head frame is still "Đang tải đề thi…" at the 300 ms settle; the direct load of `/admin/mock-tests` is 0 px, so this is data-load timing, not styling.
  - `/admin/mock-exams → /admin/mock-live` (9,933 px, sidebar hover, T006), `/admin/feedback → /admin` (25,822 px, base wrong, T002), and the 8–28 px frame-timing boxes are unchanged from earlier waves.
- Frontend contract suite: 14,082 tests, 14,081 pass, 1 fail (env-only `hook pre-push`). `npm run test:react`: 131 files / 1,337 tests pass. `tsc --noEmit`: clean. `npm run build`: ok. `route-ownership-check.mjs` and `--manifest`: clean.
