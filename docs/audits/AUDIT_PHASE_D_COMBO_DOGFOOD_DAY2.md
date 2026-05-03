# Audit Combo MEDIUM Dogfood Day 2 — 2026-04-29

Branch: feature/dogfood-day-2-medium-batch  
PR: #22  
Spec: 4 dogfood Day 2 findings

## Overall verdict
✅ APPROVE

The batch closes the intended Day 2 medium issues without reopening the earlier Phase B, Wave 1, Wave 2, or Combo HIGH surfaces. The new `accept` mutation is RLS-scoped, idempotent, and compatible with the existing `source_type` constraint, while the new dashboard widget replaces the removed result-page popup cleanly. I found two medium follow-ups worth noting: `recent-updates` collapses every manual row into one synthetic event, and the new preview modal lacks ESC/focus-trap behavior. Neither issue is severe enough to block merge for this PR.

## Status matrix
| Area | Status | Notes |
|------|--------|-------|
| Backend changes | ✅ | `recent-updates` and `accept` are auth-gated, feature-flagged, and use `_user_sb` |
| Frontend changes | ✅ | Result redirect/result page contract matches; dashboard widget and vocab actions render |
| POST `/{id}/accept` | ✅ | Idempotent, RLS-scoped, audit event emitted, `source_type` flip allowed |
| GET `/recent-updates` | ⚠️ | Works and is limited server-side, but manual rows are over-grouped |
| Result page consistency | ✅ | `practice.js` now routes `test_part` to `result.html?id=...`, which `result.html` already consumes |
| Popup removal | ✅ | Old result-page toast path is gone; dashboard widget is the replacement |
| Auto-stack badge | ✅ | “Đang phân loại” cue is shown only for `auto:needs_review` on study page |
| My Vocabulary preview modal | ⚠️ | Escaping/fallbacks are good, but accessibility is incomplete |
| Anti-pattern checks | ✅ | No new migration, no service-role abuse in user routes, no hardcoded backend base URLs in touched JS |
| Live RLS / regression | ✅ | Local suites and live RLS regression passed |

## Findings

### [MEDIUM] - `recent-updates` collapses all manual additions into one synthetic event
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/vocabulary_bank.py:215`
- Description: Rows with `session_id = NULL` are all grouped under the single key `"__manual__"`. If a user adds words manually across multiple days, the widget will render them as one event with the newest timestamp and combined count.
- Impact: The dashboard can overstate a single “manual update” event and hide the true cadence of separate manual additions.
- Reproduction: Call `GET /api/vocabulary/bank/recent-updates` for a user with multiple manual rows created on different days; they will be merged into one event because all null-session rows share the same grouping key.
- Suggested fix: Group null-session rows by a narrower event key, e.g. day/hour bucket or row id cluster, instead of a single global manual bucket.

### [MEDIUM] - Preview modal lacks keyboard accessibility safeguards
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:521`
- Description: The new preview modal supports close-button click and overlay click, but it does not listen for `Escape` and does not trap focus inside the modal.
- Impact: Keyboard users can tab behind the modal and cannot dismiss it with standard ESC behavior, which is a usability/accessibility regression for the new preview flow.
- Reproduction: Open the preview modal via `window._myVocab.previewFlashcard(...)`, press `Tab` repeatedly, then press `Escape`; focus is not trapped and ESC does nothing.
- Suggested fix: Add an `Escape` key listener while the modal is mounted and keep focus cycling within the modal container until close.

### [LOW] - No dedicated live route test exists for `POST /api/vocabulary/bank/{id}/accept`
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_vocab_accept_suggestion.py:95`
- Description: The new suite covers the handler offline and existing live `user_vocabulary` RLS tests still pass, but there is no route-specific live test analogous to `test_accept_rls`.
- Impact: Current safety is still good because the route uses `_user_sb(token)` plus `eq("user_id", user_id)`, but future regressions in the route layer would be caught later than ideal.
- Reproduction: `backend/tests/test_vocab_accept_suggestion.py` contains only offline stubbed tests; there is no live staging case for cross-user `accept`.
- Suggested fix: Add one live staging test for “user B cannot accept user A’s suggestion row”.

### [LOW] - `recent-updates` lacks a composite `(user_id, created_at DESC)` index
- Location: `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/019_user_vocabulary.sql:28`
- Description: The new endpoint orders by `created_at DESC` after filtering by `user_id`, but the table currently has `idx_user_vocab_user`, `idx_user_vocab_user_status`, and the unique headword index only.
- Impact: For very large vocab banks, the endpoint may sort more rows than necessary. The current `limit(fetch_n)` keeps the cost bounded, so this is not a correctness blocker.
- Reproduction: Inspect indexes in `019_user_vocabulary.sql` and compare them to the query at `/backend/routers/vocabulary_bank.py:204`.
- Suggested fix: Consider a later additive migration for `(user_id, created_at DESC)` if the widget becomes hot-path.

## Tests run
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_recent_updates.py -v`
  - `6 passed`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_accept_suggestion.py -v`
  - `5 passed`
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py -v tests/test_grammar_smoke.py -v tests/test_d1_session.py -v tests/test_flashcard_e2e.py -v tests/test_whisper_prompt.py -v`
  - `62 passed, 1 skipped`
  - skipped: `test_session_rls_isolation` because local run did not source live RLS env
- `bash /Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/verify_page_parity.sh`
  - `Page parity OK (4 page(s) checked).`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_stack_rls.py -v tests/test_rls_vocab_integration.py -v'`
  - `12 passed`

## Cross-phase regression
- Phase B: ✅ — vocab guards, grammar smoke, vocab-bank RLS regression all passed
- Wave 1: ✅ — `test_d1_session.py` local suite passed; redirect contract remains compatible with `result.html?id=...`
- Wave 2: ✅ — `test_flashcard_e2e.py` passed; the “Đang phân loại” cue is scoped only to `auto:needs_review`
- Combo HIGH: ✅ — `test_whisper_prompt.py` passed and no related code was altered

## Migration cross-phase concerns
N/A — this PR does not add or modify migrations.

## Merge recommendation
✅ APPROVE

No CRITICAL findings, no HIGH findings, and no Phase B / Wave 1 / Wave 2 / Combo HIGH regression was reproduced. The remaining issues are medium-to-low follow-ups around event grouping fidelity and preview-modal accessibility, not merge blockers for this dogfood Day 2 medium batch.
