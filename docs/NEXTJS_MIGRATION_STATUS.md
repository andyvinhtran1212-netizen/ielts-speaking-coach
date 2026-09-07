# Next.js migration status contract

The migration is not complete merely because a clean URL has an App Router
page. Final closure still requires the full Gate D/E/F evidence in
`FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md`.

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

Current replacement denominator: 121/121. Every directly renderable legacy HTML
path now has a behavior-equivalent App Router owner, so
`legacy-next-replacement-missing` must stay absent. This closes route ownership,
not operational cutover or legacy retirement.

This static gate does not replace Preview/staging, persistence, failure-mode,
device, accessibility, performance, rollback, drain or soak evidence. Those
operational gates must also be closed before the migration can be called done.

Operational checkpoint **2026-09-07**: all core coexistence three-phase drills
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
qualifying streak remains **0/20** until the first v18 live staging run passes
the full suite and all four frozen failure matrices. Gate F temporary redirect
soak is active; permanent redirects and artifact deletion remain blocked on its
own health window and Gate E completion.
