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
| 10 | Unit tests pass | ✅ 16/16 |

---

## Known Issues / Deviations (Post-Audit Fixes)

All CRITICAL and HIGH findings from `AUDIT_PHASE_B_V3.md` were fixed before merge.

| Finding | Severity | Fix |
|---------|----------|-----|
| C1: user-facing vocab routes used `supabase_admin` (bypasses RLS) | CRITICAL | `vocabulary_bank.py` now uses `_user_sb(token)` — `create_client(url, anon_key)` + `postgrest.auth(token)` per request |
| C2: upsert with `on_conflict="user_id,headword"` doesn't match partial expression index | CRITICAL | Replaced with per-row `insert()` + catch; duplicate key error (23505/unique) is logged and skipped |
| C3: RLS UPDATE policy missing `WITH CHECK` | CRITICAL | Added migration `019b_fix_rls_update_policy.sql` — `WITH CHECK (auth.uid() = user_id)` prevents user_id mutation |
| H1: feature flag default-allow (`is False` check) | HIGH | Changed to `is True` in both `vocabulary_bank.py` and `grading.py` — missing key now denies |
| H2: `/auth/me` didn't expose `vocab_bank_enabled` | HIGH | Added `vocab_bank_enabled` to auth.py `/auth/me` response; `my-vocabulary.js` checks this before making bank API calls |
| H3: report endpoint had no feature flag guard | HIGH | Added `_vocab_bank_enabled` check to `report_false_positive` endpoint |
| H4: guard 2 used raw substring (fails on punctuation variants) | HIGH | Replaced with token-based contiguous subsequence match via `_sentence_in_transcript()` |
| H5: guard 4 was stub (no-op) | HIGH | Fully implemented: `upgrade_suggested` items rejected if `original_word` is in `used_well_headwords` |
| H6: guard 6 missed same-root pairs (e.g. sustain/sustainability) | HIGH | Added `_shares_root(a, b, min_prefix=6)` prefix check before Levenshtein in guard 6 |
| H7: transcript passed raw to Claude (prompt injection risk) | HIGH | Fenced in `<transcript>...</transcript>` tags with explicit instruction to ignore embedded instructions |
| M2: vocab_extractor used `os.environ.get(...)` instead of `settings.*` | MEDIUM | Changed to `settings.VOCAB_MIN_TRANSCRIPT_WORDS` and `settings.VOCAB_ANALYSIS_MODEL` |
