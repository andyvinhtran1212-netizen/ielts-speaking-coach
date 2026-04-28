# Audit Phase D Wave 2 — 2026-04-27

Branch: `feature/phase-d-wave-2-flashcards`  
PR: #10  
Commits: `39087a5..ad264c4`  
Spec: `PHASE_D_WAVE_2_PLAN.md`

## Overall verdict

**APPROVE**

Wave 2 is merge-ready on the strict blocker criteria: the 4 migrations apply cleanly and re-apply idempotently on staging, live 2-JWT RLS passes for the new flashcard surface plus Phase B / Wave 1 regression suites, and the local test surface is green. The branch also keeps the high-risk invariants intact: no `supabase_admin` in user-facing flashcard routes, strict default-deny feature flags, and Phase B’s `user_vocabulary` flow still passes after migration `028`.

I found no CRITICAL or HIGH issue left in scope. Two non-blocking notes remain: the manual-stack topic filter does not yet expose the spec’s `topic IS NULL` bucket (`"Chưa phân loại"`), and `frontend/js/my-vocabulary.js` still carries a dead hardcoded base-URL fallback.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| 1.1 Migration 025 schema | ✅ | Schema, index, rollback block present |
| 1.2 Migration 025 RLS | ✅ | 4 policies; UPDATE has `USING + WITH CHECK`; live stack RLS pass |
| 2 Migration 026 | ✅ | Unique `(stack_id, vocabulary_id)`, RLS via stack ownership; live card probe pass |
| 3 Migration 027 | ✅ | Review + review-log schema/indexes valid; live review probe pass |
| 4 Migration 028 (NEW) | ✅ | Idempotent add/backfill/index; Phase B insert path now forwards `topic` |
| 5 SRS algorithm | ✅ | 7-case suite passes; floor/cap/UTC/invalidation behavior correct |
| 6.1 Stack management endpoints | ✅ | Auth + flag + `_user_sb`; auto/manual stack handling consistent |
| 6.2 Card management endpoints | ✅ | Auto-stack and manual-stack paths both implemented; duplicate handling clear |
| 6.3 Study + stats endpoints | ✅ | Due queue, review, stats, due-count all present; review endpoint rate-limited |
| 7.1 flashcards.html | ⚠️ | Main flow works, but missing `"Chưa phân loại"` filter path for `topic IS NULL` vocab |
| 7.2 flashcard-study.html | ✅ | URL param, flip, hotkeys, rating flow, summary screen all wired |
| 7.3 Page parity | ✅ | `verify_page_parity.sh` passes |
| 7.4 Hardcoded URL | ✅ | Clean in the 4 new flashcard files |
| 8 Vocab Bank integration | ⚠️ | Add-to-stack flow is wired, but `my-vocabulary.js` still carries dead hardcoded URL fallback |
| 9 Feature flag | ✅ | `is_flashcard_enabled()`, `/auth/me`, settings default OFF, frontend gating all present |
| 10 Tests | ⚠️ | All required suites pass; automated live RLS file only covers stacks, cards/reviews needed manual probe in this audit |
| 11 Phase B/Wave 1 regression | NO REGRESSION | Local regression + live RLS regression pass |
| 12 DEPLOY_CHECKLIST | ✅ | Wave 2 section added with migration order, rollout, rollback caveat for 028 |
| Anti-patterns | ⚠️ | No blocker pattern repeated in new flashcard routes; one old fallback remains in `my-vocabulary.js` |

## Findings

### [MEDIUM] - Manual stack topic filter cannot target `topic IS NULL` rows
- Location: [backend/routers/flashcards.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/flashcards.py:389), [frontend/js/flashcards.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/flashcards.js:261), [PHASE_D_WAVE_2_PLAN.md](/Users/trantrongvinh/Documents/ielts-speaking-coach/PHASE_D_WAVE_2_PLAN.md:164)
- Description: The spec and migration comments say rows with `user_vocabulary.topic IS NULL` should be available under a `"Chưa phân loại"` bucket in the Manual Stack modal. The backend explicitly drops null topics from `/api/flashcards/vocab-topics`, and the frontend only renders chips from returned topics. There is no separate null-topic chip/flag, so topicless vocab cannot be targeted by the topic filter.
- Impact: Users cannot build manual stacks from uncategorized/manual-added vocab using the topic filter path that Wave 2’s `028` migration was meant to unlock.
- Reproduction: Ensure a user has `user_vocabulary` rows with `topic IS NULL`, open `flashcards.html` → “Tạo stack mới”, and inspect the topic chips. There is no `"Chưa phân loại"` option and no backend token to preview/save such a filter.
- Suggested fix: Add an explicit uncategorized selector in the modal and a backend filter representation (for example a special token or a separate boolean) that maps to `topic IS NULL`.

### [MEDIUM] - Automated live RLS coverage stops at stacks; cards/reviews are only protected by manual audit probe
- Location: [backend/tests/test_stack_rls.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_stack_rls.py:86)
- Description: The live RLS suite currently exercises only `flashcard_stacks`. In this audit I manually probed `flashcard_cards` and `flashcard_reviews` on staging and confirmed cross-user reads return `[]`, but that protection is not yet codified in pytest.
- Impact: Current branch is safe, but future regressions in migrations `026` or `027` could slip through CI because only stack ownership is pinned by the automated live suite.
- Reproduction: Read `test_stack_rls.py`; all three tests are stack-only. Manual staging probe in this audit returned `{'card_visible_to_b': [], 'review_visible_to_b': []}` for user B against user A’s rows.
- Suggested fix: Extend `test_stack_rls.py` (or add companion live tests) to cover cross-user read/mutate denial on `flashcard_cards` and `flashcard_reviews`.

### [LOW] - `my-vocabulary.js` still keeps a hardcoded localhost/Railway fallback
- Location: [frontend/js/my-vocabulary.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:6)
- Description: The new flashcard files correctly rely on `window.api.base`, but `my-vocabulary.js` still carries an inline fallback that hardcodes `http://localhost:8000` / Railway. In normal app execution `api.js` loads first, so this path is dead today.
- Impact: No immediate bug on this branch, but it preserves the URL-drift anti-pattern that prior audits have been trying to stamp out.
- Reproduction: `grep -rn "localhost:8000\\|railway.app" frontend/js/my-vocabulary.js`
- Suggested fix: Remove the fallback and rely solely on `window.api.base`, matching the newer flashcard files.

## Tests run

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_srs_algorithm.py tests/test_flashcard_e2e.py tests/test_due_queue.py tests/test_rate_limit.py -q`
  - Result: `35 passed`

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py tests/test_grammar_smoke.py tests/test_d1_session.py tests/test_d1_e2e.py tests/test_admin_exercise_review.py -q`
  - Result: `70 passed, 1 skipped`

- `bash backend/scripts/verify_page_parity.sh`
  - Result: `Page parity OK (4 page(s) checked).`

- `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_wave_2_test_env.sh'`
  - Result: migrations `025 → 028` applied successfully on staging

- `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_wave_2_test_env.sh'` (second run)
  - Result: idempotent re-apply succeeded with `already exists, skipping` notices only

- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_stack_rls.py tests/test_rls_vocab_integration.py tests/test_exercise_rls.py -v'`
  - Result: `8 passed`

- Manual live probe on staging (`flashcard_cards` + `flashcard_reviews`)
  - Result: `{'card_visible_to_b': [], 'review_visible_to_b': []}`

## Migration 028 special concerns

Migration `028` modifies the shipped Phase B table `user_vocabulary`, so I checked it separately:

- Backfill SQL is correct and guarded:
  - [backend/migrations/028_user_vocab_topic.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/028_user_vocab_topic.sql:26)
- Index is partial on `(user_id, topic) WHERE topic IS NOT NULL`:
  - [backend/migrations/028_user_vocab_topic.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/028_user_vocab_topic.sql:34)
- Forward-populate is present in the Phase B extraction path:
  - [backend/routers/grading.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:686)
- Phase B regression suite still passes after 028:
  - `tests/test_vocab_guards.py`, `tests/test_grammar_smoke.py`, `tests/test_rls_vocab_integration.py`

No data-loss or Phase B break was observed in this audit.

## Merge recommendation

**✅ APPROVE**

- 0 CRITICAL findings
- 0 HIGH findings
- no Phase B / Wave 1 regression detected
- live staging RLS passed for the new flashcard surface and shipped cross-user suites

## Wave 3 readiness

The current schema is a solid base for Wave 3 expansion:
- `flashcard_reviews` already tracks SRS per `(user_id, vocabulary_id)`, which is the right sharing level across stacks
- `flashcard_cards` stays clean as a manual-membership table
- `flashcard_stacks.type='manual'` is intentionally pinned, so adding new persisted stack kinds later will require an explicit migration rather than silent drift

For future expansion like audio/image cards or editable cards, the cleaner path is likely:
- keep `flashcard_reviews` as-is
- extend card payload/rendering separately rather than overloading the current manual-stack core

## D3 (deferred Phase E) impact

No harmful overlap found with deferred D3:
- Wave 2 reuses the existing feature-flag pattern without touching `d3_enabled`
- SRS tables are flashcard-specific and do not collide with D1/D3 exercise tables
- `exercises.html` integration simply adds the Flashcards card and does not alter D1 routing or D3 placeholder behavior
