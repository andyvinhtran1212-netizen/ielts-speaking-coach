# Gate F owner-exception closure — 2026-09-11

## Decision

The product owner directed the team to force-finish Gate F for the current web
scale and explicitly approved removal of all 129 Legacy HTML renderers. The
owner waived the remaining long soak, eligible-attempt sampling and manual
asset-by-asset deletion review. Waived evidence is not recorded as PASS.

Gate F is **CLOSED BY OWNER EXCEPTION** at the frontend renderer and route
ownership boundary.

## Changes

- Moved all 129 historical HTML files from `frontend/public/` to
  `frontend/tests/fixtures/legacy-html-retired/`.
- Kept the frozen 129-source URL compatibility manifest and all 139 permanent
  redirect rules. Each destination still resolves to an App Router owner.
- Removed the local environment escape hatch that could disable retirement
  redirects.
- Made `/admin/access-codes` a permanent canonical redirect to
  `/admin/users?tab=codes`.
- Replaced the old “no new HTML” freeze with a zero-HTML public-tree guard.
- Retained the historical HTML only as non-deployable test fixtures. The CI
  loader remaps missing public HTML reads to the archive so prior source-level
  regression contracts remain executable.
- Retained public JS/MJS/CSS. They include current Next dependencies and test or
  compatibility dependencies; deleting them is not required to retire page
  renderers.

## Minimum evidence retained

The exception does not waive structural correctness:

1. `find frontend/public -type f -name '*.html'` returns no files.
2. `node tooling/next-migration-status.mjs --assert-static-complete` reports
   129/129 replacement owners, 5/5 Next admissions, zero collisions and green
   static cutover.
3. The full frontend `node:test` contract suite passes using the archived-source
   loader.
4. `next build` completes and emits all current application routes.
5. CI blocks any future deployable HTML reintroduction.

## Accepted risk

- The remaining Gate F operational soak and per-asset manual validation are
  intentionally not completed.
- Rollback is now a code revert and redeploy; there is no in-place public HTML
  renderer fallback.
- Permanent redirect destinations must remain compatible because clients may
  cache HTTP 308 responses.
- Historical Gate E/Gate F records keep their original PASS, incomplete or
  waived status and must not be relabeled from this decision.

## Scope boundary

This closes the Vanilla HTML-to-Next.js frontend migration. It does not certify
unrelated historical data-quality findings, apply database migrations, or close
future feature-specific release validation.
