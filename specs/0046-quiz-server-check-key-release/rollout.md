# Rollout and rollback

## Preconditions

- This spec approved on `staging` by Vinh (Q-1..Q-5 answered by approval).
- #2091 (J411R2) on `staging` (done, `c7ed31b32`).
- One migration, `<next>_course_answer_after_seal_guard.sql` (FR-008
  functions, FR-017, FR-018; Q-8), applied to each environment before the build code that
  depends on it. No environment variable, no flag. Key removal (FR-009) is
  ordered by deploy steps and enforced by the server's client-contract
  gate, not by a flag. Deployment order does not upgrade already-open tabs.

## Staging

A0. Apply the migration to staging through the locked runner (advisory
   lock, ledger row), after the read-only inventory of T011 and before
   the build PR (T004/T007/T008) merges. Verify read-only: ledger row
   present, `has_table_privilege` false for `anon` and `authenticated` on
   `public.quiz_attempts` and `public.quiz_sessions`, no
   `quiz_attempts_select`/`quiz_sessions_select` policy, guard body
   contains `course_session_closed` and `quiz_session_closed`,
   `quiz_close_sessions_counted` exists (`service_role` only). Smoke on
   staging: one Grammar self-study (legacy and managed) answer, one untimed
   mastery and one timed Course answer still store; ending each session
   stores totals equal to a read-only recount.
A. Merge the build PR (backend `/check`, server grading, derived
   `answer_word_count`/`text_match_eligible` on every bank, frontend player
   on `/check`, key release, verdict collection with the session seal). The
   player sends `quiz_contract=server-check-v1` on every self-study bank
   GET, including managed Grammar reset and reopen. Self-study keys stay in
   the payload at this step next to the derived fields; the new player
   ignores the keys and reads text-match eligibility and word counts only
   from the derived fields, and unmarked old clients still work. Railway
   must serve the derived fields before the FR-010 frontend is used (the
   build PR deploys backend first; check `/api/quiz/banks/{id}` on the
   deployed SHA carries `text_match_eligible`). Before this deployment,
   keep a pre-FR-010 QA tab open for the step C.7 compatibility probe.
B. Merge the separate FR-009 PR (T006) only after the FR-010 frontend is
   live on Vercel for the same environment (check the deployment SHA).
   This PR also enforces the server gate: after auth/access checks, a
   missing or unknown `quiz_contract` on a self-study bank GET returns
   409 `quiz_client_refresh_required`, with no questions or key fields,
   before building/returning the play payload. Step B only removes the
   keys and enforces the gate; it adds no field. Only `server-check-v1`
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
      Then, with a second QA tab still open on a collected session of a
      failing verdict, post `/progress` there: 409 `course_session_consumed`,
      no `feedback`/key field in the response (DevTools), no new row
      (read-only `select count(*) from quiz_attempts where session_id =
      '<id>'` unchanged), the session shows `ended_by='abandoned'`; the
      retake/full retry in a new session still records answers.
      Also open a third QA tab on an empty run session **before** the
      failing verdict, never answer in it, then after the `retry_full`
      verdict post `/progress` there: same 409, no key, count stays 0, the
      session shows `ended_by='abandoned'` and its id is in the ledger
      entry's `superseded` (read-only select of
      `class_assignment_items.mastery`).
      The answer-racing-the-seal case is proven by the T008/T011 PG
      tests (a held insert cannot be staged by hand); on staging, check
      read-only that no session listed in any QA ledger `superseded` has
      a `quiz_attempts` row.
   5a. With the QA learner's own JWT, `GET /rest/v1/quiz_attempts?select=qid,is_correct&limit=1`
      and `GET /rest/v1/quiz_sessions?select=total_correct,accuracy&limit=1`
      return no row (FR-017). Do not record the JWT.
   5b. single_attempt QA assignment with `due_at` in the future: store one
      answer, pause the session, then read the PATCH response,
      `/api/quiz/progress`, `/course-resume` and "Bài của tôi" in
      DevTools: no `total_correct`/`total_wrong`/`accuracy` value, no
      `last_stage`, no score; repeat after hand-in, before release
      (FR-019). The racing end is proven by the T004/T011 PG tests.
   6. `/check` latency: 30 samples, p95 recorded.
   6a. Intermediate deployment (after A, before B): a Grammar QA bank with a
      nonempty explicit `text_match_by_qid` policy loads in the FR-010
      player (policy validator accepts it), GET shows keys plus
      `text_match_eligible`/`answer_word_count`, and a one-edit typo on an
      `exact` qid grades wrong while a `typo_tolerant` qid grades right via
      `/check`. Record the deployment SHAs. Block step B if it fails.
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

Apply the migration to production under the advisory lock (locked
runner) before the promotion that carries T008, after repeating the
T011 read-only inventory and grant check on production; verify it as in
A0. Then the normal staging → main promotion. Railway (backend) and Vercel
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

- Code rollback: redeploy the previous Railway/Vercel release; the
  migration can stay (old code is compatible, `plan.md` Compatibility).
  Migration rollback (rollback file: migration 284 guard body, policy
  and grant) only if the guard breaks a legitimate insert; it reopens the
  late-row race and the direct REST read, so roll back the T008 code
  with it. Rows written by `/check` are ordinary `quiz_attempts` rows and
  stay valid for the old code.
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
