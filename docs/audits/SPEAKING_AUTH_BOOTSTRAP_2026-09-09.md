# Speaking auth bootstrap remediation — 2026-09-09

## Root cause and severity

**Medium, blocks Gate E.** `SpeakingBehavior::resolveRuntimeApi` waited only
for `window.api.get`. That global is exported when `api.js` executes, before
`SupabaseRuntimeBoundary` initializes the shared Supabase client in a subsequent
effect. `api.js::_getAuthToken` returns null while the client is absent, so
Speaking can send `/auth/me` or `/topics` without Authorization. Their 401
response triggers the API client's existing login redirect, even though a
valid learner session was already stored in the browser.

Impacted files/functions:

- `frontend/app/(authed-speaking)/speaking/speaking-behavior.tsx`:
  `resolveRuntimeApi`, shared by initialization and early valid actions.
- `frontend/components/supabase-runtime-boundary.tsx`: later client init effect.
- `frontend/public/js/api.js`: token lookup and canonical 401 redirect.

## Observed and reproduced evidence

Gate E run [34317212151](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34317212151)
failed `speaking-start-flow.spec.js:186` on release
`f82e25a9a00d46300b566f8075e3799375e9956c`: the missing-topic error appeared,
no session POST occurred, but the browser then navigated to `/login`.
The report has 32 passed, one allowed skip, one unexpected failure, zero flaky
tests and attempt 1. The canonical ledger reset from 8/20 to **0/20**.
This is not the earlier profile-load timeout.

Read-only diagnostic run
[34318449707](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34318449707)
on that deployed release compared four baseline loads and four loads delaying
`initSupabase` by 750 ms. It reproduced the same sequence in one baseline load
and all four delayed loads: `/auth/me` starts with `clientReady: false` and
`authorizationPresent: false`, receives 401, then the browser leaves Speaking.
The remaining three baseline loads started with an initialized client and
Authorization present and passed. Local validation appeared in all eight;
no session creation was attempted. All app writes were blocked. Only boolean
auth presence and sanitized timing/status metadata were logged; no token,
password, learner audio or browser trace was retained in the diagnostic output.

## Minimal fix

Wait for both the API methods and the shared client's `auth.getSession`
function before releasing Speaking's shared runtime promise. The readiness
predicate does not obtain/cache tokens or decide user authorization: the
existing API client still awaits `getSession` and the backend still validates
the request. No 401 suppression, extra client, automatic HTTP retry, timeout increase, test
omission, frozen-manifest change or schema change is introduced.

Synchronous mode/Part selection and missing-topic validation remain wired
immediately. Only actions requiring the API wait for initialized auth runtime.
After independent review, a timed-out readiness promise is cleared so a later
user action can try again; concurrent callers still share one pending attempt.

## Verification

- 27 focused Node tests passed, including delayed initialization, unavailable
  initialization timeout, no session reads from the readiness probe, actual
  component wiring and existing first-click/double-submit binding contracts.
  The actual component resolver is executed to verify shared pending work and
  retry after a timeout, rather than testing a separate implementation.
- Expanded Speaking/shared-shell Node suite: 410 passed, zero failed/skipped.
- Strict TypeScript passed (`--noEmit --incremental false`).
- Next 16.3.4 production build passed; 136 static pages generated.
- Independent Claude diff review completed with no blocking findings after
  the timeout memo recovery fix. Getter/singleton/call-site concerns were
  checked against actual source; future hypothetical throwing getters and
  broader cross-route readiness cleanup were not treated as proven bugs or
  added to this scoped patch. Review was diff-only, with no reviewer tools.
- Deployment and the identical eight-journey staging diagnostic must still
  pass on the merged release before restarting the 20-run qualifying batch.

The private recording bucket remediation is unchanged. Historical clean runs
and the diagnostic are not substituted for a new eligible Gate E streak.
