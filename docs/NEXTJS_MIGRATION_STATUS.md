# Next.js migration status contract

The migration is not complete merely because a clean URL has an App Router
page. Evidence-based closure requires the full Gate D/E/F evidence in
`FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md`.

## Current checkpoint — 2026-09-10

- **Production serves Next.** PR #1352 merged as `b44efaa7`; wave 1 preserves
  all 139 permanent redirects through a versioned 129-URL manifest independent
  of physical HTML. Wave 2 preserves five historical HTML fixtures outside public.
- **Historical Gate E v20: PASS 20/20**, source `17159ba0`, final
  [run 34337714920](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34337714920).
  Its [original manifest](audits/GATE_E_V20_COMPLETED_MANIFEST_2026-09-09.json)
  and contract digest are retained. The authorized fixture changes produce
  **v21**, not a relabeling of that PASS. No new v21 live 20-run claim is made.
- **Staging synchronized to `b44efaa7`** and verified through normal Vercel
  CLI access with deployment protection retained. Post-merge checks:
  production 139/139 redirects; staging 26/26 representative/dynamic checks.
- **Gate F elimination remains open.** Source inspection holds all 290 JS/MJS/CSS
  assets: 177 have conservative Next reachability, five are additional archived
  test dependencies, and 108 retain other Legacy/test/build consumers.
  Source reachability is not a deletion certificate. All 129 public HTML files remain.
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

The next closure gap is not just deleting old CSS. Current status/page-view
counts cannot prove the required eligible-attempt success/fail/abandon report.
The [closure contract audit](audits/GATE_F_CLOSURE_CONTRACT_AUDIT_2026-09-10.md)
maps the exact source limitations, build-file holds and remaining sequence.

Product development is not frozen by this checkpoint. The original redirect
soak and hard-flip exception must be kept distinct from retirement approval;
elapsed time, current health and per-file replacement/test disposition still
need a truthful closure decision.

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

All Legacy artifacts remain on disk and their source inventory stays hash-pinned.
Static artifact deletion remains a separate retirement operation. Existing
Next destinations must remain available because browsers may cache 308
redirects even after the server configuration is reverted. The previous
production source is `415e19353b323e357564a0fe217e12021518026d`.

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

This static gate does not replace Preview/staging, persistence, failure-mode,
device, accessibility, performance, rollback, drain or soak evidence. Those
operational gates must also be closed before the migration can be called done.

Historical context: before the hard-flip decision, coexistence drills and the
Safari desktop/iOS real-device pair had passed. Earlier canaries exposed
Speaking initialization races and an automation-bypass self-redirect; those
issues were remediated before release `415e1935`. The latest pre-flip evidence
is the 7/20 v18 checkpoint recorded above. That historical observation window
used 307 redirects and did not complete; it is not the release state of this
308 configuration. The owner-approved v19 exception above governed that historical
hard-flip release; the current source contract is described at the top.
