# Audit PR #25 — Wave 2 Day 1 fixes — 2026-04-29

Branch: `fix/wave-2-dogfood-day-1-critical`  
PR: #25  
Spec: 3 dogfood Day 1 issues

## Overall verdict
✅ APPROVE

The branch fixes the intended Day 1 dogfood issues without reopening the earlier Phase B, Wave 1, Wave 2, or recent PR #21-24 surfaces. `POST /mark-fixed` is RLS-scoped, idempotent, and compatible with the existing `user_vocabulary.source_type` constraint; the triage view is correctly isolated to `auto:needs_review`; and the restored bidirectional flip no longer conflicts with the source-link interaction. The enrichment/backfill update is also non-destructive: optional `definition_vi/_en` only write when Gemini actually returns them. I found two non-blocking follow-ups: invalid-source responses return `409` instead of the spec’s `400`, and there is no dedicated live route test for `mark-fixed`.

## Status matrix
| Area | Status | Notes |
|------|--------|-------|
| POST `/mark-fixed` | ✅ | `_user_sb` route, feature-flagged, idempotent, partial-success semantics |
| Triage view rendering | ✅ | Only `auto:needs_review` branches to triage; other stacks stay in study mode |
| Bidirectional flip restoration | ✅ | Card body flips both ways; source button stops propagation |
| Enrichment prompt + validator | ✅ | Adds VI+EN definitions, idiom-aware prompt, mocked tests pass |
| Phase B regression | ✅ | Core vocab/grammar suites pass |
| Wave 1 regression | ✅ | D1 session/E2E/admin review suites pass |
| Wave 2 regression | ✅ | Flashcard E2E/due queue/rate limit/block-needs-review suites pass |
| Live RLS | ✅ | Existing live vocab + stack RLS suites pass |
| Anti-pattern checks | ✅ | No new migration, no hardcoded backend base URL, no service-role in user route |

## Findings

### [MEDIUM] - Invalid-source `mark-fixed` response uses `409` instead of the requested `400`
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/vocabulary_bank.py:712`
- Description: The route rejects `used_well` and `upgrade_suggested` rows with `HTTP 409`, while the dogfood fix spec called for “other types → 400”.
- Impact: This is a contract mismatch for clients expecting a validation-style `400`, even though the current semantics are still defensible and consistent with `/accept`.
- Reproduction: Call `POST /api/vocabulary/bank/{id}/mark-fixed` on a row whose `source_type` is `used_well` or `upgrade_suggested`; the handler raises `409`.
- Suggested fix: If strict spec parity matters, switch the conflict to `400` and update the test expectations in `test_vocab_mark_fixed.py`.

### [LOW] - No dedicated live route test exists for `POST /mark-fixed`
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_vocab_mark_fixed.py:127`
- Description: The new suite thoroughly covers the handler offline, and the existing live `user_vocabulary`/`flashcard` RLS regression suites pass, but there is no route-specific live test analogous to `test_mark_fixed_rls_scoped`.
- Impact: Current protection is still strong because the route uses `_user_sb(token)` and row ownership filters, but a future route-layer regression would be caught later than ideal.
- Reproduction: `rg -n "test_mark_fixed_rls|mark_fixed_rls" backend/tests` returns no dedicated live test.
- Suggested fix: Add one staging-backed case proving user B cannot `mark-fixed` a needs-review row owned by user A.

### [LOW] - Concurrent first-use requests can still race on default-stack creation
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/vocabulary_bank.py:511`
- Description: `_ensure_default_accept_stack()` does a read-then-insert without a unique DB constraint on `(user_id, name)`. Two first-time concurrent `/accept` or `/mark-fixed` calls could each create `"Từ vựng đã chấp nhận"`.
- Impact: In a narrow race window, one user could end up with duplicate default stacks and split cards between them.
- Reproduction: Race two first-ever requests that both hit `_ensure_default_accept_stack()` before either insert becomes visible.
- Suggested fix: Later harden with a unique DB constraint or an insert-and-retry lookup pattern.

## Tests run
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_mark_fixed.py -v tests/test_vocab_enrichment.py -v tests/test_flashcard_block_needs_review.py -v tests/test_vocab_accept_suggestion.py -v tests/test_vocab_recent_updates.py -v`
  - `55 passed`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py -v tests/test_grammar_smoke.py -v tests/test_d1_session.py -v tests/test_d1_e2e.py -v tests/test_admin_exercise_review.py -v tests/test_srs_algorithm.py -v tests/test_flashcard_e2e.py -v tests/test_due_queue.py -v tests/test_rate_limit.py -v`
  - `110 passed, 1 skipped`
  - skipped: local `test_session_rls_isolation` because that suite only runs live when env users are sourced
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_stack_rls.py -v tests/test_rls_vocab_integration.py -v'`
  - `12 passed`
- `bash /Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/verify_page_parity.sh`
  - `Page parity OK (4 page(s) checked).`

## Cross-phase regression
- Phase B: ✅ — `test_vocab_guards.py`, `test_grammar_smoke.py`, and live vocab RLS still pass
- Wave 1: ✅ — `test_d1_session.py`, `test_d1_e2e.py`, and `test_admin_exercise_review.py` pass
- Wave 2 (existing): ✅ — `test_flashcard_e2e.py`, `test_due_queue.py`, `test_rate_limit.py`, and `test_flashcard_block_needs_review.py` pass
- PR #21-24 (recent): ✅ — `test_whisper_prompt.py` was not touched here, `/accept` and `/recent-updates` suites still pass, and the `needs_review` stack protections remain intact

## Migration cross-phase concerns
N/A

## Merge recommendation
✅ APPROVE

There are no CRITICAL findings, no HIGH findings, and no reproduced cross-phase regression. The remaining issues are medium-to-low follow-ups around status-code strictness, dedicated live route coverage, and a narrow inherited stack-creation race — none are sufficient to block this Day 1 Wave 2 fix batch.
