# Audit PR #28 — Triage relocation + needs_review redefine — 2026-04-30

Branch: `refactor/triage-to-my-vocab-and-needs-review-redefine`  
PR: #28  
Spec: PR-B (split from architectural decision)

## Overall verdict
✅ **APPROVE**

This branch preserves the Wave 2 flagship study flow while cleanly relocating the old grammar-verdict triage out of flashcard study and into My Vocabulary. The new `auto:needs_review` semantics are implemented consistently on the backend as "SRS struggle" (`lapse_count > 0`) with the expected exclusions (`is_skipped`, archived rows, and unresolved `source_type='needs_review'`). Local regression suites and live staging RLS suites both passed, and `auto:all_vocab` is explicitly guarded against the regression that would have turned it into a listing/triage flow.

## Status matrix
| Area | Status | Notes |
|------|--------|-------|
| Wave 2 flagship preservation (`auto:all_vocab`) | ✅ | `flashcard-study.js` is study-only again, and `test_list_cards_auto_all_vocab_unaffected` protects the queue path. |
| `auto:needs_review` redefine | ✅ | Implemented via `flashcard_reviews.lapse_count > 0`, excluding skipped + unresolved grammar-verdict rows, sorted by `lapse_count DESC` then `ease_factor ASC`. |
| PR #25 triage cleanup | ✅ | No remaining `loadTriage`, `renderTriageView`, or `triage-container` in flashcard study files. |
| My Vocabulary inline actions | ✅ | `markFixed`/`skipVocab` render only for `source_type='needs_review'` rows and use optimistic update + rollback. |
| Cross-PR dependency integrity | ✅ | Frontend calls existing `/mark-fixed` and `/skip` endpoints with `window.api.base`; `/mark-fixed` partial-success response is handled. |
| Phase B regression | ✅ | `test_vocab_guards.py`, `test_vocab_accept_suggestion.py`, `test_vocab_recent_updates.py` all pass. |
| Wave 1 regression | ✅ | `test_d1_session.py` passes (local suite); no D1 code paths touched. |
| Wave 2 regression | ✅ | `test_flashcard_e2e.py`, `test_due_queue.py`, `test_flashcard_block_needs_review.py`, and live `test_stack_rls.py` pass. |
| PR #21-27 recent regression | ✅ | `test_whisper_prompt.py`, `/accept`, `/skip`, and skipped-vocab filters all pass. |
| Anti-pattern checks | ✅ | No hardcoded backend URL in touched frontend files; page parity passes; user-facing flow stays on JWT-scoped clients. |

## Findings

### [LOW] - No dedicated live route test for `/mark-fixed`
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_vocab_mark_fixed.py`
- Description: The branch relies on strong offline endpoint tests for `/mark-fixed` plus live staging RLS coverage for the underlying `user_vocabulary` and flashcard tables, but there is not a dedicated live route-level `POST /mark-fixed` test in the suite.
- Impact: Low immediate risk because the same ownership and stack-writing primitives are already proven live by `test_rls_vocab_integration.py` and `test_stack_rls.py`, but route-level staging coverage would improve future confidence when this flow changes again.
- Reproduction: `rg -n "mark_fixed_rls|test_mark_fixed_rls" /Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests`
- Suggested fix: Add one live staging test that calls `/api/vocabulary/bank/{id}/mark-fixed` with user A and asserts user B cannot mutate or observe the promoted row through the route.

## Tests run
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_needs_review_redefined.py tests/test_flashcard_e2e.py tests/test_vocab_mark_fixed.py tests/test_vocab_skip.py tests/test_vocab_accept_suggestion.py tests/test_flashcard_block_needs_review.py tests/test_vocab_guards.py tests/test_d1_session.py -v`
  - Result: `102 passed, 1 skipped`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_due_queue.py -v`
  - Result: `4 passed`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_whisper_prompt.py -v`
  - Result: `3 passed`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_recent_updates.py -v`
  - Result: `6 passed`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py tests/test_exercise_rls.py tests/test_stack_rls.py -v'`
  - Result: `14 passed`
- `bash /Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/verify_page_parity.sh`
  - Result: `Page parity OK (4 page(s) checked).`

## Cross-phase regression
- Phase B: ✅ — vocab guards, accept flow, recent updates, and skipped-vocab filtering all still pass.
- Wave 1: ✅ — D1 session suite still passes; no D1 code paths changed.
- Wave 2 (CRITICAL: `auto:all_vocab` study mode): ✅ — backend and frontend both remain study-mode only; regression test explicitly covers `auto:all_vocab`.
- PR #21-27 (recent): ✅ — whisper prompt, `/accept`, `/skip`, and flashcard block rules all remain intact.

## Migration cross-phase concerns
N/A

## Merge recommendation
✅ **APPROVE**

No CRITICAL or HIGH findings remain in scope, and no Phase B / Wave 1 / Wave 2 regression was detected. The branch closes the architectural split cleanly: flashcard study returns to being a pure study surface, while unresolved grammar-verdict triage moves to the canonical vocab-management page where `markFixed` and `skipVocab` already belong.
