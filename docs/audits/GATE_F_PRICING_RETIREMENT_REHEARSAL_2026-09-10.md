# Gate F wave 7 — redirect test consumers and Pricing removal rehearsal

Base: `4b976c87ecfee72d089d7dab5f1e96746a666253` (PR #1358).
Scope: eight test files and invariant documentation. No runtime changes,
physical retirement, deployment, data repair or new Gate E streak.

## Validated findings

**Medium — unrelated suites abort on a missing Pricing file.** Six consumers
still passed `discoverLegacyHtmlPaths(public)` to
`buildLegacyRetirementRedirects`, although production `next.config.ts` already
uses `LEGACY_RETIREMENT_PATHS`. The builder rejects 128 paths against its frozen
129-URL contract. A candidate-removal rehearsal therefore aborted admin,
landing and profile checks unrelated to Pricing. Affected test call sites:
`admin-overview-next-behavior`, `admin-users-next-behavior`,
`merge-codes-users-tabs`, `pilot-landing`, `pilot-profile`, and
`profile-nn1-contract` (`.test.mjs`). Minimal fix: change only their builder
inputs/imports to the durable manifest. Preserve all assertions, temporary-mode
fixtures and each domain's own legacy-source checks.

**Medium — physical freeze prevents redirect tests from registering.**
`gate-f-retirement-redirects.test.mjs` built rules from physical discovery at
module initialization. Minimal fix: build from the manifest and enforce the
unchanged physical-set equality in a separate test callback. The 129-path
count/hash, swapped/missing-path rejection and 139-rule golden hash remain.
Unauthorized removal still fails CI, but does not hide the route assertions.

**Medium — status test conflates two denominators.** The repository-report
case in `next-migration-status.test.mjs` equated replacement coverage with the
number of remaining physical HTML files. The collector correctly retains all
historical redirect identities after physical retirement. Assert full manifest
count AND exact replacement path identities; keep physical accounting, owner,
collision and unexpected-HTML guards. The empty-public fixture now also checks
a one-file partial public tree with all 129 identities preserved, then removes
a real copied App Router owner and requires exactly 128 present owners and a
blocked-deletion entry. Existing unregistered-HTML negative cases remain.

## Invariant disposition

| Obligation | Disposition / verification |
| --- | --- |
| Admin, landing and profile alias destinations | Same assertions against the production manifest source; unrelated domain checks retained |
| Full historical redirect and replacement identities | Retain count/hash, exact path equality, real config evaluation and native-owner checks, independent of remaining physical files |
| No unapproved physical deletion | Retain exact physical inventory equality as its own failing test; no allowlist/count/hash relaxation |
| CSS colour ratchet | No code change. Removing `pricing.css` must remove its budget row in that same separately approved deletion diff; the current row stays while CSS exists |
| Pricing stylesheet-link and theme-parent/depth scans | Keep now. Eventual retirement would omit six generated cases (three obligations scanned through both compatibility alias and public path). They concern the historical HTML UI, not the redirect-only native owner. Explicit retirement/replacement disposition remains required before actual deletion; other pages' checks must stay |

No suite, assertion or public file is removed by this wave. The ledger's three
old scanner descriptions are corrected to their actual contracts, not used as
approval to remove them. The CSS budget error is an intentional guard, not a
false positive to bypass.

## Rehearsal method and results

Use a disposable `git archive` of the base above, overlay only the eight test
files in this diff, and initialize an independent local Git index. The index is
required by an existing tracked-tooling assertion; do not point it at the real
checkout's `.git`. Share installed Node dependencies only. Run sorted
`frontend/tests/*.test.mjs` and `*.test.js` with Node 24 and a minimal environment
(no credentials or `.env` copies), saving TAP output. Require the baseline to
pass before removing exactly these entries **inside that new temporary copy**:

- `frontend/pricing.html` (compatibility symlink)
- `frontend/public/pricing.html`
- `frontend/public/css/pricing.css`

The `frontend/css` directory alias resolves inside the disposable copy. Run the
same test command again, compare named cases, and clean up only that copy.

| Run | Tests | Pass | Fail | Skip |
| --- | ---: | ---: | ---: | ---: |
| Before patch, source-only baseline | 9,037 | 9,034 | 0 | 3 |
| Before patch, without Pricing | 8,986 | 8,975 | 8 | 3 |
| After patch, source-only baseline | 9,038 | 9,035 | 0 | 3 |
| After patch, without Pricing | 9,032 | 9,027 | 2 | 3 |

The final two failures are exactly the physical freeze and stale CSS budget.
All other registered cases pass. Comparing subtest-name multisets attributes
the six omitted cases exactly to Pricing stylesheet hrefs (two) and theme
toggle flex-parent/depth checks (four); both root alias and public path are
scanned. The old 51-case drop also included suites aborted before registration,
so it was not evidence of 51 intentionally retired checks.

All runs have zero cancellation/TODO. The three source-only skips are two
Python-resolver integration cases without the local venv and one compiled
manifest case without `.next`; they are not claimed as executed passes. The
real checkout includes generated HTML/venv, so its total differs: **9,090/9,090
passed**, zero fail/cancel/skip/TODO. Focused eight-file batch: **86/86 passed**.
Frozen Gate E v21 preflight passed unchanged; static inventory remains 130
product pages, 129 redirect/replacement identities, 5/5 Next admission and zero
ownership collisions. This is not fresh production or full-stack E2E evidence.

Final rehearsal TAP SHA-256 receipts (local temporary logs, not durable CI
artifacts; timing-dependent hashes identify these runs rather than future
reproductions): baseline
`94e28e3f3d86502a1350c94cffd1a69e9be8b6d0e102e73785e4613bd6381a86`;
without Pricing
`07657c4c80fbb38e8c232ecb5f811142d25a45abb4c14b848bed28525a1e97aa`.

## Independent review and validation

Claude's diff-only verdict was **Approve with changes**, with two verification
concerns. They were evaluated against local source rather than accepted blindly:

- F1 proposed a second physical-count assertion in the status test. Not adopted:
  physical deletion is deliberately blocked by the exact-set test (confirmed
  by the removal rehearsal), while status models durable compatibility after
  retirement. Deleting/skipping that guard would itself be an additional code
  change requiring review. Breaking unrelated suites is not extra protection
  against such a change. No removal/skip of the guard is included here.
- F2 correctly distinguishes a manifest shape pin from independent operational
  evidence. Exact identity equality is a regression pin, not a deployment
  certificate. Owner presence is independently derived from App Router files.
  The partial-tree and missing-owner fixture assertions above reinforce that
  boundary, including the per-entry deletion block after removing `/home`.
- F3/F4 were false positives: path/join imports remain used by source readers;
  all eight suites execute successfully; the central suite imports
  `node:assert/strict`, whose `deepEqual` is strict. No permissive comparison or
  dangling discovery call was introduced.
- F5: the numbered section is already explicitly historical and not deletion
  approval. Its introduction now explicitly identifies both withdrawn entries.
- Ledger CI marks mean included in the existing test glob, not fresh full-stack
  certification. The actual scanner/budget bodies were locally inspected;
  their names and exact responsibilities are mapped above. Claude did not
  receive unchanged source files outside the authorized diff.

Application and legacy TypeScript also passed. The physical freeze and
per-invariant retirement disposition remain open, as do the broader
Gate F operational/dependency conditions in the wave 3 asset audit. This wave
does not authorize deleting Pricing or claim migration complete.
