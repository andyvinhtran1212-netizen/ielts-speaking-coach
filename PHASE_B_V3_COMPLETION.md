# Phase B V3 — Personal Vocab Bank: Completion Report

## What Was Built

### Backend

| File | Change | Purpose |
|------|--------|---------|
| `backend/migrations/019_user_vocabulary.sql` | NEW | `user_vocabulary` table, `users.feature_flags` JSONB column, RLS (4 policies), unique partial index |
| `backend/services/vocab_extractor.py` | NEW | Claude Haiku extraction, Pydantic V2 schema, returns `None` on any failure |
| `backend/data/band_upgrade_pairs.json` | NEW | 100 verified A1–B1→B2–C1 upgrade pairs whitelist |
| `backend/services/vocab_guards.py` | NEW | 6-guard precision filter; inline Levenshtein DP; no new deps |
| `backend/tests/test_vocab_guards.py` | NEW | 11 unit tests, all passing |
| `backend/routers/grading.py` | MODIFIED | BackgroundTasks integration (STEP 8c); `_run_vocab_extraction` fully isolated |
| `backend/routers/vocabulary_bank.py` | NEW | 7 endpoints: GET `/`, GET `/stats`, GET `/{id}`, POST `/`, PATCH `/{id}`, DELETE `/{id}`, POST `/{id}/report` |
| `backend/routers/admin.py` | MODIFIED | `GET /admin/vocab/stats`, `POST /admin/users/{user_id}/vocab-flag` |
| `backend/config.py` | MODIFIED | 5 new vocab env vars with safe defaults (all disabled) |
| `backend/main.py` | MODIFIED | Mounted `vocabulary_bank_router` |

### Frontend

| File | Change | Purpose |
|------|--------|---------|
| `frontend/pages/my-vocabulary.html` | NEW | Vocab Bank UI: stats bar, filter tabs, add form, card list, mastery toggle, report modal |
| `frontend/js/my-vocabulary.js` | NEW | All vocab bank client logic |
| `frontend/pages/result.html` | MODIFIED | Vocab toast (polls at 8s + 18s, shows count if > 0) |
| `frontend/admin.html` | MODIFIED | Vocab Monitor tab: FP stats grid, per-user flag toggle UI + JS functions |

---

## Rollout Sequence

1. **Run migration** `019_user_vocabulary.sql` in Supabase SQL editor
2. **Deploy backend** — all vocab routes return `403` by default (env vars off)
3. **Enable for test users** via admin panel → Vocab Monitor tab → enter user ID → Enable
4. **Enable globally** when ready: set `VOCAB_ANALYSIS_ENABLED=true` and `VOCAB_BANK_FEATURE_FLAG_ENABLED=true` in Railway env

---

## Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Extractor crash never breaks grading response | ✅ BackgroundTask + try/except |
| 2 | Precision > Recall: 6 guards applied before insert | ✅ |
| 3 | No new Python dependencies | ✅ Levenshtein inline DP |
| 4 | Feature fully behind env flag + per-user flag | ✅ |
| 5 | Soft delete only (no hard deletes) | ✅ `is_archived = true` |
| 6 | RLS prevents cross-user data access | ✅ 4 policies + service role for background |
| 7 | Admin can monitor FP rate and toggle flags | ✅ |
| 8 | Vocab toast appears on result page after practice | ✅ (polls 8s + 18s) |
| 9 | Manual word add with 409 duplicate guard | ✅ |
| 10 | Unit tests pass | ✅ 11/11 |
