# Gate F redirect-soak preflight — 2026-09-01

**Decision:** code candidate prepared; Legacy deletion remains **NO-GO** until
the redirect release is deployed, verified and finishes its own soak window.
All 129 HTML artifacts remain in `frontend/public` as a deployment rollback
target during this phase.

## Authoritative boundaries

- Retirement telemetry coverage started at `2026-08-17T00:15:22Z`.
- The five core players admit fresh work to Next on current production code.
- The production core-admission deployment for commit
  `0528bee123e0cd36d8005d0038d23876c66a69fa` completed at
  `2026-08-24T16:56:27Z` (GitHub deployment `6067358966`). This timestamp is
  the exact `cutover_at` used for the stateful drain boundary.
- Gate E remains independent and is not declared PASS by this preflight. Its
  live versioned artifact ledger remains the source of truth for the 20-run
  streak.

## Production read-only evidence

Observed at `2026-09-01T16:01:35Z` against the production database:

| Stateful surface | Live Legacy blocker | Live unclaimed blocker | Missing expiry/lease |
|---|---:|---:|---:|
| Speaking | 0 | 0 | 0 |
| Reading exam | 0 | 0 | 0 |
| Listening test | 0 | 0 | 0 |
| Listening dictation | 0 | 0 | 0 |
| Writing assignment | 0 | 0 | 0 |

Therefore the exact stateful blocker total is zero. Existing historical or
expired audit rows were not modified, abandoned or deleted to obtain this
result.

The dedicated `legacy_retirement_page_view` namespace recorded 1,175 direct
Legacy HTML renders across 27 paths since coverage began, including 280 after
the core-admission deployment. The highest-volume paths were
`/pages/practice.html`, `/pages/result.html`, `/pages/speaking.html`,
`/pages/my-class.html` and `/pages/home.html`.

This is not evidence that those Legacy renderers should remain canonical:
canonical inbound checks are green and the stateful drain is zero. It proves
that old bookmarks, copied URLs and historical entry points still reach the
files, so file deletion without redirects would break real navigation.

## Redirect-soak contract

1. Install the hash-pinned generated redirect manifest before static file
   serving. Every one of the 129 HTML source paths must resolve to an existing
   App Router owner; dynamic detail routes must preserve their required query
   identity or fail safely to the nearest index.
2. Use temporary 307 redirects during soak and keep all HTML files on disk.
   This makes rollback a deployment/config rollback without leaving clients
   pinned to a browser-cached 308. Permanent 308 redirects are a later,
   separately reviewed release after Gate E and redirect soak close.
3. Verify the compiled route manifest and representative public, authenticated,
   admin and dynamic redirects on Preview/staging before production promotion.
4. Record the exact production redirect deployment timestamp. Only events and
   health evidence after that timestamp belong to the redirect-soak window.
5. During redirect soak, direct HTML requests must redirect before the Legacy
   beacon can execute. Any new `legacy_retirement_page_view` after the deploy
   is a fail-closed routing regression and blocks deletion.
6. Gate E continues in parallel. A Gate E persistence, resume, audio, timer,
   submit, grading or reconciliation failure blocks deletion and may require
   reverting the redirect release even when redirect checks themselves pass.
7. Deleting HTML/JS/CSS remains a separate reviewed batch after redirect soak,
   replacement-test disposition, asset reachability and health invariants are
   all complete.

## Static candidate evidence

The redirect candidate produces:

- 129/129 Legacy HTML source paths intercepted by 139 temporary soak rules;
- 129/129 paths with an App Router owner;
- 5/5 core players ready and admitting fresh work to Next;
- zero route-ownership collisions;
- `staticCutoverReady=true`;
- HTML artifacts still present for rollback.

Required local verification:

```bash
cd frontend
node --test tests/gate-f-retirement-redirects.test.mjs \
  tests/gate-f-canonical-inbound.test.mjs \
  tests/next-migration-status.test.mjs
node tooling/next-migration-status.mjs --assert-static-complete --json
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.legacy.json
npm run build
```
