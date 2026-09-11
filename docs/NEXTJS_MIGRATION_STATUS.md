# Next.js migration status contract

The frontend migration is complete under the owner-approved Gate F exception
recorded below. Historical evidence remains preserved with its original status;
the exception closes the remaining hold without relabeling waived soak as PASS.

## Current checkpoint — 2026-09-11

- **Gate F: CLOSED by owner exception.** All 129 deployable HTML renderers were
  removed from `frontend/public/` and archived under
  `frontend/tests/fixtures/legacy-html-retired/` for source-contract tests only.
  `frontend/public/` now contains zero HTML files.
- **URL compatibility remains intact.** The frozen 129-URL manifest still emits
  all 139 permanent redirects to verified App Router owners. The clean
  `/admin/access-codes` alias is permanent now that no HTML rollback renderer exists.
- **Static closeout is green.** The repository reports 129/129 Next owners,
  5/5 core players ready and admitted to Next, zero route collisions and
  `staticCutoverReady: true`. The complete frontend `node:test` suite and a
  production `next build` pass after retirement.
- **Historical HTML is test data, not deployable fallback.** CI preloads a
  narrow filesystem adapter that redirects only missing `public/*.html` reads
  to the archive. A separate retirement guard scans the actual `public/` tree
  and fails if any HTML or symlink returns. Run source-contract tests locally
  through `cd frontend && node tooling/run-contract-tests.mjs` so the same
  adapter is loaded.
- **JS/MJS/CSS are retained.** These files remain shared Next runtime, archived
  fixture or compatibility dependencies. Their presence does not constitute a
  legacy page renderer and is not a Gate F blocker.
- **Rollout cron is retired.** The four-times-daily staging Gate E schedule and
  the high-frequency G2 authenticated probe remain retired after closure.
  The live suite now runs once for each merged `staging` release (and remains
  manually dispatchable), making staging an exact-SHA production promotion
  gate. PR regression gates and the lightweight daily production release-drift
  monitor remain active.
- **Releases are staging-first.** Normal work starts from and targets `staging`.
  Production accepts only a `staging` → `main` promotion PR after exact-SHA
  integrated CI and live Staging E2E pass. See
  [the release runbook](STAGING_FIRST_RELEASE_FLOW.md).
- **First-party workflow actions use Node 24 runtimes.** Legacy Node 20 majors
  were removed from active and manually dispatchable workflows, with a source
  contract preventing their accidental reintroduction.
- **Historical Gate E v20: PASS 20/20**, source `17159ba0`, final
  [run 34337714920](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34337714920).
  Its [original manifest](audits/GATE_E_V20_COMPLETED_MANIFEST_2026-09-09.json)
  and contract digest are retained. The authorized fixture changes produce
  **v21**, not a relabeling of that PASS. No new v21 live 20-run claim is made.
- The prior staging/production checkpoint at `b44efaa7` verified production
  139/139 redirects and staging 26/26 representative/dynamic checks. Deployment
  provenance for the retirement release is verified by the release PR/CI.
- Fresh production aggregate counts show zero legacy session blockers and no
  retirement events/new error logs since hard flip. Speaking still has 22
  completed rows missing band and one missing completion time (possible overlap);
  these were initially unclassified; the follow-up below records their bounded
  classification, not a clean persistence verdict.
- Detailed evidence, exact boundaries and remaining tasks:
  [wave 3 audit](audits/GATE_F_ASSET_AUDIT_2026-09-10.md) and
  [per-asset inventory](audits/GATE_F_ASSET_INVENTORY_2026-09-10.json).

### Follow-up — source checkpoint after PR #1359

Main source `91f3b2c9` includes Pricing fixture isolation, the native site-map
sentinel and manifest-based redirect test consumers (PRs #1355, #1356, #1358,
#1359). The independent physical freeze is still enforced. Pricing removal
was tested only in a disposable copy; no real public artifact was removed.
This is a source checkpoint, not a fresh deployment claim for that SHA.

Read-only production follow-up at 2026-09-10T03:27:35Z–03:27:47Z again found
zero legacy session blockers, retirement events and new error/warning logs
since the recorded hard flip. These are sequential, non-atomic observations,
not a full health certificate. The 23 distinct Speaking rows missing band or
completion time all started in April: 11 have no response rows, 11 have some
score input and need aggregate validation, and one has responses without score
inputs. That classifies the earlier findings; it does not establish their cause,
authorize repair, or prove all old data clean. No learner content or identifiers
were included in the audit output. The 45 historical unresolved logs remain.

The owner explicitly waived further eligible-attempt soak and per-asset manual
deletion review for this product scale. That missing evidence remains labeled
as waived rather than passed. The [Gate F closure record](audits/GATE_F_OWNER_EXCEPTION_CLOSURE_2026-09-11.md)
defines the accepted risk and retained safeguards. Product development is not frozen.

## Historical owner-authorized hard flip — 2026-09-09

The owner explicitly requested a hard flip after reviewing the incomplete
Gate E streak and Gate F soak. This release changes the 129 frozen Legacy HTML
sources from temporary 307 to permanent 308 redirects to their existing Next
owners. This is an accepted-risk release exception, not a claim that Gate E
or Gate F passed. CI and runtime redirect verification still apply.

Deployment scope is staging and production. The owner also explicitly approved
updating the frozen suite: v19 expects the permanent 308 grammar-alias redirect.
All test counts, failure matrices and thresholds are unchanged. Historical v18
results do not carry into v19. Scheduled regression checks continue; the
remaining soak is waived as a release hold, not fabricated as passed evidence.

Last pre-flip evidence for source release
`415e19353b323e357564a0fe217e12021518026d`: scheduled run `34287527314`,
Gate E v18 **7/20**, 33 passed, 1 expected skip, zero unexpected/flaky tests.
The remaining consecutive-run requirement and the redirect-soak wait until
`2026-09-15T17:07:36Z` are waived for this flip. Do not copy that streak to the
new release or record waived requirements as passing evidence.

At the time of this historical exception all Legacy artifacts remained on disk.
The 2026-09-11 Gate F closure supersedes that rollback arrangement: renderers
are now archived outside `public/`, and rollback requires reverting and
redeploying code. Existing Next destinations must remain stable because browsers
may cache 308 redirects. The previous production source for this historical
checkpoint was `415e19353b323e357564a0fe217e12021518026d`.

This exception supersedes the historical checkpoint's release hold:
normal development may resume after this release is deployed and verified;
historical soak evidence remains incomplete and must stay labeled as such.

The repository-side denominator is generated from canonical code sources:

```bash
cd frontend
node tooling/next-migration-status.mjs
node tooling/next-migration-status.mjs --json
```

The report counts:

- product `app/**/page.tsx` routes, excluding the two named engineering spikes;
- every `public/**/*.html` artifact, split into compatibility redirects and
  HTML paths still directly rendered by production;
- a canonical App Router replacement and domain owner for every frozen
  historical URL identity, even after physical HTML retirement;
- route-ownership collisions;
- Next readiness and live new-session admission for every core player.

`--assert-static-complete` is the final code-cutover gate. It intentionally
fails while any legacy HTML is directly renderable, any HTML lacks an App
Router replacement, any core Next player is not ready, any core surface still
admits new sessions to legacy, or any route ownership collision exists.

Current frozen replacement denominator: 129/129. Every frozen Legacy HTML
path has a present App Router owner, so
`legacy-next-replacement-missing` must stay absent. This closes route ownership,
not operational cutover or legacy retirement.

This static gate does not fabricate Preview/staging, persistence, failure-mode,
device, accessibility, performance, rollback, drain or soak evidence. The
2026-09-11 owner exception explicitly accepts the remaining operational gap and
closes the migration without rewriting historical evidence as passed.

Historical context: before the hard-flip decision, coexistence drills and the
Safari desktop/iOS real-device pair had passed. Earlier canaries exposed
Speaking initialization races and an automation-bypass self-redirect; those
issues were remediated before release `415e1935`. The latest pre-flip evidence
is the 7/20 v18 checkpoint recorded above. That historical observation window
used 307 redirects and did not complete; it is not the release state of this
308 configuration. The owner-approved v19 exception above governed that historical
hard-flip release; the current source contract is described at the top.
