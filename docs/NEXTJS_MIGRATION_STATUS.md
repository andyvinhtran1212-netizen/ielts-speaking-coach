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

Operational checkpoint **2026-08-18**: all core coexistence three-phase drills
are complete and trusted Staging E2E run `32136607306` passed the live suite,
all frozen failure matrices and exact frontend/backend staging provenance at
`37e9b882b192a5abb068e01abd98feeb39c8f9f2`. Gate E remains open because the
clean streak is **1/20** and real-device Safari 15.6/iOS 15.8.5 evidence is
still missing. Gate F retirement/permanent redirects must not start from this
checkpoint alone.
