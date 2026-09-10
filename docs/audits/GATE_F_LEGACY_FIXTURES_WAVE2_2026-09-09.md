# Gate F — Legacy HTML test fixture archive, wave 2

Date: 2026-09-09
Branch: `codex/gate-f-redirect-manifest-2026-09-09`
Source release: `17159ba0eaa8a2e889f981ba49abfe43101d0601`
Status: local implementation and verification complete; independent review found no blocking code findings.

## Authorization and scope

User explicitly approved changes to the four locked Gate E Playwright configurations,
five harnesses and their version/hash inventory. No test spec, assertion, retry policy,
project matrix, expected count, allowed skip, pass threshold or live-staging test changed.

This wave does not authorize commit/push, workflow dispatch, deployment, database writes,
scheduling, public HTML deletion or shared JS/CSS deletion. Wave 1 changes in this worktree
remain intact; its earlier v20 validation is historical, not a claim that wave 2 leaves v20 untouched.

## Root cause and minimal fix

**Medium — test transport depended on public rollback HTML.** The four configurations set
`GATE_E_LEGACY_FIXTURES=local-build-only`, suppressing retirement redirects during local builds.
That couples future public-file retirement to the failure matrices' Legacy arms.

- Archive exactly five HTML documents from the source release under
  `frontend/tests/fixtures/gate-e-legacy/html/`: Speaking practice, Reading exam,
  Listening test, Listening dictation and Writing dashboard.
- Preserve all 214,821 bytes, verified against the source public files. The archive manifest
  records release, URL, byte count and SHA-256 for each document.
- A test-runner-only CommonJS loader installs Playwright navigation routes for exact
  allowlisted localhost origins and selected old URL paths. It validates bytes before
  registering any route, rejects unknown fixtures and non-navigation/non-GET access,
  and fulfills with an identifying checksum header and no-store.
- Five harnesses install the appropriate archive route. Four configurations retain their
  ports/build commands and no-reuse policy but no longer enable the server escape hatch.
- Native App Router pages still come from a real Next production build. Browser URL,
  query identity, local storage origin and existing fake canonical API state are retained.

**Boundary:** this is an HTML-only snapshot, not an immutable archive of the entire Legacy
renderer. Shared JS/CSS still comes from the current local public tree. The guarded Next
escape hatch remains unchanged and unused by these four configurations. All 129 public HTML
documents and public JS/CSS are retained; future asset retirement needs its own dependent audit.

## Historical evidence versus the new source contract

The byte-exact original v20 manifest is preserved at
[GATE_E_V20_COMPLETED_MANIFEST_2026-09-09.json](GATE_E_V20_COMPLETED_MANIFEST_2026-09-09.json).

- v20 raw file SHA-256: `70b5118404ca87dd65abae85ff4846d292413cf4029f5b78e454750470e1198e`.
- v20 contract digest (`JSON.stringify(parsedManifest)`):
  `0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a`.
- Historical v20 20/20 completion: [final run 34337714920](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34337714920),
  source release above, completed 2026-09-09T10:07:03Z. This wave does not rewrite its ledger.
- Current source contract is `gate-e-critical-suite-v21`, digest
  `439c005abd73633eba28466f5a6659d282e1fc3b94dd79647906690cc480a931`.
- v21 updates only the version, nine authorized frozen file hashes, adds the archive
  directory and eight files (five HTML, loader, archive manifest and unit test); 55 frozen
  files total. Original frozen file ordering and every acceptance criterion are preserved.
- No live v21 streak has been executed or claimed. If future scheduled/approved evidence runs
  consume v21, the existing manifest-change rule separates its streak from v20.
  Historical PASS does not automatically become a v21 PASS. No schedule was changed.

## Verification

| Check | Result |
| --- | --- |
| Full frontend regression | 9,067 / 9,067 passed; no skipped tests |
| Speaking failure matrix, existing CI affinity flag enabled | 49 / 49 |
| Reading failure matrix | 12 / 12 |
| Listening and Dictation failure matrix | 36 / 36 |
| Writing failure matrix | 12 / 12 |
| Existing four failure-report validators | Passed; all 109 tests, no retries/flaky/skips |
| Frozen file and directory checks | Passed; v21 preflight OK |
| Acceptance criteria deep comparison with v20 | Identical except version/frozen inventory |
| Next production builds and application TypeScript | Passed via all four suite builds |
| Legacy TypeScript | Passed |
| Compiled route ownership | 134 routes; zero collisions or source/compiled drift |
| Legacy browser floor | 138 chunks + 148 static scripts + 230 inline scripts; Safari/iOS 15 clean |
| Public frontend/backend/live test source diff | Empty |
| Patch whitespace check | Passed |

A separate local Chromium transport probe verified all five old URLs:
unintercepted server requests returned 308; harness navigation returned 200 with the exact
archived response bytes and SHA-256 header; query strings remained identical.
Both candidate public archive paths returned 404. No Next application/server import of
the archive loader was found.

The first local Speaking invocation omitted the existing CI
`GATE_E_REQUIRE_AFFINITY=true` flag and failed three cross-version expectations (46 passed).
Repeating with the flag already used by both CI workflows passed all 49, without changing
assertions. This local invocation error is not new live Gate E evidence.
The first regression runs correctly detected unupdated frozen hashes and then a manifest-order
assumption; the final inventory preserves the original order and all 9,067 tests pass.

Local generated reports were preserved outside the source tree, not deleted:
`/tmp/aver-gate-f-wave2-reports.zY4nfA/test-results`.
HTML reports remain in this worktree's ignored `frontend/playwright-report/`.
Final regression log: `/tmp/aver-gate-f-wave2-regression.odN6d3`.
Temporary verification scripts/review prompts are not part of the patch.

## Independent review

Claude first-pass concerns were checked against current code and actual browser evidence:

- Potential silent fallback / route shadowing: exact-origin browser proof passed for all five;
  existing Legacy-only DOM/runtime assertions remain. Later mock handlers target separate
  API/CDN/production origins, not local HTML. No current shadowing path was found.
- Potential CSP/cookie header difference: current Next headers contain asset cache rules,
  not HTML CSP or authentication cookies; no Next middleware/proxy file exists.
  This archive test does not claim to audit production response security headers.
- Claim that public HTML was removed: false; all public files remain.
- Low-priority defensive/manifest ordering suggestions were not treated as verified defects.

Claude follow-up verdict: **No blocking code findings.** It retracted the public-deletion
claim and closed the three main concerns after reviewing the additional code and evidence.

Non-blocking coverage boundaries remain explicit: Writing shares some native/Legacy
locators, so its DOM checks alone are not proof of transport (the separate five-URL
byte/header probe supplies that proof for this wave). Snapshot/public equality is verified
at archival time, not required forever: future public changes must not silently rewrite
the pinned snapshot. Legacy server delivery details such as compression and ETag/304 are
not exercised by browser-fulfilled HTML; production URL redirects are checked separately.

## Remaining work

1. Obtain commit/push/PR authorization and complete normal CI/review before merging.
2. Audit/transplant shared Legacy JS/CSS dependencies as a separate wave before deleting
   any public artifacts. Do not infer deletion safety from this HTML-only archive.
3. Keep Gate F retirement/soak evidence separate from local fixture verification and from
   the historical Gate E v20 20/20 result.
