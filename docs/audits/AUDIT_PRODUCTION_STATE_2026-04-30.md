# Comprehensive Production State Audit — 2026-04-30

## Executive Summary

Production looks functionally healthy after the Phase 2.5 burst. The current `main` branch carries **30 migrations in repo**, the live key tables for Phase B / Wave 1 / Wave 2 all exist with the expected columns and indexes, **239/254 local tests passed** with only the expected environment-gated skips, and the full **live RLS bundle passed 15/15** once staging credentials were present. Public production probes are up: `/health` and `/health/ready` both returned `200`, and `/health/ready` reported `database`, `migrations`, `gemini_api`, and feature flags all `ok`.

The strongest production-state concern is no longer a shipped feature regression; it is **cumulative security/operational debt in older layers**. Newer Phase B / D code follows the stricter model (JWT-scoped clients + explicit RLS tests + default-deny flags), but several legacy session/response flows still use `supabase_admin` in user-facing paths and the corresponding legacy DB policies have not all been upgraded to the newer `USING + WITH CHECK` standard. That does not present as an active incident in the current app, but it leaves the core speaking/session layer less defense-in-depth than the newer vocab/flashcard/exercise surfaces.

Operationally, the app is stable enough to keep serving production traffic and continue controlled dogfood, but it is **not yet in the ideal “Phase 3 clean baseline” state**. The right next move is a focused hardening batch, not a broad refactor: migrate the remaining legacy user routes toward JWT-scoped access and codify observability schema that still exists only as manual SQL comments.

## Production State Snapshot

### Database
- Migrations in repo: **001 → 030**
- Live key-schema verification: **matched through 030** for:
  - `user_vocabulary`
  - `vocabulary_exercises`
  - `vocabulary_exercise_attempts`
  - `d1_sessions`
  - `flashcard_stacks`
  - `flashcard_cards`
  - `flashcard_reviews`
  - `flashcard_review_log`
- RLS policy rows returned from live DB snapshot: **38**
- Key integrity checks:
  - `orphan_cards = 0`
  - `orphan_reviews = 0`
  - `orphan_review_logs = 0`
  - `null_topic_vocab = 0`
- Live vocab snapshot:
  - `manual`: 1 row
  - `needs_review`: 14 rows (`2` skipped)
  - `used_well`: 36 rows

### API
- Total registered routes: **121**
- Health surface present:
  - `GET /health`
  - `GET /health/ready`
- Phase 2.5 route additions observed live in app surface:
  - `/api/vocabulary/bank/recent-updates`
  - `/api/vocabulary/bank/export`
  - `/api/vocabulary/bank/{id}/accept`
  - `/api/vocabulary/bank/{id}/mark-fixed`
  - `/api/vocabulary/bank/{id}/skip`
  - `/api/flashcards/due/count`
  - `/admin/vocab/backfill-enrichment`
  - `/admin/flashcards/stats`
  - search/pagination expansion on `/sessions`

### Frontend
- Page parity script: **pass**
  - `frontend/pages/d3-exercise.html` intentionally skipped (deferred to Phase E)
- Touched user pages still load Supabase CDN + `api.js` + `initSupabase(...)` in the expected order
- Hardcoded backend URLs: **none found in active frontend JS/pages outside comments and `api.js`**
- Flashcard / vocab / dashboard feature-flag gates still use strict `=== true` patterns

### Tests
- Local full backend suite:
  - **239 passed, 15 skipped**
  - skips are the expected env-gated live RLS/session cases when staging creds are absent
- Live staging suites run during this audit:
  - `tests/test_rls_vocab_integration.py` + `tests/test_exercise_rls.py` + `tests/test_stack_rls.py`: **14 passed**
  - `tests/test_d1_session.py::test_session_rls_isolation`: **1 passed**
- Coverage plugin state:
  - `pytest-cov` **not installed** in the backend venv, so no reliable automated coverage snapshot was available in this environment

### Production
- Public health probes:
  - `/health` → `200`
  - `/health/ready` → `200`
- `/health/ready` checks returned:
  - `database.status = ok`
  - `migrations.status = ok`
  - `gemini_api.status = ok`
  - `feature_flags.status = ok`
- Public latency samples from this audit environment:
  - `/health`: ~`0.65–0.75s`
  - `/health/ready`: ~`3.6–4.3s`
  - `/api/grammar/home`: ~`1.09s`
  - `/api/grammar/categories`: ~`1.11s`
- **Not independently verified from platform dashboards in this audit**:
  - Vercel deploy SHA/status vs `main`
  - Railway deploy SHA/status vs `main`
  - 24h 5xx log count
  - backup recency

### Cost
- Live `ai_usage_logs` snapshot:
  - `claude`: 995 calls, total logged cost ≈ **$5.9369**
  - `whisper`: 934 calls, total logged cost ≈ **$4.0047**
  - `tts`: 620 calls, total logged cost ≈ **$0.5791**
  - `gemini`: 321 calls, total logged cost ≈ **$0.0381**
- These are **historical totals in the table**, not a month-bounded rollup, but they support the current conclusion that Gemini is not the cost driver and overall Phase 2.5 remains comfortably in the intended low-cost band.

## Findings (sorted by severity)

### [HIGH] - Legacy session/response/user flows still bypass the newer RLS-first security model
- Location:
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/sessions.py:253-283`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/responses.py:46-52`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/responses.py:85-103`
  - live `pg_policies` snapshot for `sessions`, `responses`, and `users`
- Description:
  - Newer Phase B / D surfaces use JWT-scoped clients and rely on RLS as the canonical protection layer.
  - Core legacy flows such as session creation/list/update and response upload/upsert still use `supabase_admin` in user-facing handlers and enforce ownership in application code with manual `.eq("user_id", user_id)` filters.
  - The live RLS snapshot also shows older tables like `sessions`, `responses`, and `users` still have pre-lesson UPDATE policies without the stronger `WITH CHECK` defense that newer tables now carry.
- Impact:
  - No active exploit was reproduced in this audit, and production is functioning correctly today.
  - But the cumulative security posture is inconsistent: newer systems are defense-in-depth; older core speaking/session systems are still “auth check + service role + manual filter”.
  - That raises blast radius if a future handler regression misses an ownership predicate.
- Suggested minimal fix:
  - Treat this as the first hardening batch before Phase 3 scope expands:
    1. audit `sessions.py`, `responses.py`, `pronunciation.py`, and any remaining user-facing `auth`/question/session reads
    2. convert the highest-traffic routes to JWT-scoped Supabase clients
    3. upgrade legacy RLS UPDATE policies to `USING + WITH CHECK`
    4. add live RLS route tests the same way Wave 1 / Wave 2 now do

### [MEDIUM] - `ai_usage_logs` is production-critical observability schema without a migration
- Location:
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/ai_usage_logger.py:7-26`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/ai_usage_logger.py:146-151`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:1543`
- Description:
  - The repo actively writes to `ai_usage_logs` and the admin surface reads it, but the table/index definition exists only as a comment block in `ai_usage_logger.py`, not as a numbered migration.
  - Production currently has the table and it contains **2870** rows, so the system is working today.
  - However, a fresh environment or disaster recovery path cannot reproduce that schema from the migration chain alone.
- Impact:
  - Observability and admin cost analytics depend on a table that is not source-of-truth codified in migrations.
  - The logger silently swallows insert failures, so missing schema could degrade unnoticed in future environments.
- Suggested minimal fix:
  - Add a dedicated migration for `ai_usage_logs` and its indexes, then remove the “run once manually” schema comment from the service docstring.

### [MEDIUM] - Rich-content enrichment is only partially complete in live vocab data
- Location:
  - live `user_vocabulary` data snapshot
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/flashcard-study.js:165-215`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/admin.py:2602`
- Description:
  - Live data shows:
    - `used_well`: `12/36` rows missing both `definition_vi` and `definition_en`
    - `needs_review`: `6/14` rows missing both definitions
    - `needs_review`: `1` row still missing `ipa`
    - `needs_review`: `1` row still missing `example_sentence`
  - The frontend now handles this gracefully with a no-content fallback instead of breaking, so the user experience is degraded-but-safe, not broken.
- Impact:
  - Flashcard rich content is operational but incomplete.
  - Dogfooders can still hit cards that show fallback copy instead of the intended full rich-content back face.
- Suggested minimal fix:
  - Re-run the existing admin backfill enrichment endpoint against the incomplete rows, then re-check missing counts.
  - If the counts stay high, inspect whether certain source types or legacy rows are systematically bypassing enrichment.

### [LOW] - Duplicate `/health` route registration remains in `main.py`
- Location:
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/main.py:95-97`
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/health.py:42-49`
- Description:
  - The app includes `health_router`, which already registers `/health`, but `main.py` also defines a second `/health` handler.
  - Production is returning the richer router-based response today, so this is not breaking probes.
- Impact:
  - Easy future drift: one handler can be updated while the other is forgotten.
- Suggested minimal fix:
  - Remove the legacy `/health` route from `main.py` and keep `routers/health.py` as the single source of truth.

### [LOW] - `TECH_DEBT.md` production snapshot is stale after the final Phase 2.5 merges
- Location:
  - `/Users/trantrongvinh/Documents/ielts-speaking-coach/TECH_DEBT.md:333-348`
- Description:
  - The embedded health snapshot still says production is “through 029” with `194 collected` tests, while current main has migration `030` and the local suite now collects `254` tests.
- Impact:
  - New contributors can get an outdated baseline picture of current production state.
- Suggested minimal fix:
  - Refresh the health snapshot block after this audit, or replace it with a “last verified on” note plus a link to the latest cumulative audit.

### [LOW] - Coverage baseline cannot currently be reproduced in the backend venv
- Location:
  - backend test environment (tooling gap; no code line)
- Description:
  - `pytest --cov=. --cov-report=term-missing --cov-report=html` failed because `pytest-cov` is not installed in the current backend virtualenv.
- Impact:
  - The project now has a strong correctness suite, but lacks an easy repeatable coverage baseline for cumulative audits.
- Suggested minimal fix:
  - Add `pytest-cov` to backend test dependencies and record a baseline coverage report before Phase 3.

### [LOW] - Public endpoint latency is acceptable for current dogfood scale but already above the aspirational liveness target
- Location:
  - sampled production probes during this audit
- Description:
  - From this audit environment, `/health` consistently returned `200` but at ~`0.65–0.75s`, and `/health/ready` was ~`3.6–4.3s`.
  - `/api/grammar/home` and `/api/grammar/categories` were ~`1.1s`.
- Impact:
  - This is not a current outage or merge blocker, and network distance / cold-start effects may contribute.
  - But it means the “`/health` < 200ms” aspiration is not met in the observed sample.
- Suggested minimal fix:
  - Keep the current endpoints, but add simple longitudinal monitoring rather than relying on one-off curl impressions.

## Cross-PR contradictions

None found that currently break production behavior.

Notable consistency checks that still hold:
- PR #23 needs-review lockout remains relevant after PR #28 because unresolved grammar-verdict rows are still excluded from SRS queues.
- PR #25 triage logic was relocated rather than half-kept; flashcard study is study-only again while My Vocabulary owns the triage actions.
- PR #27 skip semantics are consistently honored across listing, stats, session lookups, export, and flashcard queues.
- Default stack naming (`"Từ vựng đã chấp nhận"`) is consistent across `/accept` and `/mark-fixed`.

## Anti-pattern violations

- **Present (legacy layer):** service-role use in several user-facing legacy routers (`sessions.py`, `responses.py`, `pronunciation.py`, etc.)
- **Present (operational tooling):** coverage command from the cumulative-audit prompt cannot run in the backend venv because `pytest-cov` is absent
- **Not found in current active frontend code:** hardcoded backend URLs outside `api.js`
- **Not found in new Phase B / D user routes:** default-allow feature-flag regressions
- **Not found in new Phase B / D tables:** missing `WITH CHECK` on the newer RLS UPDATE policies

## Recommendations

### Immediate (next 24h)
- Create and apply a migration for `ai_usage_logs` so observability schema is finally source-controlled.
- Re-run the existing vocab enrichment backfill against rows still missing `definition_vi` / `definition_en` / `ipa` / `example_sentence`, then record the new counts.
- Remove the duplicate `/health` route from `main.py`.

### Short-term (next 7 days)
- Run a dedicated hardening sweep on legacy user-facing routers that still use `supabase_admin`, starting with `sessions.py` and `responses.py`.
- Upgrade any remaining legacy UPDATE RLS policies (`sessions`, `responses`, `users`) to `USING + WITH CHECK`.
- Install `pytest-cov` in the backend test environment and capture a reproducible coverage baseline.
- Refresh the stale snapshot block in `TECH_DEBT.md`.

### Long-term (Phase 3+)
- Move the remaining session/history core onto the same security pattern the newer vocab/flashcard/exercise systems now use.
- Add platform-backed operational checks for:
  - deployment SHA vs `main`
  - backup recency
  - 24h 5xx counts
  - longitudinal endpoint latency
- Consider codifying a “state audit” checklist that can be re-run at the end of each multi-PR dogfood cycle.

## Health metrics

- Overall production health: **WARNING**
- Tech debt level: **MEDIUM**
- Ready for Phase 3: **WITH FIXES**

Why not `CRITICAL`:
- No active production outage was found.
- Public health endpoints are green.
- Core Phase B / Wave 1 / Wave 2 regression suites are green.
- Live RLS suites for the newer user-scoped systems pass.

Why not fully `HEALTHY`:
- Legacy security model drift still exists in older session/response flows.
- Observability schema is not fully migration-backed.
- Rich-content enrichment is not yet complete in live data.

## Audit completion stats

- Time spent: ~45 minutes
- Files reviewed directly: 18+
- Routes inspected: 121
- Tests run:
  - local full suite: 254 collected / 239 passed / 15 env-gated skips
  - live RLS + D1 session: 15 passed
  - page parity: pass
