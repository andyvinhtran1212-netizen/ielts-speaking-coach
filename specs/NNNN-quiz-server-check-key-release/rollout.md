# Rollout and rollback

## Preconditions

- This spec approved on `staging` by Vinh (Q-1..Q-5 answered by approval).
- #2091 (J411R2) on `staging` (done, `c7ed31b32`).
- No migration, no environment variable, no flag. Key removal (FR-009) is
  ordered by deploy steps, not by a flag.

## Staging

A. Merge the build PR (backend `/check`, server grading, frontend player on
   `/check`, key release, verdict collection). Self-study keys stay in the
   payload at this step; the new player ignores them.
B. Merge the separate FR-009 PR (T006) only after the FR-010 frontend is
   live on Vercel for the same environment (check the deployment SHA).
C. Journeys with QA accounts only (no real learners, no email):
   1. Grammar self-study: answer right, wrong, typo; DevTools shows `/check`
      before any key; GET bank has no key fields.
   2. Replay a `/check` (same body) → same verdict, one row (read-only
      `select count(*) from quiz_attempts where client_id = '<id>'`).
   3. Forge `/progress` with `is_correct=true` and a wrong answer → stored
      false.
   4. single_attempt QA assignment with `due_at` in the future: QA learner A
      hands in, review shows the release notice; after moving `due_at` into
      the past (QA assignment only) the review opens.
   5. Mastery QA item: abandoned session + full run → verdict 422 then
      correct verdict with the abandoned answers counted; teacher view counts.
   6. `/check` latency: 30 samples, p95 recorded.
D. SA retest (`verification.md`).

## Production

Through the normal staging → main promotion. Railway (backend) and Vercel
(frontend) deploy from the same promotion. FR-009 (T006) is promoted in a
later promotion than FR-010, so no production tab ever runs a player that
needs keys against a payload without them. Health: `/health`, one Grammar session on a
QA account, 24 h of Railway logs for `/check` 5xx.

## Rollback and repair

- Code rollback: redeploy the previous Railway/Vercel release. No schema to
  revert. Rows written by `/check` are ordinary `quiz_attempts` rows and stay
  valid for the old code.
- Rolling back only the backend while the new frontend stays live: the
  player shows "Chưa chấm được" (no `/check`). Roll back both together.
- Repair: no DML. Historical self-study rows stored with a client flag stay
  as they are; the verification baseline query counts them. Course verdicts
  already regrade from `answer_given`. If a count shows learner-visible harm
  (e.g. `/mistakes` gaps), a separate repair ticket with a dry-run is opened.
- Verdict ledger entries recorded before this change have no
  `session_count`/`attempt_count`; the teacher view shows "—".

## Observability

- Log `[quiz] check failed session=<id> code=<code>` for every non-2xx
  except 404/422 from bad input; include `X-Request-ID`.
- Log `[quiz] verdict sessions incomplete item=<id> missing=<n>` on the 422.
- Owner: PC monitors Railway logs for 24 h after staging merge and after
  promotion; alert threshold: any `/check` 5xx burst > 5 in 10 minutes.
- Load: one `/check` per answer (one question read + one insert), replacing
  local grading; `/progress` batches become smaller. Watch latency during
  open Grammar sessions (single uvicorn loop, PC-J05).
