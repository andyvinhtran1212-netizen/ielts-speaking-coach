# Tasks

Implementation PR #1452 landed after approval PR #1453. T001–T006 describe
implemented code; T007 remains open for operational acceptance. See verification.md
for the 2026-09-26 evidence reconciliation.

- [x] T001 Add the additive usage-ledger migration and effective-dated price catalog. `owns: backend/migrations/286_ai_usage_ledger.sql, backend/services/ai_pricing.py`
- [x] T002 Add idempotent sync/async usage logging and safe legacy compatibility. `depends: T001; owns: backend/services/ai_usage_logger.py`
- [x] T003 Instrument provider attempts without moving provider retry/timeout boundaries. `depends: T002; owns: backend/services/azure_pronunciation.py, backend/services/grading_providers/, backend/services/whisper.py, backend/services/tts_audio.py`
- [x] T004 Make admin usage aggregation and the Next.js dashboard expose canonical metadata and Writing deduplication. `depends: T001,T002; owns: backend/routers/admin.py, frontend/app/(authed-admin-system)/admin/system/ai-usage/, frontend/lib/admin-ai-usage-model.mjs`
- [x] T005 Configure supported model targets, Gemini 3.8 request compatibility, and the Speaking rollback knob. `depends: T001; owns: backend/config.py, backend/services/gemini_compat.py, backend/services/grading_orchestrator.py`
- [x] T006 Add requirement-linked backend/frontend tests and update the operational audit/runbook. `depends: T001,T002,T003,T004,T005; owns: backend/tests/, frontend/tests/, docs/audits/AI_MODEL_AND_USAGE_LEDGER_2026-09-18.md`
- [ ] T007 Complete independent review, full regression tests, staging migration checks, provider smoke calls, and cost reconciliation. `depends: T006`
