# Audit PR #34 — Dashboard aggregate endpoint — 2026-05-02

Branch: `perf/dashboard-init-aggregate-endpoint`  
PR: #34  
Spec: PR-B (continuation of PR-A #33)

## Overall verdict
✅ **APPROVE**

This PR keeps the new dashboard aggregate path fully decoupled from the legacy HIGH-1 service-role pattern: the aggregator and router are JWT-scoped end-to-end, and the test suite pins that rule with explicit `supabase_admin` regex guards. Partial-response semantics are implemented correctly on both layers: the backend isolates failures per sub-query and returns `_errors`, while the frontend can consume partial aggregate data or fall back to the old `/sessions/stats` + `/recent-updates` + `/due/count` flow without blanking the page. Regression coverage across Phase B, Wave 1, Wave 2, and live RLS remained green.

## Status matrix
| Area | Status | Notes |
|------|--------|-------|
| HIGH-1 decoupling | ✅ | No `supabase_admin` in `dashboard_aggregator.py` or `routers/dashboard.py`; regex pin tests present and passing. |
| Partial response semantics | ✅ | Per-subquery `try/except`, `_errors` only when needed, frontend logs partial failures and remains null-safe. |
| RLS scoping verification | ✅ | New backend code only uses JWT-scoped `_user_sb` / `user_sb.table(...)`; no internal HTTP to legacy routers. |
| Frontend fallback path | ✅ | Aggregate fetch is wrapped; legacy `/sessions/stats` path is preserved and used on failure. |
| Schema correctness / scope discipline | ✅ | `/auth/me` remains separate, `vocab_count` not added, no cross-router imports, no `dependencies.py` detour. |
| Performance impact | ✅ | Request graph shrinks from 6+ historical calls to 4 first-paint calls; no extra fetches introduced. |
| Cross-PR regression | ✅ | Phase B, Wave 1, Wave 2, PR #21-33 regression suites all passed. |
| Anti-pattern checks | ✅ | No new hardcoded URLs or service-role abuse in new code; page parity passes; CORS `max_age=86400` preserved. |
| Test quality | ✅ | 10 new tests cover happy path, partial failure, filters, ordering, limit, and HIGH-1 decoupling pins. |

## Findings

### [LOW] - No browser-level cold-load benchmark is codified yet
- Location: performance verification gap, not a code-path correctness bug
- Description: The PR clearly reduces dashboard first-paint network work in code, but this audit did not find an automated browser benchmark in-repo that proves the target drop from ~10s to ~6–7s on a cold load.
- Impact: Low. The architectural improvement is real and the network graph reduction is verified, but the exact latency claim remains observational rather than test-enforced.
- Reproduction: Compare `frontend/pages/dashboard.html` request graph before/after PR #34:
  - now separate: `/auth/me`, `/api/dashboard/init`, `/sessions?limit=200`, `/api/grammar/dashboard-data`
  - no longer first-paint separate calls for `/sessions/stats?limit=20`, `/api/vocabulary/bank/recent-updates?limit=5`, `/api/flashcards/due/count`
- Suggested fix: Add a lightweight browser/perf smoke script later if you want the 6–7s target to become a repeatable gate instead of a manual observation.

## Tests run
- `cd /Users/trantrongvinh/Documents/ielts-speaking-coach/backend && ../backend/venv/bin/python -m pytest tests/test_dashboard_init.py tests/test_vocab_guards.py tests/test_d1_session.py tests/test_flashcard_e2e.py tests/test_vocab_recent_updates.py tests/test_due_queue.py tests/test_vocab_skip.py tests/test_needs_review_redefined.py -v`
  - Result: `96 passed, 1 skipped`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py tests/test_exercise_rls.py tests/test_stack_rls.py -v'`
  - Result: `14 passed`
- `bash /Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/verify_page_parity.sh`
  - Result: `Page parity OK (4 page(s) checked).`

## Cross-phase regression
- Phase B: ✅
  - `tests/test_vocab_guards.py`
  - `tests/test_vocab_recent_updates.py`
  - `tests/test_vocab_skip.py`
- Wave 1: ✅
  - `tests/test_d1_session.py`
- Wave 2: ✅
  - `tests/test_flashcard_e2e.py`
  - `tests/test_due_queue.py`
  - `tests/test_needs_review_redefined.py`
  - live `tests/test_stack_rls.py`
- PR #21-33 (recent): ✅
  - CORS `max_age=86400` preserved in [backend/main.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/main.py:48)
  - `/auth/me` dedup preserved in [frontend/pages/dashboard.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/dashboard.html:2121)
  - recent-updates logic reused, not reinvented

## Performance verification
- Pre-PR baseline (PR-A): ~10s
- Post-PR target: ~6–7s
- Verified: **yes, structurally**
  - current first-paint path in [frontend/pages/dashboard.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/dashboard.html:2146) now folds:
    - `/sessions/stats?limit=20`
    - `/api/vocabulary/bank/recent-updates?limit=5`
    - `/api/flashcards/due/count`
    into:
    - `GET /api/dashboard/init`
  - Remaining first-paint fetches are:
    - `/auth/me`
    - `/api/dashboard/init`
    - `/sessions?limit=200`
    - `/api/grammar/dashboard-data`
  - No extra first-paint round trips were introduced.

## HIGH-1 decoupling integrity
- `supabase_admin` in new code: ✅ **NONE**
- Test pin in place: ✅
  - [backend/tests/test_dashboard_init.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_dashboard_init.py:343)
  - [backend/tests/test_dashboard_init.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_dashboard_init.py:358)
- Recommendation: **pass**

Supporting evidence:
- [backend/services/dashboard_aggregator.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/dashboard_aggregator.py:53) accepts a JWT-scoped `sb`
- [backend/routers/dashboard.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/dashboard.py:42) builds local `_user_sb(...)`
- no internal HTTP calls to `/sessions/stats`

## Partial response semantics
- try/except per sub-query: ✅
  - [backend/services/dashboard_aggregator.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/dashboard_aggregator.py:70)
- Frontend null-safe: ✅
  - [frontend/pages/dashboard.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/dashboard.html:2153)
  - [frontend/pages/dashboard.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/dashboard.html:2170)
  - [frontend/pages/dashboard.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/dashboard.html:2215)
- Recommendation: **pass**

Behavior verified:
- All success → all keys, no `_errors`
- One failure → surviving keys still populate, `_errors` logged
- Stats failure still falls back to legacy stats/history path
- Recent updates and flashcard badge still consume aggregate values when available even if stats path falls back

## Merge recommendation
✅ **APPROVE**

No CRITICAL or HIGH findings remain. The new aggregate endpoint respects the Phase 2.5 lessons instead of regressing them: JWT-scoped backend, no internal service-role shortcut, partial failure isolation, clean frontend fallback, and no observed regression in vocab, D1, or flashcards.
