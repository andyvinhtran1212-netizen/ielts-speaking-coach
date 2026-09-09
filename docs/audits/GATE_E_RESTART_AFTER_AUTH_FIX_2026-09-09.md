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

## Verification still required at this checkpoint

The identical diagnostic is pinned to the new SHA; only its expected release
constant changed. All eight baseline/delayed-init journeys must pass with no
unauthenticated protected read and no login redirect. This diagnostic is not
Gate E evidence. A new 20-run batch may start only after it passes, then must
pin frontend/backend/source to 17159ba0 and retain v20 manifest digest
`0f2079dc6d440119af53b03faee1b2d54884f1510ac9b2c713fc957fa8738e0a`.

Private audio buckets remain private; no learner recordings or rows are
changed by this remediation. Gate F elapsed-time requirements remain separate.
