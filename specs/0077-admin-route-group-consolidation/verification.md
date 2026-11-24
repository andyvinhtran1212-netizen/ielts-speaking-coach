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
