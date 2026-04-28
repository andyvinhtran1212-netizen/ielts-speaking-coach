# Audit Flashcard Rich Content — 2026-04-27

Branch: `feature/flashcard-rich-content`  
PR: #13  
Commits: `5ff4700..1d38787`

## Overall verdict

**APPROVE**

PR #13 is merge-ready on the hard blockers. Migration `029` applies and re-applies cleanly on staging, live RLS regression still passes after widening `user_vocabulary`, the new Gemini enrichment service is well-covered by mocked tests (`18 passed`), and the shipped Phase B / Wave 1 / Wave 2 surfaces did not regress in the suites I reran. The Phase B integration is correctly fail-soft: enrichment happens inside the existing background extraction path, and a Gemini failure only leaves `ipa` / `example_sentence` null instead of blocking vocab persistence.

I found no CRITICAL or HIGH issue. The main remaining note is a medium UX/spec mismatch: when a card has no dictionary definitions, `flashcard-study.js` still prints the raw `context_sentence` inline on the back face, which partially reintroduces the “unreliable transcript shown directly” behavior this PR was meant to avoid.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| 1 Migration 029 | ✅ | Staging apply + re-apply pass; columns present; no RLS/constraint drift |
| 2 vocab_enrichment service | ✅ | 18 mocked tests pass; chunking, fence stripping, partial failure all covered |
| 3 Phase B integration | ✅ | Enrichment runs after extraction and before insert; fail-soft on Gemini error |
| 4 Admin backfill endpoint | ✅ | Admin-only, background task, cost estimate, missing-row query all present |
| 5 Frontend update | ⚠️ | Rich content renders well, but fallback path still prints `context_sentence` inline |
| 6 Backend GET include fields | ✅ | Flashcards + vocab bank payloads expose `ipa` / `example_sentence` |
| 7 Tests (18 cases) | ✅ | `tests/test_vocab_enrichment.py` passes 18/18 |
| 8 Phase B/Wave 1/Wave 2 regression | NO REGRESSION | Local regression suites + live RLS suites pass |
| 9 DEPLOY_CHECKLIST | ✅ | RC.1–RC.7 section present with migration/apply/backfill/rollback details |
| 10 Anti-patterns | ✅ | No service-role abuse in user flashcard routes; no hardcoded URL in touched frontend files |

## Findings

### [MEDIUM] - Flashcard fallback still exposes raw transcript directly on the back face
- Location: [frontend/js/flashcard-study.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/flashcard-study.js:173)
- Description: The rich-content design says the learner’s `context_sentence` should not appear directly on the back face and should only be revealed via an explicit “Xem trong bài nói gốc” control with a reliability warning. The normal path follows that rule, but the no-definition fallback path inlines `context_sentence` immediately under `"Chưa có định nghĩa."`.
- Impact: For vocab entries missing `definition_vi` and `definition_en`, the UI can still surface a possibly ungrammatical transcript sentence directly on the study surface, which weakens the reliability improvement this PR is supposed to deliver.
- Reproduction: Use a card payload where `definition_vi = null`, `definition_en = null`, and `context_sentence` is present. `renderCard()` inserts `Câu gốc: "..."` directly into `definitionBlock`.
- Suggested fix: Replace the inline transcript fallback with a neutral friendly message, and keep `context_sentence` available only through the explicit source button / warning overlay flow.

## Tests run

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_enrichment.py -q`
  - Result: `18 passed`

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_srs_algorithm.py tests/test_flashcard_e2e.py tests/test_due_queue.py tests/test_rate_limit.py -q`
  - Result: `40 passed`

- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py tests/test_grammar_smoke.py tests/test_d1_session.py tests/test_d1_e2e.py tests/test_admin_exercise_review.py -q`
  - Result: `70 passed, 1 skipped`

- `bash backend/scripts/verify_page_parity.sh`
  - Result: `Page parity OK (4 page(s) checked).`

- `zsh -lc 'set -a; source backend/.env.staging; psql "$DATABASE_URL" -f backend/migrations/029_user_vocab_ipa_example.sql'`
  - Result: apply succeeded on staging

- `zsh -lc 'set -a; source backend/.env.staging; psql "$DATABASE_URL" -f backend/migrations/029_user_vocab_ipa_example.sql'`
  - Result: re-apply succeeded with `already exists, skipping` notices only

- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py tests/test_exercise_rls.py tests/test_stack_rls.py -v'`
  - Result: `12 passed`

## Migration 029 special concerns

Migration `029` modifies the shipped Phase B table `user_vocabulary`, so I checked it separately:

- Schema widen only:
  - [backend/migrations/029_user_vocab_ipa_example.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/029_user_vocab_ipa_example.sql:19)
- Re-apply is idempotent on staging:
  - second run emitted only `column ... already exists, skipping`
- No RLS or existing constraints were modified in the migration
- Phase B integration now writes the new fields opportunistically:
  - [backend/routers/grading.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:711)
- Phase B regression still passes after the schema change:
  - `tests/test_vocab_guards.py`
  - `tests/test_grammar_smoke.py`
  - `tests/test_rls_vocab_integration.py`

## Cost analysis (Gemini)

- Per chunk (10 words): ~`$0.0005`
- Backfill 100 cards: ~`$0.005`
- Backfill 500 cards: ~`$0.025`
- Per extraction batch (incremental, typical single chunk): ~`$0.0005`

This is reasonable and well within the existing Wave 2 budget posture. The admin endpoint also exposes a best-effort estimate in its queued response:
- [backend/routers/admin.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:2603)

## Merge recommendation

**✅ APPROVE**

- 0 CRITICAL findings
- 0 HIGH findings
- no Phase B / Wave 1 / Wave 2 regression detected

## Future considerations

- IPA accuracy: Gemini can still return imperfect IPA. A future wave could switch to a dictionary-backed source (for example CMU Dict / Cambridge / Oxford APIs) if pronunciation precision becomes product-critical.
- Example sentence quality: AI-generated examples are a reasonable trade-off versus reusing the learner transcript, but they still benefit from continued dogfood review for awkwardness and style drift.
