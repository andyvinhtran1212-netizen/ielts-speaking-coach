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

Historical operational checkpoint **2026-09-07**: all core coexistence three-phase drills
are complete. Real-device Safari desktop and iOS Safari evidence is complete,
with pair verification PASS. Gate E canary `32232288966` then exposed a
Playwright-only response-body race in the Speaking launcher assertion, so the
corrected frozen manifest first moved to v9. Canary v9 `32243889759` then proved
the product routes rendered the correct `30bedcda…` release but exposed Vercel
Toolbar injection retrying its feedback script and preventing browser load
states from settling. The critical contract is now candidate suite v18. Gate F
temporary redirects remain active on public staging/production, while the four
deterministic Gate E matrices use a Vercel-blocked local-only fixture mode to
keep proving N/N-1 persistence against the frozen rollback renderers. Trusted
run `34117825403` correctly failed closed before v17 because it mixed the public
Gate F redirect contract with direct Legacy rendering, and because one live
Speaking fixture created an N-1 session without the `claim-v1` marker. No
earlier candidate can carry forward. Trusted v17 run `34128406384` matched the
frontend/backend staging release and passed all four failure matrices, but its
live suite exposed two independent races: the no-follow Gate F probe asked
Vercel to mint a bypass cookie and therefore observed Vercel's self-redirect,
while Speaking bound empty-topic validation only after the API global became
ready. Candidate v18 separates direct bypass headers from cookie minting and
binds validation before readiness while sharing the eventual API promise. The
first v18 run `34137813295` then matched frontend/backend release
`31921ebe…`, passed production release drift, staging provenance and all four
frozen failure matrices, but failed the live Speaking launcher because a Part 2
click made before API readiness was dropped and the session POST used Part 1.
The remediation binds the two practice Part selectors synchronously and leaves
only topic loading behind API readiness. The qualifying streak therefore
remains **0/20** until a clean run on the remediated release passes the full
suite and all four frozen failure matrices. Gate F temporary redirect soak is
active; permanent redirects and artifact deletion remain blocked on its own
health window and Gate E completion.
