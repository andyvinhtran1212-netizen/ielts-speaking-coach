# Test Coverage Baseline — 2026-04-30

Captured at the end of Phase 2.5 Day 5.  This is the first formal coverage
snapshot — intent is to (a) anchor a starting line so future deltas are
visible, and (b) point at the highest-leverage gaps without prescribing
them as immediate work.

Run with:

```bash
cd backend
venv/bin/python -m pytest --cov=. --cov-report=term --cov-report=xml
```

239 passed, 15 skipped (env-gated live RLS), 0 failed.

## Overall coverage: **50%** (4530/9014 statements)

Note: the denominator includes test files themselves (~1900 stmts), service
modules whose behavior is exercised through external APIs we don't mock
(e.g. `whisper.py`, `claude_grader.py`, `azure_pronunciation.py`), and the
`responses.py` legacy router (0% — confirmed dead code, pending removal
per HIGH-1 deferred sprint).

## Coverage by area

### Strong (≥90%) — keep here

| Module | Cover |
|---|---|
| `routers/health.py` | 100% |
| `services/srs.py` | 100% |
| `services/analytics.py` | 100% |
| `services/vocab_enrichment.py` | 95% |
| `services/vocab_guards.py` | 91% |
| `config.py` | 91% |

### Moderate (60–89%) — acceptable

| Module | Cover |
|---|---|
| `services/rate_limit.py` | 88% |
| `main.py` | 80% |
| `database.py` | 75% |
| `routers/vocabulary_bank.py` | 73% |
| `services/vocab_content.py` | 73% |
| `routers/exercises.py` | 62% |
| `routers/vocabulary.py` | 61% |

### Low (20–59%) — flagged for future rounds

| Module | Cover | Note |
|---|---|---|
| `services/ai_usage_logger.py` | 57% | Best-effort logger, fail path silently no-ops; partial cover OK |
| `services/grammar_content.py` | 51% | Static content loader; bulk uncovered = file-IO branches |
| `routers/tts.py` | 48% | TTS provider integration |
| `routers/flashcards.py` | 40% | Heavily exercised via e2e but a lot of admin/edge branches |
| `routers/sitemap.py` | 38% | |
| `routers/export.py` | 37% | CSV/JSON export branches |
| `services/d1_content_gen.py` | 42% | Gemini call paths |
| `services/feature_flags.py` | 30% | |
| `routers/grammar.py` | 25% | |
| `services/pronunciation_sampling.py` | 25% | |
| `routers/auth.py` | 20% | Provisioning paths gated on Supabase Auth |
| `routers/admin.py` | 19% | Large surface; admin-only flows |
| `routers/sessions.py` | 19% | Legacy router, pending HIGH-1 sprint |
| `services/pdf_generator.py` | 17% | WeasyPrint disabled in prod — most paths dead |
| `routers/questions.py` | 15% | Gemini-dependent generation |

### Critical (<15%) — gaps worth naming

| Module | Cover | Why |
|---|---|---|
| `routers/grading.py` | **9%** | Production-critical grading pipeline.  External-API-heavy (Whisper + Claude + Storage); near-impossible to test without contract stubs.  Highest risk:reward ratio for next coverage round. |
| `routers/pronunciation.py` | **9%** | Azure-API-heavy.  Same constraint as grading.py. |
| `services/transcript_reliability.py` | 11% | |
| `services/azure_pronunciation.py` | 12% | |
| `services/claude_grader.py` | 12% | The `_filter_false_article_flags` regex / post-processing logic is well-tested elsewhere but the orchestration around it isn't. |
| `services/gemini.py` | 16% | |
| `services/whisper.py` | 18% | |
| `routers/responses.py` | **0%** | Dead code per its own docstring; remove during HIGH-1 sprint instead of testing. |
| `services/vocab_extractor.py` | **0%** | Surprising — flag for next round. |

## Coverage goals (post Phase 3)

Not committing to specific gates yet — the audit recommendation was
"capture baseline, then decide."  Directional targets if/when we choose
them:

- **Maintain ≥50% overall** — don't regress from this baseline.
- **Critical paths ≥80%** — `services/srs.py`, `services/vocab_guards.py`,
  `services/vocab_enrichment.py`, RLS-pinning tests already meet this.
- **New routers + services ≥70% from day 1** — pattern already established
  in Wave 2 (`flashcard_e2e`, `srs_algorithm`, `due_queue`, etc.).
- **External-API orchestration paths** — accept low line coverage; pin
  contracts via builder-recording stubs (the pattern in
  `test_sessions_search.py`, `test_needs_review_redefined.py`).

## Cumulative metric tracking

This is the first capture; future coverage runs append a row below so
delta-over-time is visible at a glance.

| Date       | Overall | Notes |
|---|---|---|
| 2026-04-30 | 50%    | Baseline (Phase 2.5 Day 5; 239 passed, 15 skipped) |
