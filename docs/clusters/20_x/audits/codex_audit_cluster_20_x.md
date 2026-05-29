# Codex Audit Report — Cluster 20.x Reading Module

**Audit date:** 2026-05-29  
**Auditor:** Codex (OpenAI Codex CLI)  
**Scope:** Cluster 20.x at Sprint 20.8 closure head (`56deecec` in the `reading-20-7` worktree)  
**Out of scope:** Code fixes, Phase B work, cluster 21.x grammar, mass content production

## Executive summary

Cluster 20.x is broadly healthy: the three-library architecture is coherent, answer-key stripping is correctly enforced on student detail routes, admin import is properly admin-gated, and the L3 grading/diagnostic path is live with targeted tests passing. I did **not** find a P0 security or correctness issue that should block observation entirely.

The main concerns are **P1 data-integrity / concurrency seams**, not catastrophic breakage. The biggest ones are: the L3 importer does **not** fully overwrite removed passages on re-import even though the docs repeatedly claim that it does; the Q7 “one active attempt” invariant is enforced only in application code, not the database, so concurrent starts can create two in-progress attempts; and the exam auto-save endpoint is a non-atomic read-modify-write that can lose answers under overlapping PATCHes.

Sprint 20.7 self-audit note: my own diagnostic engine work is functionally sound, but its threshold behavior is under-tested at the exact boundary values and its recommendation path silently degrades when no L2 matches exist. Those are not blockers, but they should be documented honestly.

## Methodology

I audited the cluster empirically from source at the 20.8 closure commit in the reading worktree.

What I read:

- Git history and closure head:
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/.git`
  - `git log --oneline -20`
- Cluster docs:
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/discovery.md`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/design_baseline.md`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/reading_content_format_v2.md`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/retrospective.md`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/governance.md`
- Backend implementation:
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/migrations/086_reading_module_foundation.sql`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/migrations/087_reading_test_attempts.sql`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/admin_reading.py`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/content_import_service.py`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_test_grader.py`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_diagnostic_engine.py`
- Frontend implementation:
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-vocab.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-vocab-passage.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-skill.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-skill-exercise.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-test.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/reading-exam.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/pages/admin/reading/content.html`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/markdown.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-vocab.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-vocab-passage.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-skill.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-skill-exercise.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-test.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-exam.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/admin-reading.js`
  - `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/components/reading-questions.js`

What I ran:

- Backend targeted suite:
  - `127 passed` across the reading-specific backend bundle
- Frontend targeted suite:
  - `64 pass` across the reading-specific sentinel bundle

Limitations:

- I did not run the full monorepo suite because this audit is cluster-scoped and the worktree is intentionally pinned to the 20.8 closure head.
- I did not execute browser-level manual UI dogfood; accessibility and pixel-level UX were out of scope unless they showed up directly in code or sentinels.
- The local `origin/main` ref in this worktree was stale, so provenance was verified from the local closure branch/commit rather than a fresh remote comparison.

## Findings by severity

## P0 — none found

I did **not** find a P0 production blocker in cluster 20.x. In particular:

- Student L1/L2/L3 detail routes strip answer keys and explanations from student payloads.
- `reading_test_attempts` is RLS-enabled and scoped to `auth.uid()`.
- Admin reading routes are guarded by `require_admin(...)`.
- Shared markdown rendering goes through DOMPurify on the reading surfaces I inspected.
- I found no evidence of Next.js / React artifact noise or other stack contamination.

## P1 findings

### P1-1 — L3 re-import does not remove passages deleted from the source file, despite docs claiming “fully overwrites”

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/admin_reading.py:266-355`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/reading_content_format_v2.md:424-431`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/reading_content_format_v2.md:505-513`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/governance.md:51-55`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/retrospective.md:160-166`

**What the cluster claims:**

- Re-import is idempotent and “fully overwrites” the prior L3 state.
- “No orphans, no duplicates.”
- The same file can be safely re-imported and replaced in place.

**What the code actually does:**

- `_import_l3_full_test()` updates or inserts the `reading_tests` row by `test_id`.
- It then updates or inserts only the passages present in the current upload, by `slug`.
- It deletes and reinserts `reading_questions` **only for those still-present passages**.
- It never enumerates or deletes old `reading_passages` rows that belong to the same `test_id` but were removed from the updated source file.

**Why this matters:**

If Andy re-uploads an L3 test after removing one passage from the source file, the old passage row remains in the database linked to the test, along with its questions unless separately deleted. That violates the docs’ “fully overwrites” promise and can leave stale data attached to a supposedly corrected test bundle.

**Recommended follow-up:**

- Add a pre-reconciliation step in the L3 importer: compare `existing passage slugs for test_id` vs `new passage slugs` and delete missing ones before inserting/updating the new set.
- Update the docs if the team decides to keep the current “best-effort update only” semantics instead of full reconciliation.

**Estimated fix size:** ~25-50 LOC backend + ~10-20 LOC tests + doc edits

### P1-2 — Q7 “one active attempt” invariant is application-only, so concurrent starts can create multiple `in_progress` attempts

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py:451-495`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py:635-671`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/migrations/087_reading_test_attempts.sql:16-68`

**What the cluster claims:**

- The Q7 invariant is “≤1 active attempt per user+test”.
- New starts abandon prior in-progress attempts before inserting a new row.
- Resume lookup is therefore unambiguous.

**What the code actually does:**

- `start_reading_test_attempt()` calls `_abandon_open_attempts()` and then inserts a new `in_progress` row.
- There is no partial unique index like `(user_id, test_id) WHERE status = 'in_progress'`.
- There is no transaction or row lock around the abandon-then-insert sequence.
- `GET /test/{test_id}/attempts/in-progress` simply fetches the latest `status='in_progress'` row by `started_at desc`.

**Why this matters:**

Two near-simultaneous starts can both observe no active row after the abandon step and then each insert a new `in_progress` attempt. The product will usually resume the latest one, but the older “still in progress” row remains live, breaking the canonical invariant and creating ambiguous state for analytics or future resume flows.

**Recommended follow-up:**

- Add a partial unique index enforcing one `in_progress` attempt per `(user_id, test_id)`.
- Wrap start logic in a safe retry/upsert path that handles unique-violation races predictably.

**Estimated fix size:** ~20-40 LOC migration + ~15-30 LOC router/tests

### P1-3 — Exam auto-save PATCH is a non-atomic read-modify-write and can lose answers under overlapping requests

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py:679-715`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/js/reading-exam.js:230-237`

**What the cluster claims:**

- `PATCH /answers` is idempotent per `q_num`.
- The exam UI auto-saves safely with a 500ms debounce.

**What the code actually does:**

- The backend reads the whole `answers` array from the attempt row.
- It removes the current `q_num`, appends the patched answer, then writes the whole array back.
- This is not atomic at the row-field level.
- The frontend issues per-question PATCHes asynchronously; debounce reduces frequency but does not serialize all in-flight writes across questions.

**Why this matters:**

If two PATCH requests for different questions overlap, each can read the same stale array and then overwrite the other’s addition. The result is silent answer loss, which is exactly the kind of production seam that tends to show up only under real exam use.

**Recommended follow-up:**

- Move answer persistence to an atomic DB-side update shape, or store answers per question row/key rather than as a whole-array read-modify-write blob.
- Add a concurrency regression test that simulates two overlapping PATCHes on the same attempt.

**Estimated fix size:** ~30-80 LOC backend depending on chosen storage/update path + tests

### P1-4 — L3 import path is explicitly non-transactional, so partial writes are survivable but still real

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/admin_reading.py:266-361`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/reading_content_format_v2.md:431`

**What the cluster claims:**

- Mid-way failures are “consistent enough” for re-import to recover.

**What the code actually does:**

- The L3 import sequence is multi-step and best-effort sequential over Supabase REST.
- If passage 1 and 2 update successfully and passage 3 fails, the DB is left in a real partial state until the operator retries.

**Why this matters:**

This is not a hidden bug — the code comments admit it — but the cluster documents it as almost fully mitigated by re-import idempotency. That mitigation is weaker than claimed because of the stale-passage problem above. The combination creates a larger integrity risk than the docs currently acknowledge.

**Recommended follow-up:**

- Fix passage reconciliation first.
- Then either keep the current best-effort model and document the real residual risk, or move import to a more atomic server-side path.

**Estimated fix size:** doc-only if accepted as debt; larger if transactional redesign is attempted

## P2 findings

### P2-1 — Submit-time parse failure of `started_at` silently falls back to `elapsed_seconds = 0`

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py:570-578`

**What the code does:**

- If `started_at` exists but `datetime.fromisoformat(...)` throws, the handler sets `elapsed_seconds = 0`.

**Why this matters:**

This is defensive and unlikely in normal operation, but it means malformed or corrupted `started_at` values disable the Q5 server-side expiry guard instead of failing closed.

**Recommended follow-up:**

- Treat parse failure as a 500 or 422 operational error instead of “0 elapsed”.
- Add one negative-path test for malformed `started_at`.

**Estimated fix size:** ~5-10 LOC + 1 test

### P2-2 — Diagnostic boundary behavior is under-tested at the exact threshold edges

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_diagnostic_engine.py:29-31`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_diagnostic_engine.py:102-107`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/tests/test_reading_diagnostic.py:19-68`

**What the code does:**

- `weak` is `< 60`
- `watch` is `< 75`
- `strong` is everything else

**What the tests cover:**

- Weak/watch/strong are covered with representative values.
- Exact edge values `59/60` and `74/75` are not explicitly pinned.

**Why this matters:**

This is a classic boundary-contract seam. The implementation looks correct today, but the cluster’s own lessons emphasize “full-chain” and “silent→loud” rigor. Exact threshold pins are missing from the diagnostic engine I shipped in 20.7.

**Recommended follow-up:**

- Add explicit tests for 59, 60, 74, and 75.

**Estimated fix size:** ~10-20 LOC tests

### P2-3 — Diagnostic recommendation path is recency-ranked only and silently degrades on no-match

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/routers/reading_student.py:731-744`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_diagnostic_engine.py:153-190`

**What the code does:**

- L2 recommendations are fetched by exact `skill_focus` match and sorted by `created_at desc`.
- The engine takes the first three rows for a skill.
- If no published L2 exercise matches a weak skill, the diagnostic returns `recommendations: []` with no learner-facing explanation.

**Why this matters:**

This is not incorrect, but it is a product-quality seam: the system degrades silently, and “best” recommendation currently means “most recently created” rather than “most pedagogically appropriate”.

**Recommended follow-up:**

- Either document recency-order as intentional in the governance/docs, or add a better ranking signal later.
- Consider returning a lightweight fallback message when a weak skill has no linked L2 exercise.

**Estimated fix size:** docs-only or ~10-30 LOC behavior/tests

### P2-4 — Full-chain testing is much better after F1/F2, but still does not cover the full live route journey end to end

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/tests/test_reading_validator_f1_f2.py:233-280`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/tests/test_reading_content_format_v2_examples.py:52-164`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/tests/test_reading_l3.py:279-320`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/frontend/tests/reading-diagnostic.test.mjs:14-29`

**What improved:**

- F1/F2 coverage now spans parse → validate → build → grade for seeded L3 content.
- The worked examples are pinned against the importer/build path.

**What is still missing:**

- There is no single integration path that proves `import → admin list → student detail (answer stripped) → start → PATCH → submit → diagnostic`.
- The frontend diagnostic sentinel proves surface hooks and URLs, not persisted route behavior.
- No test exercises the L3 re-import “removed passage” case.
- No test exercises overlapping PATCH writes or concurrent starts.

**Why this matters:**

Cluster 20.x explicitly learned the “full-chain” lesson from F1. The current suite is much better than 20.5, but the remaining gaps align exactly with the real P1 seams above.

**Recommended follow-up:**

- Add one end-to-end mocked integration test for the live route chain.
- Add race/edge tests for start and autosave.

**Estimated fix size:** ~40-120 LOC tests

### P2-5 — Diagnostic self-audit: thresholds are hard-coded heuristics with no calibration note beyond code

**Files:**

- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/backend/services/reading_diagnostic_engine.py:29-32`
- `/Users/trantrongvinh/Documents/ielts-worktrees/reading-20-7/docs/clusters/20_x/retrospective.md:160-166`

**What the code does:**

- Uses `60 / 75 / 10-point delta` as cluster-wide diagnostic cutoffs.

**Why this matters:**

The engine is deterministic and consistent, but those thresholds are product heuristics, not externally anchored conversions. That is acceptable for Phase 1 observation, but the rationale should be stated more explicitly if the diagnostic is going to influence content prioritization at scale.

**Recommended follow-up:**

- Add one sentence in docs/governance clarifying that these are heuristic observation thresholds, not externally validated IELTS thresholds.

**Estimated fix size:** ~5-10 LOC docs

## Coverage summary

### Clean / verified

- **Security + auth**
  - Student reading routes require auth.
  - Admin import/list routes require admin.
  - `reading_test_attempts` RLS is enabled and scoped to the owning `user_id`.
- **Answer key stripping**
  - L1, L2, and L3 student detail shapes omit `answer` and `explanation`.
  - Server-side checking fetches answer keys only on grading/check endpoints.
- **XSS posture**
  - Shared markdown rendering uses DOMPurify in `/frontend/js/markdown.js`.
  - List/admin preview surfaces escape interpolated text before `innerHTML`.
  - Reading question rendering uses text nodes / `textContent` on the student side.
- **Band conversion**
  - Academic thresholds in `reading_test_grader.py` match the expected boundary table.
  - General Training returns `None` as a deliberate Phase B gate.
- **Diagnostic engine basic behavior**
  - Auth scope is user-only.
  - Exact skill_tag → skill_focus matching is implemented as claimed.
  - Weak/watch/strong and trend directions behave correctly on the covered examples.
- **Frontend closure cleanup**
  - Mockup HTML/JS retirement is real.
  - Production exam still consumes `reading-exam-mockup.css` intentionally, matching the deferred-rename narrative.

### Findings present

- **Correctness / integrity**
  - L3 re-import passage deletion gap
  - Concurrent start invariant not DB-enforced
  - PATCH autosave lost-update risk
  - Submit parse-failure fail-open path
- **Test/documentation quality**
  - Diagnostic exact-boundary pins missing
  - Full live route chain not covered end to end
  - Docs overstate full-overwrite/idempotency guarantees for L3

## Recommendations

### Highest priority follow-ups

1. **Fix L3 re-import reconciliation before mass content churn**
   - Reason: the current docs promise a stronger overwrite guarantee than the code delivers, and passage-level stale data is the most operator-relevant integrity seam.

2. **Harden attempt concurrency semantics**
   - Add a partial unique guard for one `in_progress` attempt per `(user_id, test_id)`.
   - Make autosave updates atomic or otherwise race-safe.

3. **Add one compact integration/regression layer for the live route chain**
   - Import → list → detail(no key) → start → patch → submit → diagnostic.
   - This would lock in the cluster’s F1 lesson across the real runtime seam.

### Secondary follow-ups

4. **Fail closed on malformed `started_at`**
5. **Pin diagnostic exact threshold boundaries**
6. **Document the diagnostic heuristic nature more explicitly**
7. **Decide whether no-match diagnostic recommendations should surface a learner-facing fallback**

## Self-audit notes (Sprint 20.7 diagnostic engine)

I treated Sprint 20.7 with the same skepticism as the rest of the cluster.

What holds up:

- The engine’s auth scope is correct.
- It consumes only submitted attempts.
- It normalizes skill_breakdown defensively.
- It matches L2 recommendations by exact canonical tag, not fuzzy string logic.

What I missed in my own delivery:

- I did not add exact threshold boundary tests for `59/60` and `74/75`.
- I did not surface a learner-facing fallback when a weak skill has no L2 matches.
- The recommendation ranking is recency-based by router fetch order, not pedagogical scoring; that may be fine, but it should be named as such if kept.

None of those are P0/P1 blockers, but they are real audit-worthy follow-ups on my own 20.7 work.

## What the cluster got right

- The F1/F2 response was real, not papered over:
  - validator now rejects the broken nested author shape loudly
  - full-chain seed/build/grade regression exists
- Student detail answer stripping is deliberate and correctly implemented
- The three-library model stayed coherent:
  - `reading_passages` + `reading_questions` serve L1/L2/L3 consistently
  - `reading_tests` + `reading_test_attempts` layer only where L3 truly needs them
- Admin import/listing is operationally useful and properly protected
- The exam UI sentinel bundle is meaningful and currently green

## What Mình + Code missed

- The closure docs overstate L3 re-import safety; “fully overwrites” is not currently true when a passage is removed from a later upload.
- Q7’s “one active attempt” guarantee is still a router convention, not a database invariant.
- Autosave correctness under overlapping requests is not pinned and is not safe by construction.
- The diagnostic engine, while sound, still lacks exact-boundary tests and explicit no-match UX treatment.

## Closing verdict

Cluster 20.x is **healthy enough for observation phase**, but it is **not fully closed in the stronger “content scale-up is mechanically safe” sense** until the three P1 integrity seams are addressed:

1. L3 passage reconciliation on re-import  
2. one-active-attempt DB enforcement  
3. race-safe autosave persistence

I would not reopen the cluster as a large redesign. I would schedule one small hardening sprint before heavy L3 content churn or before treating the exam autosave path as production-hardened under concurrent real usage.
