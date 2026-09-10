# Gate F wave 4 — Pricing test/source decoupling

Source release: `9f5b2989d9d84c4e763d35215894910da4ec4053`.
Branch: `codex/gate-f-pricing-test-decoupling`.
Scope: test fixtures and invariant mapping only. **Physical retirement remains HOLD.**

## Root cause and severity

**Medium — migration/test coupling, not a production outage.**
`pricing-next-behavior.test.mjs` read `public/pricing.html` and `public/index.html`
at module initialization. Its native tests would fail before running if either
legacy artifact disappeared, despite the Next route being an independent server
redirect. `pricing-redesign.test.mjs` also loaded live aliases solely to characterize
dormant pre-launch design. Deleting those tests would lose real assertions;
keeping them coupled to public files indefinitely would block retirement.

## Minimal remediation and invariant mapping (ADR-005)

| Invariant | Before | After | Verification |
| --- | --- | --- | --- |
| No pricing launch without approval | Native source assertion plus HTTP verifier | Same, plus executing the actual page through installed Next redirect logic | Expected `NEXT_REDIRECT;replace;/;307;`; existing HTTP verifier retained |
| Native landing enters `/pricing` | One loop over native and public legacy landing | Native-only assertion in the native suite | Reads current native landing, not an archived replacement |
| Historical landing enters `/pricing` | Same mixed native/legacy loop | Assertion text retained but subject intentionally becomes a historical snapshot | Reads hash-pinned `index.html`; no longer a live public-file mutation guard |
| Historical page keeps redirect, monthly control and FAQ IDs | Native test read public Pricing HTML | Assertion text retained against archive; live entry protected by server redirect instead | Snapshot integrity plus independent redirect coverage below |
| Dormant pricing design, copy, CSS and interaction source | 119 characterization cases read public aliases | All assertions retained; reader changed to historical fixture | Existing suite remains in CI glob, no skip or deletion |
| Archive provenance and integrity | None | Three immutable snapshots with source SHA, source path, URL, byte length and SHA-256 | Loader validates fixed allowlist, regular files and bytes; corruption/unknown paths fail closed |
| Dedicated tests do not need public HTML/CSS | Not covered | Isolated temporary checkout contains only explicit test/native/fixture inputs, with installed dependencies shared | Both dedicated suites must run and pass without any `frontend/public` directory |

The new fixture directory is Node-test-only. There is no browser transport,
server route, rewrite, runtime import or public fallback. The archived homepage
is retained only to preserve its original landing-link assertion. This is not
a claim of rendered UI parity, and archived dormant content must not be exposed
as a future pricing launch without a separate product decision.

### Live boundary replacing the old public-file sentinel

`frontend/next.config.ts:34` constructs permanent rules from the explicit URL
manifest and `redirects()` installs them before public serving. The exact routes
are `/pricing.html` → `/pricing` (308), then native `/pricing` → `/` (307), and
`/index.html` → `/` (308). Removing a client sentinel from otherwise-unreachable
HTML cannot expose Pricing while those server/native guards hold.

`frontend/tests/gate-f-retirement-redirects.test.mjs` verifies the 139-rule golden
digest, executes the actual Next config without a public tree, and asserts
permanent interception of every legacy HTML URL. Production GET checks in this
wave verified both HTML URL redirects and the existing four-check native Pricing
HTTP flow. Archived assertions are historical characterization, deliberately not
equivalent coverage of mutable live HTML. The native launch invariant remains
covered independently. No behavior on a plain static development server is
claimed as deployed Next behavior.

The runtime-execution test intentionally pins the installed Next redirect digest;
an upgrade changing its representation requires review alongside the HTTP check.
Both Next and TypeScript are explicit `frontend/package.json` dependencies and
are already required by the existing compiled-config tests. Tailwind's base
config excludes `tests/**`, inherited by the Inter build; no fixture CSS is added
to production style generation.

## Remaining consumers — not silently retired

| Consumer | Why still relevant | Follow-up before physical removal |
| --- | --- | --- |
| `anti-flash-iife-canonical.test.mjs` | Explicit public Pricing entry in cross-page source roster | Preserve historical assertion separately and native theme invariant where applicable |
| `theme-toggle-icon-canonical.test.mjs` | Explicit public Pricing inline-chrome roster | Same; do not mistake dormant chrome for rendered native Pricing UI |
| `b8-frontend-polish.test.mjs` | Explicit public Pricing read for truthful manual-payment copy | Preserve copy characterization in archive; unrelated practice/result assertions remain active |
| `site-overview-coverage.test.mjs` | Docs/source existence and coverage denominator tied to legacy paths | Migrate denominator to canonical route ownership with equivalent dead-reference coverage |
| `fixtures/hex-budget.json` and broad CSS scans | Pricing CSS participates in historical design checks | Map per-file historical budget and shared live token invariants before removing source |
| `e2e/legacy_retirement_beacon.spec.js` | Pricing appears only in the pre-redirect historical branch | Validated non-blocker for current Pricing decoupling: installed server redirects return before the stub assertion; retain the active zero-renderable/zero-stub phase guard |
| Redirect/source inventory and generic public scans | URL identity is distinct from physical file presence | Keep permanent `/pricing.html` compatibility redirect; re-audit all generic consumers in the deletion diff |

This is a bounded list from source inspection, not an exhaustive deletion
certificate. There is no global consumer change, public deletion, legacy-test
retirement, admission change, frozen Gate E input change, DB access or new soak.

## Verification

- All three archived files match source bytes and SHA-256 exactly.
- Focused Pricing batch: 132/132 passed, zero skipped/failed, including isolated
  no-public checkout and real Next redirect execution.
- Frozen suite: v21 preflight passed unchanged.
- Static cutover: 129/129 legacy owners, all redirected, 5/5 Next admission,
  zero route-ownership collisions.
- Full frontend regression: 9,079/9,079 passed; application and legacy TypeScript
  passed. All 58 test declarations generating the 119 historical cases were
  compared against the base and remain byte-identical.
- Claude review found sound decoupling and required clarification of live
  coverage and reporting. Both are addressed above with concrete config/test
  and production evidence. Nested coverage now requires at least 125 cases and
  no TODO/skips, only a minimal environment is forwarded, same-length corruption
  is tested, and the verifier explicitly requires Buffers. Final full regression
  after these changes again passed 9,079/9,079 with zero fail/skip/TODO; frozen
  v21 and static cutover checks also passed. Claude's required coverage point
  was resolved by verifying the existing server boundary, not by claiming a
  historical snapshot still guards mutable public HTML.

Gate E v20 historical PASS and global Gate F retirement conditions are unchanged.
