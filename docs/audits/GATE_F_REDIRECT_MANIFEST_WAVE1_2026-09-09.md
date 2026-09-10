# Gate F wave 1 — explicit redirect manifest

## Scope and status

Implemented locally on `codex/gate-f-redirect-manifest-2026-09-09`, based on
main `17159ba0eaa8a2e889f981ba49abfe43101d0601`. No commit, push, PR, deployment,
schedule changes or data writes were performed in this wave. No public HTML,
JS/CSS or Gate E test fixture was deleted or relocated.

The purpose is to remove a build dependency before separately reviewed
retirement: old URLs must keep working even after their HTML files are gone.
This change does not itself certify Gate F or authorize deletion.

## Root cause and focused fix

**Medium — retirement blocker, not an existing production outage.**
`next.config.ts` previously enumerated the public HTML tree to generate the
redirect manifest. Removing a file would fail the pinned 129-path check;
simply dropping that check could silently remove a bookmark's redirect.

- `frontend/tooling/gate-f-legacy-paths.mjs` now stores the immutable list of
  129 URL sources. It is a compatibility contract, not a generated file list
  to shrink during cleanup.
- `gate-f-retirement-redirects.mjs` retains the original count and SHA-256 guard
  and accepts the explicit manifest by default. Its old explicit-path API and
  filesystem discovery helper remain available for physical-fixture auditing.
- `next.config.ts` passes the explicit manifest instead of scanning `public`.
  All 139 redirect rules retain order, permanence, destinations and conditions.
- `next-migration-status.mjs` uses the URL manifest for redirects/replacement
  owners while independently reporting the actual physical HTML count. An
  empty public tree cannot erase the 129-route replacement denominator; a
  missing Next owner or unexpected HTML still blocks static readiness. This
  includes an unregistered HTML file claiming to be a client redirect stub.
- Both compiled-route and parity CI path filters cover manifest-only changes.

The test-only `GATE_E_LEGACY_FIXTURES=local-build-only` behavior is unchanged.
With `VERCEL=1`, it still cannot expose Legacy fixtures through public URLs.

## Verification

- Full frontend contract suite: **9,062 passed**, zero failures/skips/retries,
  using the same two file globs as CI. This includes four new tests.
- Next **16.3.4** local production build: passed, 136 generated entries;
  application route inventory remains 130 product pages plus two engineering
  pages. Build TypeScript and the separate legacy TypeScript check passed.
- Compiled route-ownership check: 134 compiled routes, zero collisions and
  no drift from the source ownership checker.
- Browser compatibility scan: 138 chunks, 148 static scripts and 230 inline
  scripts clean against the existing Safari/iOS 15 floor.
- Local HTTP check: **142/142 passed** — all 139 manifest cases plus class
  cohort-vs-student-tab priority and both partial grammar identities. Checks
  308, same-origin destination, query preservation and a synthetic session ID.
  No learner API mutation, login or external service call was performed.
- SHA-256 of `JSON.stringify(buildLegacyRetirementRedirects())` remains
  `75544da36a6d78745a719e5b6d81c5b1212657726b37be38daa844882a2f02c5`, captured from
  main before editing. This compares complete ordered rules, not only counts.
- Actual transpiled Next config executes with a nonexistent public-tree root
  and still returns all rules; deployed fixture mode remains disabled. A
  separate temporary inventory fixture checks empty HTML, missing destination
  and unexpected HTML. No repository files are removed by these tests.
- Gate E frozen-suite preflight: **OK, v20**. Its manifest, all frozen test
  inputs, package/lock files and the entire public tree are unchanged.
  The historical 20/20 release evidence is neither reset nor copied to this
  uncommitted candidate; no live evidence workflow was dispatched.
- `git diff --check`: passed. Temporary probes/logs are outside the repository.

## Review and boundaries

Self-review followed the project review skill: preserve auth/ownership and
canonical contracts, keep the patch narrowly scoped, and verify changed
layers. Next.js guidance and installed-version redirect documentation were
used to retain pre-filesystem 308 and query semantics.

Independent Claude review was requested with only the code diff and selected
tooling sources. Tools, MCP and session persistence were disabled; no secrets,
student data or environment files were included. The first review identified
the unregistered redirect-stub gap; it was reproduced and fixed with an explicit
manifest-membership blocker and regression assertions. Workflow coverage was
also strengthened to discover all explicit redirect-helper path filters rather
than maintaining a two-workflow list. Follow-up Claude review concluded
**“No blocking code findings.”** The full 9,062-test suite passed again after
these changes. This is an independent diff review, not a claim that Claude
executed the tests; all execution evidence above was collected locally.

Other review concerns were validated instead of patched speculatively: the
`path` import is required by `turbopack.root`, TypeScript is a direct dependency
with `allowJs`, CI uses Node 24, and the new manifest is not ignored. It remains
untracked only because no commit has been requested; it must be included in
the eventual commit. The test deliberately pins the existing redirect order.

**Operational caveat:** read-only GitHub checks found no classic main branch
protection (`Branch not protected`, HTTP 404), no effective main branch rules,
and no repository rulesets (both lists empty). Thus CI jobs are configured and
the existing physical-artifact equality assertion still runs in frontend
contracts, but GitHub does not enforce their success before a manual merge.
Do not call them protected/required checks. Enabling protection would be a
separate owner-approved repository configuration change; none was made here.

The initial local build caught a removed `path` import still needed by
Turbopack's root configuration; it was restored before the successful build.
The new VM test initially lacked TypeScript's interop setting; the harness
was corrected to match the config's default Node import behavior. Neither
issue was deployed, and no assertion was weakened to obtain a pass.

## Next wave — not implemented here

1. Inventory and relocate required historical renderer fixtures outside public
   deployment, preserving N/N-1 failure/recovery coverage and hash provenance.
2. Complete transitive/dynamic/build/test dependency disposition for JS/CSS.
3. Review operational Gate F evidence and obtain a bounded deletion decision.
4. Only then remove approved physical artifacts in a separate PR while keeping
   this permanent URL manifest. Several existing fixture audits still scan
   HTML intentionally; this wave does not claim they can already tolerate deletion.
