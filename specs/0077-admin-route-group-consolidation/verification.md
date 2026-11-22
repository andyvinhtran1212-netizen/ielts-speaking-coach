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
- **FR-005 is not met on either build:** with `cacheComponents: true` the App
  Router keeps the previous route mounted but hidden, so its stylesheets stay
  in the DOM after a client navigation. On the base the previous page leaves
  its whole shell (tokens, components, 4 admin base sheets and its page sheet);
  after the pilot it leaves only its page sheet. The client-navigation
  screenshot differs from the direct load by the same 9,972 pixels
  (`(12, 132, 1224, 727)`) on both builds. Q-d1 / the FR-005 wording is the
  owner's decision before T001 is ticked.
