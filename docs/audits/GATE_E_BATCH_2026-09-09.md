# Staging sync and sequential Gate E batch — 2026-09-09

## Deployment verified

Staging fast-forwarded to merged PR #1349:
`4eb2a9ab6ea58d77992a8a183b375cddc3facb8a`.
Vercel deployment 6341772890 and Railway deployment 6341758379 succeeded.
Readiness returned OK for 14 critical table projections; optional curated
features remain disabled. Run provenance independently confirms both live
frontend/backend releases and the staging environment match this SHA.

## Batch outcome — stopped on failure, not complete

Suite `gate-e-critical-suite-v20`, manifest digest
`0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a`.

| Run | Result | Canonical streak |
| --- | --- | --- |
| [34306723763](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34306723763) | Clean: 33 passed, 1 allowed skip; all failure matrices and device prerequisites complete | 1/20 |
| [34307429178](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34307429178) | Failure: 30 passed, 1 failed, 1 allowed skip, 2 serial tests did not run | 0/20 |

No retry or third manual run was dispatched. Thresholds, frozen test files and
evidence were not altered to force a pass. The GitHub four-daily schedule is
unchanged. An attempt to restore the app heartbeat to its previous cadence
returned “Automation does not exist”; its scheduling state is not confirmed,
and no replacement/duplicate was created.

## Failure triage

- **Severity: Medium, blocks Gate E acceptance.**
- **Observed failure:**
  `frontend/tests/staging-e2e/pilot-4-profile-save.spec.js:166`, double-submit
  case, times out waiting for `#profile-email` to contain the synthetic student's
  email. It remains `—` for 20 seconds. The case never reaches either Save click.
- **Root cause not yet proven.** Screenshot shows a signed-in header but profile
  placeholders. This is insufficient to distinguish profile fetch failure,
  auth/runtime readiness, hydration, or an environment/network delay. It does
  not prove the double-submit guard itself is broken or a learner save was lost.
- **Impacted source to inspect:**
  `frontend/app/(authed)/profile/profile-behavior.tsx::ProfileBehavior` data
  effect / `waitForApi`, shared auth/API runtime, `/auth/profile` read path.
- **Minimal next step:** capture bounded, sanitized request status/timing and
  page errors for this journey before patching. Do not enable live-auth traces:
  they can contain the synthetic password and bearer tokens.
- **Verification:** reproduce the failing load path, add a deterministic
  regression test, verify normal load + account switch + double-submit and
  canonical reload, deploy the actual fix, then restart the streak on a pinned
  final release. Do not lengthen the timeout or omit the test without evidence.

The audio compatibility patch is separate and local only. These runs did not
test that patch. Twenty sequential runs also do not substitute for any separate
Gate F elapsed-time criterion or convert the hard-flip waiver into a gate pass.

## Continuation checkpoint

- Audio PR [#1350](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1350)
  merged 2026-09-09 04:06:36 UTC after all nine PR checks passed and review
  threads were empty. Merge commit `f82e25a9a00d46300b566f8075e3799375e9956c`.
  Staging was fast-forwarded to that exact commit. The earlier "local only"
  statement describes the two Gate E runs above, not this later rollout.
- Claude diff-only review completed; validated findings fixed before the PR:
  one bad audio object no longer blocks other playable items, diagnostics are
  sanitized but retain exception type/count, SDK null-URL batch failures have
  bounded per-item fallback. Final local verification: 135 backend tests,
  33 frontend contracts, strict TypeScript and OpenAPI drift all passed.
- Read-only staging inventory: private-audio target bucket still public, 79
  objects; 77 responses belonging to the exact seeded E2E smoke student resolve
  to stored objects. No bucket setting or existing recording has been changed.
- Separate diagnostic branch `codex/staging-profile-diagnostic-2026-09-09`
  (no product changes) ran eight normal/intercepted profile loads per execution.
  Run 34309298120 loaded all eight profiles in 1.2–1.8 seconds but marked the
  diagnostic job failed because it counted deliberately blocked background
  writes as profile failures. This was a diagnostic false positive, not a
  product fix. Follow-up 5ce461d2 separates those counts; run 34309593021 is
  successful. Neither run is Gate E evidence, and the original profile timeout
  is not retroactively called a pass or a proven fixed root cause.
- Remaining: verify deployed audio code and private-bucket synthetic access
  boundaries on staging/production, then launch a new 20-clean-run batch on
  the final source. The goal remains active; no completion claim yet.
