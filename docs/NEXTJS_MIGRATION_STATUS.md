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

Operational checkpoint **2026-08-19**: all core coexistence three-phase drills
are complete. Real-device Safari desktop and iOS Safari evidence is complete,
with pair verification PASS. Gate E canary `32232288966` then exposed a
Playwright-only response-body race in the Speaking launcher assertion, so the
corrected frozen manifest first moved to v9. Canary v9 `32243889759` then proved
the product routes rendered the correct `30bedcda…` release but exposed Vercel
Toolbar injection retrying its feedback script and preventing browser load
states from settling. The reconciled Reading/Listening UI and failure-path
contract is now critical-suite v13; v13 additionally routes every Listening
fresh-start through one headphone-prompt acknowledgement helper. Canary
`32727069070` validated the live
staging suite, Speaking, Writing and matching frontend/backend provenance at
staging SHA `38f05dfc5a27cdd54c12f7d5c878b82c8216a9e5`, then fail-closed on stale
Reading result selectors and the unacknowledged Listening audio prompt. No
earlier candidate can carry forward and the qualifying streak remains
**0/20**. The first v13 canary must pass all four frozen failure matrices before
the remaining streak can accrue.
Gate F observation began at `2026-08-17T00:15:22Z`, but retirement/permanent
redirects must not start before its operational and time-window criteria close.
