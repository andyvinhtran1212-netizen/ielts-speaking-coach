# Gate F — post-merge verification and asset audit (wave 3)

Date: 2026-09-10. Source: `b44efaa72fe61e4c22a0be704c8a62795691d0b9`.
Branch: `codex/gate-f-assets-audit-2026-09-10`.
Decision: **operational verification and asset inventory progressed; elimination remains NO-GO.**
No public file, test, database row or recording is deleted by this wave.

## Verified operational work

PR [1352](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1352)
merged at 2026-09-10T00:23:10Z after nine green checks and no inline comments.
Production frontend deployment `6361947018` was successful at 00:23:50Z;
Railway production deployment `6361940999` succeeded at 00:24:39Z.
The public runtime marker independently reported release `b44efaa7`, main,
production API and production Supabase project.

The owner then requested “proceed till all is done”. Staging had no divergent
commits and was fast-forwarded from `17159ba0` to the exact merged release.
No force push, manual 20-run dispatch, schedule change or data mutation occurred.

- Staging frontend deployment `6361998713`: success at 00:28:33Z,
  `https://ielts-speaking-coach-2br3rzdz4.vercel.app`.
- Staging backend deployment `6361993080`: success at 00:28:38Z.
- Normal Vercel CLI access verified the staging runtime marker: `b44efaa7`,
  gitRef staging, staging API and Supabase project. SSO remained enabled.
- Production and staging readiness returned status OK with 14 critical table
  projections. This does not certify all schema, RLS or database invariants.
- Production redirect GET probe: **139/139** passed (308, expected destination,
  dynamic identity and audit query preservation).
  The 129 source URLs expand to 139 rules because dynamic destinations include
  their fallback rules.
- Staging GET probe: **26/26** passed: public/admin entry points, five core
  surfaces, every dynamic rule and its fallback. No learner was logged in and
  no assignment or session was opened.
- Machine-readable evidence:
  [post-merge redirect report](GATE_F_POSTMERGE_REDIRECTS_2026-09-10.json).

Another task subsequently merged content-only PR #1353 (`cadd3ee5`), adding
`backend/data/course_pronunciation/C1-B10.json`. Its diff does not alter the
redirects or asset source audited here. These are point-in-time observations,
not a promise to freeze main or silently overwrite the other task's work.
Staging sync in this wave targets the migration release, not every later content commit.

## F2 — asset dependencies: verified finding, not “unused” guesses

**Severity: Medium — deletion/regression risk; no current outage identified.**

**Root cause:** Next route ownership does not imply that all scripts and styles
are native-bundled or dispensable. Shared public modules still implement course
players, authentication, design styles, dictionary loading and other behavior.
A literal filename search also misses computed modules, relative imports and
build-time symlink aliases.

**Impacted examples and exact source locations:**

- `frontend/components/vocab-module-mount.tsx:89` constructs the module URL;
  the `flashcards | exercises` type and callers constrain the actual product
  set, while the audit conservatively holds the entire four-file family.
- `frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx:1089`
  imports `/assets/vendor/nspell.bundle.js` dynamically. Searching only
  `/js/` or `/css/` would miss this real Writing dependency.
- `frontend/package.json:14` and `.github/workflows/backend-tests.yml:181`
  retain Tailwind input/output via `frontend/css -> public/css`. The collector
  verifies the immediate symlink target before using that alias; these are build consumers,
  not proof that a browser downloads the files.

**Minimal remediation:** do not delete by unmatched filename. Commit a
reproducible, read-only collector and a per-file hold/retention inventory.
The collector parses JS/TS literals without treating comments as runtime edges,
resolves relative public imports/CSS URLs for Next/public/listed-fixture sources,
follows transitive cycles safely,
holds wildcard families conservatively and separates Next, archived fixture,
public HTML and test/build evidence. It never grants deletion approval.

[Per-asset inventory](GATE_F_ASSET_INVENTORY_2026-09-10.json) covers all
**290 public JS/MJS/CSS files**:

| Disposition | Count | Meaning |
| --- | ---: | --- |
| Retain: conservative Next dependency | 177 | At least one direct, dynamic-family or transitive source chain |
| Retain: additional archived test dependency | 5 | Conservatively referenced by archived HTML and not in the Next set |
| Hold: other Legacy/test/build consumer review | 108 | Evidence exists, but lifecycle/replacement disposition remains open |
| Approved for deletion | 0 | No unmatched-file shortcut or blanket deletion |

The archived fixture closure contains 36 assets in total, 31 overlapping the
Next set. The five additional assets are `legacy-retirement-beacon.js`,
`listening-test-dictation.js`, `listening-test-player.js`, `reading-exam.js`
and `speaking-legacy-runtime.mjs`.

The checked-in report stores every asset hash, its retention chains, consumer
counts and one example per category. Run
`node frontend/tooling/gate-f-asset-inventory.mjs` for every detected edge.
Use `--summary` for the compact checked-in shape; the snapshot additionally
records sourceRelease, auditDate and evidenceFormat provenance. The collector
reports parse diagnostics, unverified build aliases, symlinks in recursive
scan roots and fixture HTML presence drift. Malformed manifest JSON/schema or
invalid scan roots may abort instead of yielding warnings. This run produced
no warnings; the dated-artifact test pins that result and verified aliases.
This is a conservative source inventory, not complete runtime execution proof:
computed concatenation, generated content, external packages and source-relative
URLs inside browser scripts still require semantic/network verification.
Next-root modules may themselves be unused; retaining them is safe, deleting
them based on this report is not. Historical HTML/test/build text may include
comments and is recorded only as hold evidence. A hold consumer may itself be
unreachable, and interpolated remote origins may over-retain local assets.
Relative test/build paths and bare HTML paths are not comprehensively resolved.
Only lowercase .js/.mjs/.css suffixes are inventoried; chained build aliases and
frontend-root symlinked source files need separate review. These limitations
must be addressed or explicitly audited for any future deletion candidate.

## F4 — stale status landing page

**Severity: Low — operational clarity.**

`docs/NEXTJS_MIGRATION_STATUS.md` still described the pre-flip v18 7/20
checkpoint as “latest”. The new current section links the byte-preserved v20
20/20 history, distinguishes v21, records the merged waves and staging check,
and explicitly leaves Gate F open. Historical exceptions remain labeled history.

## Verification and review

The first bounded consumer check also disproved a stale retirement suggestion:
`pricing-redesign.test.mjs` is not design-only; it protects the intentional
pre-launch redirect. Its Next replacement test still reads legacy pricing and
landing HTML. `TEST_INVARIANT_LEDGER.md` now holds this candidate and records the
specific replacement/assertion and dormant-content decisions required. This
is not a completed disposition of the other 107 held assets.
The existing GET-only Pricing verifier also passed **4/4** against production:
canonical 307 to the same-origin homepage, no unreleased pricing content, and
normal navigation arriving at `/` with HTTP 200.

- Five collector regression cases passed: comment exclusion, remote URLs,
  direct and transitive references, cycles, dynamic families, /assets vendor
  loading, archived original document URLs, verified build symlinks and
  no-deletion behavior, self-reference exclusion, JSX/TypeScript parsing,
  root/vendor asset URLs, dynamic-origin evidence, parse diagnostics,
  fixture/alias drift and dated-artifact internal consistency. A dated report
  does not freeze future product assets; exact reproduction is a release-time
  verification, not a permanent equality assertion against evolving source.
  After review fixes, full frontend regression passed **9,072/9,072** with
  zero failed/skipped tests. Both application and Legacy TypeScript passed.
  The compact report was regenerated and deep-equality checked against the
  current collector output (excluding the three declared provenance fields).
- Static cutover check: 129/129 owners, all 129 HTML server-redirected,
  5/5 Next admission, zero ownership collisions; operational gates stay separate.
- Existing v21 frozen-suite preflight passed; no frozen input was edited.
- Independent Claude review found no unsafe deletion or audit-only blocker,
  but identified self-contamination, parser diagnostics, root URL coverage,
  fixture drift and dynamic-origin classification defects. All five were fixed
  with regression coverage. Follow-up Claude source review confirmed all five
  fixes and **no blocking findings for this audit-only wave**. It identified
  the non-blocking robustness/coverage limits now stated above; it did not run
  tests or independently verify deployments/database results. No deletion
  decision may rely on this collector alone.
- No application runtime, backend source, schema or public asset changed.

Vercel CLI linking generated local configuration and an environment file.
Both were preserved outside the repository at `/tmp/aver-wave3-vercel.Aj5m10`;
no credentials enter this patch. Its added `.gitignore` protection is left as an
unstaged local change after the safety reviewer disallowed removing it.
That incidental change is not part of this audit PR.

### Fresh aggregate health evidence — bounded, not a clean-database verdict

The read-only production audit stopped with `SSLCertVerificationError` before
obtaining the drain, telemetry, persisted-result or error counts. TLS verification
was not disabled. No partial health verdict or learner data was printed and no
database mutation occurred. The ordinary configured Supabase HTTPS API then
succeeded with TLS verification enabled, using 31 HEAD `count=exact` requests
and no row bodies. These were sequential non-atomic observations from
2026-09-10T01:14:39.583243Z to 01:14:43.206010Z, not the failed PostgreSQL
repeatable-read transaction. Credential values never enter evidence.

[Aggregate health evidence](GATE_F_AGGREGATE_HEALTH_2026-09-10.json):

- Legacy live/unclaimed/missing-expiry blockers: zero across all five surfaces,
  using the canonical predicates in `backend/routers/error_logs.py` helpers.
- Retirement events since redirect and since hard flip: zero in each window,
  upper-bounded at the observation start. No new error/warning logs since flip.
- Reading: 586 submitted, zero missing score/submission time. Listening: 1,267
  submitted, zero missing score/submission time.
- Speaking: 3,958 completed; 22 missing band and one missing completion time
  (sets may overlap). These need individual lifecycle validation before any
  completeness verdict; do not synthesize grades or timestamps to clear them.
- 45 unresolved historical error logs remain; zero newly logged errors does
  not classify those historical records or prove no user-facing defect.

This does not certify all tables, RLS, eligible-attempt denominators or
persistence invariants, and must be refreshed at an actual retirement decision.

## Completion audit: what is still required

| Gate F requirement | Current evidence | Remaining action |
| --- | --- | --- |
| Redirects and replacement owners | 139 production probes, 26 staging probes; existing 129-owner checks | Retest exact bounded removal candidate before/after deployment |
| Fallback observation window or approved exception | Original successful redirect start 2026-09-01T17:07:37Z; hard flip waived a release hold, not deletion | Earliest 14-day boundary 2026-09-15T17:07:37Z (Sep 16 00:07:37 Vietnam), conditional on continuity; no automatic PASS |
| Zero data-invariant violation / no Sev1/2 regression | Fresh exact HEAD counts: zero legacy blockers/new retirement events/new error logs; Reading/Listening submitted fields complete | Validate 22 Speaking missing-band rows and one missing timestamp plus historical log classifications; refresh evidence at retirement; no-logs is not no-defect |
| Frozen core eligible success/fail/abandon denominator | Not newly certified in this wave | Reconcile the source denominator or an explicit accepted alternative; page views and Gate E synthetic counts are not substitutes |
| Compatibility deletion checklist and test capabilities | Per-file asset hold inventory and five archived HTML fixtures exist | Disposition the 108 other consumers; isolate remaining fixture-only assets and map retired tests under ADR-005 |
| Authorized deletion scope | None selected/approved here | Separate bounded allowlist and review; no directory-wide deletion |

No clock is restarted by this audit and no new recurring job is created.
Historical Gate E v20 PASS is retained; v21 is not claimed to have 20/20.
Normal product development can continue while remaining retirement gates are resolved.
