# Next.js migration status contract

The migration is not complete merely because a clean URL has an App Router
page. Evidence-based closure requires the full Gate D/E/F evidence in
`FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md`.

## Owner-authorized hard flip — 2026-09-09

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

Latest recorded evidence for source release
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
- a canonical App Router replacement and domain owner for every directly
  renderable HTML path;
- route-ownership collisions;
- Next readiness and live new-session admission for every core player.

`--assert-static-complete` is the final code-cutover gate. It intentionally
fails while any legacy HTML is directly renderable, any HTML lacks an App
Router replacement, any core Next player is not ready, any core surface still
admits new sessions to legacy, or any route ownership collision exists.

Current frozen replacement denominator: 129/129. Every frozen Legacy HTML
path has a behavior-equivalent App Router owner, so
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
308 configuration. The owner-approved v19 exception above governs this release.
