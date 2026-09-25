# Listening v1.0 → v1.1 cutover decision (local draft)

Status: owner selected choice A (drain then cut over). A gate implementation
exists only as uncommitted work in the separate Listening runtime worktree
(`303_listening_v1_start_drain_gate.sql` plus route/tests); it has not been
applied or enabled on staging/production. No package status or learner attempt
has been changed, and v1.1 is not approved for publication. The owner clarified
that no further translated question, SVG or audio content has been approved;
permission was only to continue preparation.

Code evidence below was audited against `origin/staging` at
`87c8b535b624e3c0d712db5d48f95f34c18f5784`; re-audit if that head moves.

## Verified current contract

- Migration 295 has a partial unique index allowing only one `published`
  package per programme.
- The package status RPC archives or publishes the package, tests, content,
  exercises and lessons together. It is one-package-at-a-time; there is no
  atomic old→new swap.
- `fn_acquire_listening_programme_attempt` checks the target test is
  `published` before it can resume an existing attempt. New report-only
  attempts have a 24-hour `resume_expires_at`.
- `_programme_guided_context` requires the test and package to be
  `published`, then loads only published exercises. Archived v1.0 attempts
  cannot use guided question-by-question review even when still within their
  24-hour window. The student player and attempt routes have additional
  published gates that need a full contract audit before any fix.
- Submitted attempt review has a different read path and must be verified
  against an archived package; its apparent availability does not prove
  active-attempt continuity.

## Route-by-route archive audit (read-only)

The archive RPC in `backend/migrations/295_listening_content_programmes.sql`
updates the package, lessons, tests, content and exercises to `archived` in
one package-scoped transaction (lines 1126–1174). It does **not** atomically
publish the replacement package. The following consequences come from the
current code, not a staging rehearsal:

| Surface | Current behaviour after v1.0 archive | Evidence |
| --- | --- | --- |
| Programme home, library and lesson detail | Published-only package, lesson and test queries omit old forms and their attempt progress; the old lesson detail returns 404. A saved old attempt is not offered as a resume CTA. | `backend/routers/listening.py` `_load_programme_overview`, `list_listening_programme_lessons`, `get_listening_programme_lesson` (around lines 4726–4756, 4956–5067). |
| Form runner | Boot calls `POST /tests/{id}/attempts?standalone=true` first and then `GET /tests/{id}`. Both require the test to be published, so a direct old form link fails even if its attempt is still within the 24-hour window. | `frontend/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner.tsx` lines 59–79; `backend/routers/listening.py` around lines 6853–6863 and 5462–5488; migration 295 around line 351. |
| Owned in-progress lookup | A direct `GET /tests/{id}/attempts/in-progress` can still find an active owned row because it does not check test publication, but this alone cannot boot the archived form. | `backend/routers/listening.py` around lines 6740–6824. |
| Answer save and submit | Owned, unexpired attempt rows can still pass the current `PATCH .../answers` and `POST .../submit` paths, which do not require published source rows. This is not a usable learner journey while the player and guided feedback are blocked. | `backend/routers/listening.py` around lines 7141–7199 and 7592–7724. |
| Immediate guided feedback | Both router `_programme_guided_context` and the reveal RPC require published test/package/exercise rows. Existing first-answer reveals cannot be read through `guided-state`, and a new reveal cannot be recorded after archive. | `backend/routers/listening.py` around lines 7244–7337; `backend/migrations/296_listening_programme_feedback_reveals.sql` around lines 78–118. |
| Submitted review | The direct owner-scoped review route and assembler do not filter on published status; they read historical rows and request a fresh signed audio URL. Real archived-package testing is still required to prove storage access and frontend navigation. | `backend/routers/listening.py` around lines 7825–8000 and `_student_audio_url_for_test` around line 4505. |

For choice B, a safe implementation must preserve the exact attempt's pinned
immutable package only for its owner and only while it is in progress and
unexpired. It must never allow a new attempt against archived v1.0 or expose
keys/transcripts through a direct archived test ID. The programme home needs
an explicit old-attempt resume/history path; the player, guided router and
reveal RPC need matching scoped rules; submitted review must be tested after
archive. This is a coordinated contract change, not a UI-only bypass.
The current PostgreSQL reveal test explicitly expects an archived package to
be denied (`backend/tests/test_migration_296_listening_programme_feedback_postgres.py`
around lines 183–200). A choice-B test must replace that blanket expectation
with separate cases for an owned active pinned attempt, an expired attempt,
another user's attempt and a forbidden new start.

## Owner choices

| Choice | Learner impact | Required work and release gate |
| --- | --- | --- |
| A. Drain then cut over | A learner may need to wait for a scheduled maintenance window; no v1.0 active attempt should be interrupted. A short browse gap remains between archive and publish. | Stop new v1.0 starts through an explicitly verified gate, wait until all live v1.0 attempts are submitted or their 24-hour resume windows expire, query again under the gate, archive v1.0 and publish v1.1. A zero count **without** a new-start gate is racy. |
| B. Preserve pinned old attempts (best learner continuity, larger scope) | Existing v1.0 learners can finish against immutable v1.0 while new learners discover v1.1. A brief browse gap remains unless the status swap is made atomic. | Approve a separate route/DB contract for user-owned in-progress attempts on archived package rows, with strict no-new-start rules, scoped answer-key access, expiry enforcement, guided/player coverage and regression tests. Then archive/publish after exact-SHA staging verification. |

Both choices preserve v1.0 bytes and submitted history. Neither permits
publishing based only on translated-text coverage. Choice B is a scope
expansion from a content import and needs explicit owner approval before code
changes. Choice A also needs an operational new-start gate; merely observing
that no attempts are currently active is insufficient.
The owner selected choice A. Choice B is not authorized. Before enabling a
drain, verify that the gate blocks every new attempt against the old package
without blocking an owned, unexpired resume, answer save or submit. The generic
start-over route also abandons earlier attempts before inserting a replacement;
its behavior during a drain must be covered so a rejected new start cannot
destroy a learner's existing attempt. Merely observing zero attempts is racy.
Activation, package archive/publish and production promotion remain separate
release decisions, not implied by this strategy selection.

## Read-only preflight evidence

Only after the new gate migration and route have passed exact-SHA staging
verification, the v1.1 package is complete and approved, and an operator has
verified both expected gate rows are present, enable the two v1.0 gate rows
through the privileged database migration/runbook connection. The gate starts
disabled; a code deployment alone must not pause learners. Do not activate it
for an incomplete or unapproved v1.1 release. A `draining=true` gate blocks
new inserts against that exact old package but permits an owned attempt to
resume, save answers and submit. If the cutover is cancelled before archive,
an operator may return the old gate rows to `draining=false`; no existing
attempt changes state as a result.

After gate activation commits, count still-resumable old attempts by programme
and package without exposing answers. The trigger's row lock orders all new
attempt inserts before or after activation, so this count cannot race a new
start against the old packages:

```sql
SELECT p.programme_id, p.package_id, count(*) AS live_attempts,
       max(a.resume_expires_at) AS latest_expiry
FROM listening_test_attempts AS a
JOIN listening_tests AS t ON t.id = a.test_id
JOIN listening_content_packages AS p ON p.id = t.content_package_id
WHERE a.status = 'in_progress'
  AND (a.resume_expires_at IS NULL OR a.resume_expires_at > now())
  AND p.package_id IN (
    'general-listening-practice-v1.0.0',
    'ielts-listening-practice-v1.0.0'
  )
GROUP BY p.programme_id, p.package_id;
```

This query is diagnostic only, not authority to archive. Wait until it reports
zero for **both** old packages and separately confirm the gate remains on;
then recheck exact-SHA staging, all active and submitted learner paths,
audio/timing and rollback before touching production status. Archive v1.0 and
publish v1.1 only through their manifest-bound package RPCs under the approved
release procedure. Do not clear the old gate before v1.1 is published and
verified; the gate is package-specific and does not block v1.1 starts.
