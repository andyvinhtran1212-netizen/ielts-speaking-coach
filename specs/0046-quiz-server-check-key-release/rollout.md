# Rollout and rollback

## Preconditions

- This spec approved on `staging` by Vinh (Q-1..Q-5 answered by approval).
- #2091 (J411R2) on `staging` (done, `c7ed31b32`).
- No migration, no environment variable, no flag. Key removal (FR-009) is
  ordered by deploy steps and enforced by the server's client-contract
  gate, not by a flag. Deployment order does not upgrade already-open tabs.

## Staging

A. Merge the build PR (backend `/check`, server grading, frontend player on
   `/check`, key release, verdict collection). The player sends
   `quiz_contract=server-check-v1` on every self-study bank GET, including
   managed Grammar reset and reopen. Self-study keys stay in the payload
   at this step; the new player ignores them, and unmarked old clients
   still work. Before this deployment, keep a pre-FR-010 QA tab open for
   the step C.7 compatibility probe.
B. Merge the separate FR-009 PR (T006) only after the FR-010 frontend is
   live on Vercel for the same environment (check the deployment SHA).
   This PR also enforces the server gate: after auth/access checks, a
   missing or unknown `quiz_contract` on a self-study bank GET returns
   409 `quiz_client_refresh_required`, with no questions or key fields,
   before building/returning the play payload. Only `server-check-v1`
   receives the key-free bank; no legacy-key fallback. Course admission
   is unchanged. Do not promote key removal until the route guard tests
   and C.7 pass on staging; block the release if either fails.
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
   7. Keep the pre-FR-010 tab open across A and B. Trigger managed Grammar
      `resetProgress()` and reopen the bank without a page reload: every
      bank refetch lacks the marker and returns 409
      `quiz_client_refresh_required` with no questions or key fields. The
      old tab shows its existing load error and cannot grade a newly
      fetched bank. A full page reload then loads FR-010 JavaScript,
      sends the marker, receives 200 key-free and grades through `/check`.
      Repeat the request probe for legacy Grammar and Vocab; unknown
      marker also returns 409. Record both deployment SHAs and evidence
      in `verification.md`.
D. SA retest (`verification.md`).

## Production

Through the normal staging → main promotion. Railway (backend) and Vercel
(frontend) deploy from the same promotion. FR-009 (T006) is promoted in a
later promotion than FR-010. Existing production tabs can retain pre-FR-010
JavaScript across both promotions: the server gate blocks their unmarked
bank refetches until a full page reload, regardless of tab age. Verify the
exact deployed SHAs, the 409 unmarked/unknown-marker probes, and a marked
200 key-free probe with a QA account. Keys downloaded before FR-009 cannot
be recalled; an old tab using its cached keyed bank still has server-graded
stored correctness/totals (FR-006/FR-008). Health: `/health`, one Grammar
session on a QA account, 24 h of Railway logs for `/check` 5xx.

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
