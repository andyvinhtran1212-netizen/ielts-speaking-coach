# Gate E restart after verified Speaking auth fix — 2026-09-09

## Why a new batch is required

The preceding final-release batch reached eight clean runs, then failed run
`34317212151` (run number 211). Its canonical ledger is **0/20**. The failure
was a real Speaking bootstrap race, not a reason to omit the test or raise a
timeout: a protected `/auth/me` request ran before client initialization, had
no Authorization header, received 401 and redirected a valid signed-in user.

Read-only diagnostic `34318449707` reproduced this on old release f82e25a9:
one of four normal journeys failed and all four 750-ms-delayed client-init
journeys failed with the same missing-auth sequence. No session POST occurred.

## Remediation and deployment

[PR #1351](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1351)
merged at 06:45:29 UTC after all nine PR checks passed and inline comments were
empty. Exact merge commit: `17159ba0eaa8a2e889f981ba49abfe43101d0601`.
The patch waits for the existing shared auth client before Speaking API calls,
preserves immediate local controls and permits a later action to retry runtime
readiness after timeout. No frozen Gate E test/manifest/threshold changed.

Local checks: 27 focused tests, 410 expanded Speaking/shared-shell tests,
strict TypeScript and final production build passed. Claude's final independent
diff-only review found no blocking issues after timeout-memo recovery was fixed.

Staging was fast-forwarded, without force-push, to the exact merge commit.
GitHub deployment status verified successful for all four targets:

| Target | Deployment | Completed UTC |
| --- | --- | --- |
| Staging frontend | 6344162983 | 06:46:31 |
| Staging backend | 6344157165 | 06:46:40 |
| Production frontend | 6344157704 | 06:46:07 |
| Production backend | 6344150078 | 06:46:21 |

## Post-deploy verification completed

The identical diagnostic was pinned to the new SHA; only its expected release
constant changed. Run
[34320767813](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34320767813)
passed **8/8**: all four baseline and all four 750-ms-delayed-init journeys
showed immediate missing-topic validation, stayed on Speaking, issued no
session POST and emitted no protected read without Authorization. Every first
`/auth/me` had both `clientReady: true` and `authorizationPresent: true`.
On delayed journeys the auth client finished initialization before that read.
The sanitized log was parsed and all eight verdicts checked independently of
the workflow's green conclusion. This is causal regression evidence, not a
Gate E run.

Production HTML `data-release` matches the new SHA. Both backend readiness
endpoints returned OK for database and all 14 critical table projections at
approximately 06:49 UTC. No schema migration was applied for this frontend fix.

## New qualifying batch — still in progress

First run:
[34321114153](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34321114153),
run number **212**, started **2026-09-09T06:53:06Z**. Its completed canonical
ledger confirms **1/20**: 33 passed + one exact allowed skip, zero unexpected,
flaky or retried tests, counts 28/2/2/2 and matching source/frontend/backend
provenance. Main/staging pins were read back before dispatch and before the
next run; paginated history contained only this run for the new batch.

Latest verified checkpoint: **10/20** at run `34328774128`.
All ten raw reports/provenance/ledgers were verified; paginated GitHub history
matches exactly successful attempt-1 runs 212–221 on the pinned release.
The third run's four raw failure-matrix reports were additionally downloaded
and inspected independently: Speaking **49**, Reading **12**, Listening **36**,
Writing **12** tests all passed, each with exactly one result and retry zero.
Its live-staging ambiguous-commit evidence proves one upload committed with
HTTP 200 and one canonical reconciliation read; backend, client and persisted
response IDs match. Production egress and browser errors are both empty.
The fifth run, `34323933527`, run number **216**, event **schedule**, was
already in progress when the fourth run was verified; no additional manual
run was dispatched. It completed cleanly and is included in the count above.
Current pending run:
[34329685727](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/34329685727).
It is not yet counted. Neither the old eight-run streak nor diagnostic runs
contribute to this batch.

Pin frontend/backend/source to 17159ba0 and retain v20 manifest digest
`0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a`.

The app confirmed creation of the five-minute temporary batch heartbeat
`ho-n-t-t-gate-e-sau-s-a-x-c-th-c`. The main goal turn and heartbeat belong to
the same sole-controller task: reconcile GitHub history before dispatching,
never overlap manual runs, verify each ledger/raw report/provenance, and stop
on any failure/retry/drift or missing evidence. The previous failed batch's
heartbeat was deleted; the GitHub four-daily schedule and other schedules
were not changed. No Gate E completion claim has been made.

Private audio buckets remain private; no learner recordings or rows are
changed by this remediation. Gate F elapsed-time requirements remain separate.

Read-only storage metadata recheck at approximately **07:36 UTC** confirmed
`audio-responses.public=false` on both environments, **79** staging objects and
**7,597** production objects, with zero remaining objects in the synthetic
probe namespace on either. This check read metadata only, not learner audio.
