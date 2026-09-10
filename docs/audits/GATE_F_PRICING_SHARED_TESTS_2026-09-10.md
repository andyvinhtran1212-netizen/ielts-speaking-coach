# Gate F wave 5 — shared Pricing test/source decoupling

Base: `405ac0afcc6d2f8faf9da018ed3dd6a395866763` (merged PR #1355).
Branch: `codex/gate-f-pricing-shared-tests`.
Scope: tests and invariant documentation only. **Physical retirement remains HOLD.**

## Finding

**Medium — test/source coupling, not a production defect.** Three shared suites
still loaded the public Pricing alias even though native `/pricing` redirects
to `/` and does not render pricing controls or theme chrome. Removing that
artifact would fail the shared suites before unrelated invariants could run.

## Minimal changes and verification mapping

| File / source-read location | Change | Preserved invariant / verification |
| --- | --- | --- |
| `anti-flash-iife-canonical.test.mjs`, page loop | Only the Pricing roster entry uses the existing hash-checked archive | Six Pricing bootstrap assertions become historical; all other HTML/doc reads and 179 total cases unchanged |
| `theme-toggle-icon-canonical.test.mjs`, page `before` hook | Only Pricing markup uses archive | Four Pricing icon assertions become historical; current landing, shared chrome JS and 13 page CSS reads remain; 26 cases unchanged |
| `b8-frontend-polish.test.mjs`, `pricingSrc` | Archive supplies historical manual-payment copy | Four cases unchanged; result and practice still read current sources |
| `gate-f-pricing-shared-sources.test.mjs` | New isolated execution and negative controls | Explicit non-Pricing source copies plus Pricing HTML archive only; no public directory or Pricing aliases; at least 209 passing cases, no fail/cancel/skip/TODO; temporary Home, landing and result mutations must fail a specific assertion in each corresponding suite |

The three original suites retain all test declarations byte-for-byte. Only
their Pricing source selection and explanatory comments/imports change. The
existing dedicated no-public checkout test is unchanged. The new isolation
test shares neither node_modules nor source symlinks; its child environment
excludes credentials, NODE_OPTIONS and inherited Node test-worker state. A
bounded timeout/output buffer and finally-cleanup apply only to its own freshly
created temporary directory. Test code deliberately writes a broken temporary
HTML copy per suite as a negative control, never changing a repository or deployed page.

## Coverage boundaries

Archived assertions deliberately stop guarding mutable public Pricing HTML.
The live invariant is still the independent permanent `/pricing.html` →
`/pricing` server rule plus native `/pricing` → `/` redirect, covered by the
compiled-config golden tests, native execution and HTTP verifier described in
[wave 4](GATE_F_PRICING_TEST_DECOUPLING_2026-09-10.md). No new theme UI or payment
promise is implied for native Pricing. The ledger corrects old descriptions that
overclaimed runtime click, ARIA, language and first-paint coverage from source
regex tests. No equivalent runtime behavior was removed: it was never exercised
by those assertions.

The negative controls validate one non-Pricing input per suite, not mutation
coverage of every page, JS or CSS read. Only the Pricing HTML fixture is copied;
an accidental archived landing or CSS read fails because those snapshots are
absent from the isolated tree. Explicit isolation inputs intentionally fail
closed if a suite later adds a dependency without updating the harness. This
proves Pricing independence, not independence from all other public-derived
sources, which are intentionally copied through their existing aliases.

## Verification

- Focused batch: 210/210 passed (209 existing cases plus isolation/negative control).
- Full frontend regression: 9,080/9,080 passed; zero fail, skip or TODO.
- Application and legacy TypeScript: passed.
- Frozen Gate E v21 preflight: unchanged and passed; no new 20-run claim.
- Static migration check: 129/129 legacy paths server-redirected with Next owners,
  zero directly renderable legacy HTML, 5/5 Next admission, zero ownership collisions.
- Independent Claude review: **APPROVE**, no blocking defects. Non-blocking
  hardening applied afterward: only the used archive file is copied, TAP totals
  are line-anchored and require at least 209 passes with zero cancelled cases,
  and all three suites receive a targeted non-Pricing negative control. The
  existing fixture source matches the public Pricing alias; future drift of the
  dormant live HTML is intentionally outside these historical assertions, not
  an accidental claim of live coverage. The two literal Pricing selectors stay
  local: the isolated no-Pricing-alias run fails if either reverts to live reads.

## Remaining work / exclusions

This closes the three explicit shared Pricing reads listed as follow-ups in
wave 4. It does not resolve `site-overview-coverage.test.mjs`, historical CSS
budgets, broad public-source scans or the physical-file inventory guards. Those
need per-invariant mapping and a fresh candidate-specific dependent audit before
any public artifact removal. The wave 4 legacy-beacon mention remains a verified
inactive historical branch, not a newly discovered blocker.

No production code, public asset, Gate E frozen input, database, deployment or
admission setting changes. Gate E historical v20 PASS and global Gate F
retirement conditions are unchanged; this is not a migration-complete claim.
